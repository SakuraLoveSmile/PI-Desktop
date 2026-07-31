use anyhow::Result;
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::future::pending;
use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

use crate::workspace::{resolve_tool_path, ToolRoot};

pub mod shell;

pub const MAX_RESULT_BYTES: usize = 256 * 1024;
pub const MAX_RESULT_LINES: usize = 4000;
pub const MAX_TIMEOUT_MS: u64 = 2_147_483_647;
const PIPE_DRAIN_TIMEOUT: Duration = Duration::from_millis(750);
const PROCESS_TERMINATION_TIMEOUT: Duration = Duration::from_millis(2_000);
const OUTPUT_CHANNEL_CAPACITY: usize = 64;
const OUTPUT_NOTIFICATION_INTERVAL: Duration = Duration::from_millis(100);
const OUTPUT_NOTIFICATION_MAX_CHUNK_BYTES: usize = 16 * 1024;
const MAX_OUTPUT_NOTIFICATIONS: usize = 1024;

#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

#[cfg(windows)]
#[derive(Debug, Default)]
struct ProcessOwnership {
    job: Option<HANDLE>,
}

#[cfg(not(windows))]
#[derive(Debug, Default)]
struct ProcessOwnership;

impl ProcessOwnership {
    #[cfg(windows)]
    fn assign(child: &tokio::process::Child) -> Self {
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Self::default();
        }

        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) != 0
        };
        let assigned = configured
            && child
                .raw_handle()
                .is_some_and(|handle| unsafe { AssignProcessToJobObject(job, handle) != 0 });
        if !assigned {
            unsafe {
                CloseHandle(job);
            }
            return Self::default();
        }
        Self { job: Some(job) }
    }

    #[cfg(not(windows))]
    fn assign(_child: &tokio::process::Child) -> Self {
        Self
    }

    #[cfg(windows)]
    fn terminate(&self) -> bool {
        self.job
            .is_some_and(|job| unsafe { TerminateJobObject(job, 1) != 0 })
    }

}

#[cfg(windows)]
// Windows kernel handles are process-wide and safe to move between Tokio
// worker threads; the ownership wrapper closes exactly one job handle.
unsafe impl Send for ProcessOwnership {}

#[cfg(windows)]
unsafe impl Sync for ProcessOwnership {}

#[cfg(windows)]
impl Drop for ProcessOwnership {
    fn drop(&mut self) {
        if let Some(job) = self.job.take() {
            unsafe {
                CloseHandle(job);
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsExecuteParams {
    pub session_id: String,
    pub turn_id: Option<String>,
    pub tool_call_id: String,
    pub tool_name: String,
    pub args: Value,
    pub mode: String,
    #[serde(default)]
    pub declared_risk: Option<String>,
    #[serde(default)]
    pub expected_command_shell_id: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsExecuteResult {
    pub tool_call_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    pub content: Value,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub denied: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_shell_id: Option<String>,
}

pub fn truncate_output(text: &str) -> (String, bool) {
    let mut truncated = false;
    let mut lines: Vec<&str> = text.lines().collect();
    if lines.len() > MAX_RESULT_LINES {
        lines.truncate(MAX_RESULT_LINES);
        truncated = true;
    }
    let mut out = lines.join("\n");
    if out.len() > MAX_RESULT_BYTES {
        let mut end = MAX_RESULT_BYTES;
        while end > 0 && !out.is_char_boundary(end) {
            end -= 1;
        }
        out.truncate(end);
        truncated = true;
    }
    if truncated {
        out.push_str("\n\n[truncated: output exceeded 256KB or 4000 lines]");
    }
    (out, truncated)
}

#[derive(Debug)]
pub struct BashExecutionOptions {
    pub session_id: String,
    pub tool_call_id: String,
    pub command_shell_id: String,
    pub timeout_ms: Option<u64>,
    pub cancellation: Option<watch::Receiver<bool>>,
    pub output_tx: Option<mpsc::UnboundedSender<String>>,
}

impl BashExecutionOptions {
    fn local(command_shell_id: String, timeout_ms: Option<u64>) -> Self {
        Self {
            session_id: "local".into(),
            tool_call_id: "local".into(),
            command_shell_id,
            timeout_ms,
            cancellation: None,
            output_tx: None,
        }
    }
}

pub fn validate_timeout_ms(timeout_ms: Option<u64>) -> Result<(), (String, String)> {
    if let Some(timeout_ms) = timeout_ms {
        if timeout_ms == 0 || timeout_ms > MAX_TIMEOUT_MS {
            return Err((
                "INVALID_ARGUMENT".into(),
                format!(
                    "timeoutMs must be positive and no greater than {MAX_TIMEOUT_MS}"
                ),
            ));
        }
    }
    Ok(())
}

pub async fn execute_tool(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    tool_name: &str,
    args: &Value,
    timeout_ms: u64,
) -> ToolsExecuteResult {
    let command_shell_id = shell::catalog(None)
        .effective
        .map(|option| option.id)
        .unwrap_or_else(|| shell::default_shell_id().to_string());
    execute_tool_with_options(
        workspace,
        scratch,
        tool_name,
        args,
        Some(timeout_ms),
        if tool_name == "Bash" {
            Some(BashExecutionOptions::local(command_shell_id, Some(timeout_ms)))
        } else {
            None
        },
    )
    .await
}

pub async fn execute_tool_with_options(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    tool_name: &str,
    args: &Value,
    timeout_ms: Option<u64>,
    bash_options: Option<BashExecutionOptions>,
) -> ToolsExecuteResult {
    let started = Instant::now();
    let tool_call_id = bash_options
        .as_ref()
        .map(|options| options.tool_call_id.clone())
        .unwrap_or_else(|| "local".into());
    let command_shell_id = bash_options
        .as_ref()
        .map(|options| options.command_shell_id.clone());
    // Scratch is created lazily, and only for tools that can produce files
    // there — Read/Glob/Grep on a session that never wrote scratch files
    // should not leave empty directories behind.
    if matches!(tool_name, "Write" | "Edit" | "Bash") {
        if let Some(dir) = scratch {
            let _ = std::fs::create_dir_all(dir);
        }
    }
    let result = match tool_name {
        "Read" => tool_read(workspace, scratch, args),
        "Glob" => tool_glob(workspace, args),
        "Grep" => tool_grep(workspace, args),
        "Write" => tool_write(workspace, scratch, args),
        "Edit" => tool_edit(workspace, scratch, args),
        "Bash" => {
            let options = bash_options.unwrap_or_else(|| {
                let id = shell::catalog(None)
                    .effective
                    .map(|option| option.id)
                    .unwrap_or_else(|| shell::default_shell_id().to_string());
                BashExecutionOptions::local(id, timeout_ms)
            });
            tool_bash(workspace, scratch, args, options).await
        }
        other if other.starts_with("plugin_") => Err((
            "TOOL_NOT_FOUND".into(),
            format!(
                "plugin tool {other} requires the desktop runner (dispatched via plugins.execute)"
            ),
        )),
        other => Err(("TOOL_NOT_FOUND".into(), format!("unknown tool: {other}"))),
    };

    match result {
        Ok(content) => ToolsExecuteResult {
            tool_call_id,
            ok: true,
            is_error: None,
            content,
            duration_ms: started.elapsed().as_millis() as u64,
            denied: None,
            error_code: None,
            command_shell_id,
        },
        Err((code, message)) => ToolsExecuteResult {
            tool_call_id,
            ok: false,
            is_error: Some(true),
            content: json!({ "error": message, "code": code }),
            duration_ms: started.elapsed().as_millis() as u64,
            denied: Some(code == "TOOL_DENIED" || code == "PATH_OUTSIDE_WORKSPACE"),
            error_code: Some(code),
            command_shell_id,
        },
    }
}

fn require_workspace(workspace: Option<&Path>) -> Result<&Path, (String, String)> {
    workspace.ok_or_else(|| ("WORKSPACE_REQUIRED".into(), "No workspace is open".into()))
}

/// Path shown to the model and recorded downstream: workspace files keep the
/// familiar workspace-relative form; scratch files stay absolute so they are
/// unambiguous (the model addresses scratch by absolute path only).
fn display_tool_path(root_kind: ToolRoot, workspace_root: &Path, resolved: &Path) -> String {
    match root_kind {
        ToolRoot::Workspace => relative_display(workspace_root, resolved),
        ToolRoot::Scratch => resolved.to_string_lossy().to_string(),
    }
}

fn root_label(root_kind: ToolRoot) -> &'static str {
    match root_kind {
        ToolRoot::Workspace => "workspace",
        ToolRoot::Scratch => "scratch",
    }
}

fn tool_read(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    args: &Value,
) -> Result<Value, (String, String)> {
    let root = require_workspace(workspace)?;
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("INVALID_ARGUMENT".into(), "path required".into()))?;
    let (resolved, root_kind) =
        resolve_tool_path(root, scratch, path).map_err(|e| (e.clone(), e))?;
    const MAX_READ_BYTES: u64 = 512 * 1024;
    if let Ok(meta) = std::fs::metadata(&resolved) {
        if meta.len() > MAX_READ_BYTES {
            return Err((
                "TOOL_FAILED".into(),
                format!(
                    "file too large for Read ({} bytes > {} limit); use Grep or Bash to sample it",
                    meta.len(),
                    MAX_READ_BYTES
                ),
            ));
        }
    }
    let content = std::fs::read_to_string(&resolved)
        .map_err(|e| ("TOOL_FAILED".into(), format!("read failed: {e}")))?;
    let (content, truncated) = truncate_output(&content);
    Ok(json!({
        "path": display_tool_path(root_kind, root, &resolved),
        "root": root_label(root_kind),
        "content": content,
        "truncated": truncated,
    }))
}

fn tool_write(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    args: &Value,
) -> Result<Value, (String, String)> {
    let root = require_workspace(workspace)?;
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("INVALID_ARGUMENT".into(), "path required".into()))?;
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("INVALID_ARGUMENT".into(), "content required".into()))?;
    let (resolved, root_kind) =
        resolve_tool_path(root, scratch, path).map_err(|e| (e.clone(), e))?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| ("TOOL_FAILED".into(), format!("mkdir failed: {e}")))?;
    }
    std::fs::write(&resolved, content)
        .map_err(|e| ("TOOL_FAILED".into(), format!("write failed: {e}")))?;
    Ok(json!({
        "path": display_tool_path(root_kind, root, &resolved),
        "root": root_label(root_kind),
        "bytes": content.len(),
    }))
}

fn tool_edit(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    args: &Value,
) -> Result<Value, (String, String)> {
    let root = require_workspace(workspace)?;
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("INVALID_ARGUMENT".into(), "path required".into()))?;
    let old_str = args
        .get("old_string")
        .or_else(|| args.get("oldString"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("INVALID_ARGUMENT".into(), "old_string required".into()))?;
    let new_str = args
        .get("new_string")
        .or_else(|| args.get("newString"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("INVALID_ARGUMENT".into(), "new_string required".into()))?;
    let (resolved, root_kind) =
        resolve_tool_path(root, scratch, path).map_err(|e| (e.clone(), e))?;
    let original = std::fs::read_to_string(&resolved)
        .map_err(|e| ("TOOL_FAILED".into(), format!("read failed: {e}")))?;
    if !original.contains(old_str) {
        return Err(("TOOL_FAILED".into(), "old_string not found in file".into()));
    }
    let updated = original.replacen(old_str, new_str, 1);
    std::fs::write(&resolved, &updated)
        .map_err(|e| ("TOOL_FAILED".into(), format!("write failed: {e}")))?;
    Ok(json!({
        "path": display_tool_path(root_kind, root, &resolved),
        "root": root_label(root_kind),
        "replacements": 1,
    }))
}

fn tool_glob(workspace: Option<&Path>, args: &Value) -> Result<Value, (String, String)> {
    let root = require_workspace(workspace)?;
    let pattern = args
        .get("pattern")
        .and_then(|v| v.as_str())
        .unwrap_or("**/*");
    let glob = globset::GlobBuilder::new(pattern)
        .literal_separator(true)
        .build()
        .map_err(|e| ("INVALID_ARGUMENT".into(), e.to_string()))?;
    let mut set = globset::GlobSetBuilder::new();
    set.add(glob);
    let set = set
        .build()
        .map_err(|e| ("INVALID_ARGUMENT".into(), e.to_string()))?;

    let mut matches = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .build();
    for entry in walker.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(path);
        if set.is_match(rel) {
            matches.push(rel.to_string_lossy().to_string());
            if matches.len() >= 2000 {
                break;
            }
        }
    }
    matches.sort();
    Ok(json!({ "matches": matches, "count": matches.len() }))
}

fn tool_grep(workspace: Option<&Path>, args: &Value) -> Result<Value, (String, String)> {
    let root = require_workspace(workspace)?;
    let pattern = args
        .get("pattern")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("INVALID_ARGUMENT".into(), "pattern required".into()))?;
    let re = RegexBuilder::new(pattern)
        .case_insensitive(
            args.get("caseInsensitive")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        )
        .build()
        .map_err(|e| ("INVALID_ARGUMENT".into(), e.to_string()))?;

    let mut hits = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .build();
    for entry in walker.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for (idx, line) in content.lines().enumerate() {
            if re.is_match(line) {
                let rel = path.strip_prefix(root).unwrap_or(path);
                hits.push(json!({
                    "path": rel.to_string_lossy(),
                    "line": idx + 1,
                    "text": line,
                }));
                if hits.len() >= 200 {
                    break;
                }
            }
        }
        if hits.len() >= 200 {
            break;
        }
    }
    Ok(json!({ "matches": hits, "count": hits.len() }))
}

#[derive(Debug, Clone, Copy)]
enum OutputStream {
    Stdout,
    Stderr,
}

impl OutputStream {
    fn as_str(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
        }
    }
}

#[derive(Debug)]
struct OutputChunk {
    stream: OutputStream,
    bytes: Vec<u8>,
}

#[derive(Debug, Default)]
struct Utf8Decoder {
    pending: Vec<u8>,
}

impl Utf8Decoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut output = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    output.push_str(text);
                    self.pending.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    if valid > 0 {
                        output.push_str(
                            std::str::from_utf8(&self.pending[..valid])
                                .expect("valid UTF-8 prefix"),
                        );
                        self.pending.drain(..valid);
                        continue;
                    }
                    if let Some(error_len) = error.error_len() {
                        output.push('\u{FFFD}');
                        self.pending.drain(..error_len.max(1));
                        continue;
                    }
                    // An incomplete code point is retained for the next pipe
                    // chunk, so a notification never splits valid UTF-8.
                    break;
                }
            }
        }
        output
    }

    fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let output = String::from_utf8_lossy(&self.pending).to_string();
        self.pending.clear();
        output
    }
}

#[derive(Debug, Default)]
struct CapturedOutput {
    bytes: Vec<u8>,
    decoder: Utf8Decoder,
    retained_lines: usize,
    omitted_bytes: u64,
    omitted_lines: u64,
    truncated: bool,
}

impl CapturedOutput {
    fn push(&mut self, bytes: &[u8]) -> String {
        let decoded = self.decoder.push(bytes);
        self.retain(&decoded);
        decoded
    }

    fn finish(&mut self) -> String {
        let decoded = self.decoder.finish();
        self.retain(&decoded);
        decoded
    }

    fn retain(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        if self.truncated && self.bytes.len() >= MAX_RESULT_BYTES {
            self.note_omitted(text);
            return;
        }

        let mut text_end = text.len();
        let mut lines = self.retained_lines;
        if lines >= MAX_RESULT_LINES {
            text_end = 0;
        } else {
            for (index, character) in text.char_indices() {
                if character == '\n' {
                    lines += 1;
                    if lines >= MAX_RESULT_LINES {
                        text_end = index + character.len_utf8();
                        break;
                    }
                }
            }
        }

        let capacity = MAX_RESULT_BYTES.saturating_sub(self.bytes.len());
        let mut byte_end = text_end.min(capacity);
        while byte_end > 0 && !text.is_char_boundary(byte_end) {
            byte_end -= 1;
        }
        self.bytes.extend_from_slice(text.as_bytes().get(..byte_end).unwrap_or_default());
        self.retained_lines += text[..byte_end].bytes().filter(|byte| *byte == b'\n').count();

        if byte_end < text.len() {
            self.truncated = true;
            self.note_omitted(&text[byte_end..]);
        }
    }

    fn note_omitted(&mut self, text: &str) {
        self.omitted_bytes = self.omitted_bytes.saturating_add(text.len() as u64);
        self.omitted_lines = self.omitted_lines.saturating_add(
            text.bytes().filter(|byte| *byte == b'\n').count() as u64
                + u64::from(!text.is_empty() && !text.ends_with('\n')),
        );
    }

    fn result(&self) -> (String, bool) {
        let mut text = String::from_utf8_lossy(&self.bytes).to_string();
        if self.truncated {
            text.push_str(&format!(
                "\n\n[truncated: output exceeded 256KB or 4000 lines; omitted {} bytes and {} lines]",
                self.omitted_bytes, self.omitted_lines
            ));
        }
        (text, self.truncated)
    }
}

#[derive(Debug)]
struct OutputNotifier {
    tx: Option<mpsc::UnboundedSender<String>>,
    session_id: String,
    tool_call_id: String,
    command_shell_id: String,
    stdout: String,
    stderr: String,
    sent: usize,
    dropped_bytes: u64,
    dropped_lines: u64,
    last_emit: Instant,
}

impl OutputNotifier {
    fn new(options: &BashExecutionOptions) -> Self {
        Self {
            tx: options.output_tx.clone(),
            session_id: options.session_id.clone(),
            tool_call_id: options.tool_call_id.clone(),
            command_shell_id: options.command_shell_id.clone(),
            stdout: String::new(),
            stderr: String::new(),
            sent: 0,
            dropped_bytes: 0,
            dropped_lines: 0,
            last_emit: Instant::now(),
        }
    }

    fn push(&mut self, stream: OutputStream, chunk: String) {
        if chunk.is_empty() {
            return;
        }
        if self.tx.is_none() || self.sent >= MAX_OUTPUT_NOTIFICATIONS {
            self.note_dropped(&chunk);
            return;
        }
        let pending = match stream {
            OutputStream::Stdout => &mut self.stdout,
            OutputStream::Stderr => &mut self.stderr,
        };
        pending.push_str(&chunk);
        if pending.len() >= OUTPUT_NOTIFICATION_MAX_CHUNK_BYTES
            || self.last_emit.elapsed() >= OUTPUT_NOTIFICATION_INTERVAL
        {
            self.flush_stream(stream);
        }
    }

    fn flush_stream(&mut self, stream: OutputStream) {
        let pending = match stream {
            OutputStream::Stdout => &mut self.stdout,
            OutputStream::Stderr => &mut self.stderr,
        };
        if pending.is_empty() {
            return;
        }
        if self.sent >= MAX_OUTPUT_NOTIFICATIONS {
            let dropped = std::mem::take(pending);
            self.note_dropped(&dropped);
            return;
        }
        let chunk = std::mem::take(pending);
        let notification = json!({
            "jsonrpc": "2.0",
            "method": "tools.output",
            "params": {
                "sessionId": self.session_id,
                "toolCallId": self.tool_call_id,
                "commandShellId": self.command_shell_id,
                "stream": stream.as_str(),
                "chunk": chunk,
            }
        });
        if let (Some(tx), Ok(raw)) = (self.tx.as_ref(), serde_json::to_string(&notification)) {
            let _ = tx.send(format!("{raw}\n"));
            self.sent += 1;
            self.last_emit = Instant::now();
        }
    }

    fn note_dropped(&mut self, text: &str) {
        self.dropped_bytes = self.dropped_bytes.saturating_add(text.len() as u64);
        self.dropped_lines = self.dropped_lines.saturating_add(
            text.bytes().filter(|byte| *byte == b'\n').count() as u64
                + u64::from(!text.is_empty() && !text.ends_with('\n')),
        );
    }

    fn finish(&mut self) {
        self.flush_stream(OutputStream::Stdout);
        self.flush_stream(OutputStream::Stderr);
        if self.dropped_bytes == 0 || self.sent >= MAX_OUTPUT_NOTIFICATIONS {
            return;
        }
        let marker = format!(
            "\n\n[tool output notifications truncated: omitted {} bytes and {} lines]",
            self.dropped_bytes, self.dropped_lines
        );
        self.stdout.push_str(&marker);
        self.flush_stream(OutputStream::Stdout);
    }

    fn flush_due(&mut self) {
        if self.last_emit.elapsed() < OUTPUT_NOTIFICATION_INTERVAL {
            return;
        }
        self.flush_stream(OutputStream::Stdout);
        self.flush_stream(OutputStream::Stderr);
    }
}

async fn read_pipe<R>(pipe: Option<R>, stream: OutputStream, tx: mpsc::Sender<OutputChunk>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let Some(mut pipe) = pipe else {
        return;
    };
    let mut buffer = [0u8; 8192];
    loop {
        match pipe.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => {
                if tx
                    .send(OutputChunk {
                        stream,
                        bytes: buffer[..read].to_vec(),
                    })
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn process_output_chunk(
    chunk: OutputChunk,
    stdout: &mut CapturedOutput,
    stderr: &mut CapturedOutput,
    notifier: &mut OutputNotifier,
) {
    let decoded = match chunk.stream {
        OutputStream::Stdout => stdout.push(&chunk.bytes),
        OutputStream::Stderr => stderr.push(&chunk.bytes),
    };
    notifier.push(chunk.stream, decoded);
}

async fn wait_for_cancellation(receiver: &mut Option<watch::Receiver<bool>>) -> bool {
    let Some(receiver) = receiver.as_mut() else {
        return pending::<bool>().await;
    };
    if *receiver.borrow() {
        return true;
    }
    loop {
        if receiver.changed().await.is_err() {
            return pending::<bool>().await;
        }
        if *receiver.borrow() {
            return true;
        }
    }
}

async fn kill_process_tree(pid: u32, ownership: &ProcessOwnership) {
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        if ownership.terminate() {
            return;
        }
        // The helper is fully detached from the host's stdio. Without these
        // handles taskkill can inherit stdout and corrupt the RPC stream.
        let mut taskkill = Command::new("taskkill");
        taskkill
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = taskkill.status().await;
    }
    #[cfg(unix)]
    {
        let _ = ownership;
        let process_group = format!("-{pid}");
        let _ = Command::new("kill")
            .args(["-KILL", process_group.as_str()])
            .status()
            .await;
    }
}

async fn kill_and_reap(
    pid: u32,
    ownership: &ProcessOwnership,
    wait_task: &mut tokio::task::JoinHandle<std::io::Result<ExitStatus>>,
) {
    kill_process_tree(pid, ownership).await;
    if tokio::time::timeout(PROCESS_TERMINATION_TIMEOUT, &mut *wait_task)
        .await
        .is_err()
    {
        wait_task.abort();
    }
}

async fn drain_output(
    output_rx: &mut mpsc::Receiver<OutputChunk>,
    output_closed: &mut bool,
    stdout: &mut CapturedOutput,
    stderr: &mut CapturedOutput,
    notifier: &mut OutputNotifier,
    stdout_task: &mut tokio::task::JoinHandle<()>,
    stderr_task: &mut tokio::task::JoinHandle<()>,
    pid: u32,
    ownership: &ProcessOwnership,
) {
    let drain = async {
        while let Some(chunk) = output_rx.recv().await {
            process_output_chunk(chunk, stdout, stderr, notifier);
        }
        *output_closed = true;
    };
    if tokio::time::timeout(PIPE_DRAIN_TIMEOUT, drain)
        .await
        .is_err()
    {
        kill_process_tree(pid, ownership).await;
        stdout_task.abort();
        stderr_task.abort();
    } else {
        let _ = stdout_task.await;
        let _ = stderr_task.await;
    }
}

enum BashStop {
    Exited(Result<Result<ExitStatus, std::io::Error>, tokio::task::JoinError>),
    TimedOut,
    Aborted,
}

async fn tool_bash(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    args: &Value,
    options: BashExecutionOptions,
) -> Result<Value, (String, String)> {
    validate_timeout_ms(options.timeout_ms)?;
    let root = require_workspace(workspace)?;
    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("INVALID_ARGUMENT".into(), "command required".into()))?;

    let resolved = shell::resolve_shell(&options.command_shell_id)
        .map_err(|message| ("SHELL_NOT_FOUND".to_string(), message))?;
    let invocation = shell::build_invocation_for_platform(
        shell::current_platform(),
        &options.command_shell_id,
        resolved.program,
        command,
    )
    .map_err(|message| {
        let code = if message.contains("NUL") || message.contains("too long") {
            "INVALID_ARGUMENT"
        } else {
            "SHELL_NOT_FOUND"
        };
        (code.into(), message)
    })?;

    let mut cmd = Command::new(&invocation.program);
    cmd.args(&invocation.args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(scratch_dir) = scratch {
        // Shell commands drop temp files via $PI_SCRATCH_DIR instead of the
        // workspace (D114); the dir was created by execute_tool above.
        cmd.env("PI_SCRATCH_DIR", scratch_dir);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: shell.exe must not flash a console over the GUI.
        cmd.creation_flags(0x0800_0000);
    }
    #[cfg(unix)]
    {
        // A process group lets cancellation terminate descendants that would
        // otherwise retain the output pipes after the shell exits.
        cmd.process_group(0);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| ("TOOL_FAILED".into(), format!("bash spawn failed: {e}")))?;
    let pid = child.id().unwrap_or_default();
    let ownership = ProcessOwnership::assign(&child);

    // Drain both pipes in small chunks while the child is running. Waiting for
    // the process first can deadlock once a command exceeds the OS pipe size.
    let (chunk_tx, mut output_rx) = mpsc::channel(OUTPUT_CHANNEL_CAPACITY);
    let stdout_task = tokio::spawn(read_pipe(child.stdout.take(), OutputStream::Stdout, chunk_tx.clone()));
    let stderr_task = tokio::spawn(read_pipe(child.stderr.take(), OutputStream::Stderr, chunk_tx.clone()));
    drop(chunk_tx);

    let mut wait_task = tokio::spawn(async move { child.wait().await });
    let timeout_future = async {
        match options.timeout_ms {
            Some(timeout_ms) => tokio::time::sleep(Duration::from_millis(timeout_ms)).await,
            None => pending::<()>().await,
        }
    };
    tokio::pin!(timeout_future);
    let mut cancellation = options.cancellation.clone();
    let mut stdout = CapturedOutput::default();
    let mut stderr = CapturedOutput::default();
    let mut notifier = OutputNotifier::new(&options);
    let mut output_tick = tokio::time::interval(OUTPUT_NOTIFICATION_INTERVAL);
    let mut output_closed = false;

    let stop = loop {
        tokio::select! {
            waited = &mut wait_task => {
                break BashStop::Exited(waited);
            }
            chunk = output_rx.recv(), if !output_closed => {
                match chunk {
                    Some(chunk) => process_output_chunk(chunk, &mut stdout, &mut stderr, &mut notifier),
                    None => output_closed = true,
                }
            }
            _ = output_tick.tick() => {
                notifier.flush_due();
            }
            _ = &mut timeout_future => {
                kill_and_reap(pid, &ownership, &mut wait_task).await;
                break BashStop::TimedOut;
            }
            cancelled = wait_for_cancellation(&mut cancellation) => {
                if cancelled {
                    kill_and_reap(pid, &ownership, &mut wait_task).await;
                    break BashStop::Aborted;
                }
            }
        }
    };

    let mut stdout_task = stdout_task;
    let mut stderr_task = stderr_task;
    drain_output(
        &mut output_rx,
        &mut output_closed,
        &mut stdout,
        &mut stderr,
        &mut notifier,
        &mut stdout_task,
        &mut stderr_task,
        pid,
        &ownership,
    )
    .await;
    notifier.push(OutputStream::Stdout, stdout.finish());
    notifier.push(OutputStream::Stderr, stderr.finish());
    notifier.finish();

    match stop {
        BashStop::TimedOut => Err(("TOOL_TIMEOUT".into(), "bash timed out".into())),
        BashStop::Aborted => Err(("TOOL_ABORTED".into(), "bash aborted".into())),
        BashStop::Exited(waited) => {
            let status = waited
                .map_err(|error| ("TOOL_FAILED".into(), format!("bash wait failed: {error}")))?
                .map_err(|error| ("TOOL_FAILED".into(), format!("bash failed: {error}")))?;
            let (stdout, trunc_out) = stdout.result();
            let (stderr, trunc_err) = stderr.result();
            Ok(json!({
                "exitCode": status.code(),
                "stdout": stdout,
                "stderr": stderr,
                "truncated": trunc_out || trunc_err,
                "commandShellId": options.command_shell_id,
            }))
        }
    }
}

fn relative_display(root: &Path, path: &Path) -> String {
    // `path` comes back canonicalized from the resolver; strip against the
    // canonical root spelling too, or symlinked roots (macOS /var vs
    // /private/var) would render absolute.
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    path.strip_prefix(&canonical_root)
        .or_else(|_| path.strip_prefix(root))
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

pub fn builtin_tool_defs() -> Value {
    json!([
        {
            "name": "Read",
            "description": "Read a file inside the workspace or the session scratch directory",
            "risk": "low",
            "parameters": {
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"]
            }
        },
        {
            "name": "Glob",
            "description": "List files by glob pattern inside the workspace",
            "risk": "low",
            "parameters": {
                "type": "object",
                "properties": { "pattern": { "type": "string" } },
                "required": ["pattern"]
            }
        },
        {
            "name": "Grep",
            "description": "Search file contents inside the workspace",
            "risk": "low",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "caseInsensitive": { "type": "boolean" }
                },
                "required": ["pattern"]
            }
        },
        {
            "name": "Write",
            "description": "Create or overwrite a file inside the workspace or the session scratch directory",
            "risk": "high",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"]
            }
        },
        {
            "name": "Edit",
            "description": "Replace text in a workspace or scratch-directory file",
            "risk": "high",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "old_string": { "type": "string" },
                    "new_string": { "type": "string" }
                },
                "required": ["path", "old_string", "new_string"]
            }
        },
        {
            "name": "Bash",
            "description": "Run a non-interactive shell command in the workspace",
            "risk": "high",
            "parameters": {
                "type": "object",
                "properties": { "command": { "type": "string" } },
                "required": ["command"]
            }
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bash_large_output_does_not_deadlock() {
        // >64KB (OS pipe buffer) must not deadlock the child; reader tasks
        // drain concurrently with wait(). Single line to stay under the
        // 4000-line truncation and prove full drainage.
        let dir = tempfile::tempdir().unwrap();
        #[cfg(windows)]
        let command = "[Console]::Out.Write('a' * 200000)";
        #[cfg(not(windows))]
        let command = "head -c 200000 /dev/zero | tr '\\0' 'a'";
        let result = execute_tool(
            Some(dir.path()),
            None,
            "Bash",
            &serde_json::json!({ "command": command }),
            15_000,
        )
        .await;
        assert!(result.ok, "bash tool failed: {:?}", result.content);
        let stdout = result.content["stdout"].as_str().unwrap_or_default();
        assert_eq!(stdout.len(), 200_000, "stdout fully drained");
    }

    #[tokio::test]
    async fn read_refuses_oversized_file() {
        let dir = tempfile::tempdir().unwrap();
        let big = dir.path().join("big.txt");
        std::fs::write(&big, "a".repeat(600 * 1024)).unwrap();
        let result = execute_tool(
            Some(dir.path()),
            None,
            "Read",
            &serde_json::json!({ "path": "big.txt" }),
            5_000,
        )
        .await;
        assert!(!result.ok);
        assert_eq!(result.error_code.as_deref(), Some("TOOL_FAILED"));
    }

    #[tokio::test]
    async fn write_and_read_in_scratch_root() {
        let ws = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        // Not created up front: execute_tool creates it lazily for Write.
        let scratch = data.path().join("scratch/session-1");
        let target = scratch.join("notes/tmp.txt");
        let write = execute_tool(
            Some(ws.path()),
            Some(&scratch),
            "Write",
            &serde_json::json!({ "path": target.to_str().unwrap(), "content": "scratch!" }),
            5_000,
        )
        .await;
        assert!(write.ok, "scratch write failed: {:?}", write.content);
        assert_eq!(write.content["root"].as_str(), Some("scratch"));
        // Workspace stayed clean.
        assert_eq!(std::fs::read_dir(ws.path()).unwrap().count(), 0);

        let read = execute_tool(
            Some(ws.path()),
            Some(&scratch),
            "Read",
            &serde_json::json!({ "path": target.to_str().unwrap() }),
            5_000,
        )
        .await;
        assert!(read.ok, "scratch read failed: {:?}", read.content);
        assert_eq!(read.content["content"].as_str(), Some("scratch!"));
        assert_eq!(read.content["root"].as_str(), Some("scratch"));
    }

    #[tokio::test]
    async fn workspace_write_reports_workspace_root() {
        let ws = tempfile::tempdir().unwrap();
        let scratch = tempfile::tempdir().unwrap();
        let result = execute_tool(
            Some(ws.path()),
            Some(scratch.path()),
            "Write",
            &serde_json::json!({ "path": "a.txt", "content": "hi" }),
            5_000,
        )
        .await;
        assert!(result.ok);
        assert_eq!(result.content["root"].as_str(), Some("workspace"));
        assert_eq!(result.content["path"].as_str(), Some("a.txt"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bash_exposes_scratch_dir_env() {
        let ws = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let scratch = data.path().join("scratch/session-2");
        let result = execute_tool(
            Some(ws.path()),
            Some(&scratch),
            "Bash",
            &serde_json::json!({ "command": "printf %s \"$PI_SCRATCH_DIR\"" }),
            15_000,
        )
        .await;
        assert!(result.ok, "bash failed: {:?}", result.content);
        assert_eq!(
            result.content["stdout"].as_str(),
            Some(scratch.to_str().unwrap())
        );
        assert!(scratch.is_dir(), "scratch dir created for Bash");
    }

    #[tokio::test]
    async fn bash_output_accumulator_is_bounded_and_reports_omissions() {
        let dir = tempfile::tempdir().unwrap();
        #[cfg(windows)]
        let command = "[Console]::Out.Write(('x' * 600000) -join '')";
        #[cfg(not(windows))]
        let command = "head -c 600000 /dev/zero | tr '\\0' 'x'";
        let shell_id = shell::catalog(None)
            .effective
            .expect("test platform must have a command shell")
            .id;
        let result = execute_tool_with_options(
            Some(dir.path()),
            None,
            "Bash",
            &serde_json::json!({ "command": command }),
            Some(15_000),
            Some(BashExecutionOptions {
                session_id: "bounded-session".into(),
                tool_call_id: "bounded-call".into(),
                command_shell_id: shell_id,
                timeout_ms: Some(15_000),
                cancellation: None,
                output_tx: None,
            }),
        )
        .await;
        assert!(result.ok, "bounded output failed: {:?}", result.content);
        assert_eq!(result.content["truncated"], true);
        let stdout = result.content["stdout"].as_str().unwrap_or_default();
        assert!(stdout.contains("[truncated: output exceeded 256KB or 4000 lines; omitted"));
        assert!(stdout.len() < MAX_RESULT_BYTES + 200);
    }

    #[test]
    fn output_notifications_have_a_per_call_cap() {
        let (tx, rx) = mpsc::unbounded_channel();
        let options = BashExecutionOptions {
            session_id: "notification-session".into(),
            tool_call_id: "notification-call".into(),
            command_shell_id: shell::default_shell_id().into(),
            timeout_ms: None,
            cancellation: None,
            output_tx: Some(tx),
        };
        let mut notifier = OutputNotifier::new(&options);
        for _ in 0..(MAX_OUTPUT_NOTIFICATIONS + 100) {
            notifier.push(
                OutputStream::Stdout,
                "x".repeat(OUTPUT_NOTIFICATION_MAX_CHUNK_BYTES),
            );
        }
        notifier.finish();
        assert!(rx.len() <= MAX_OUTPUT_NOTIFICATIONS);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn powershell_preserves_utf8_errors_quotes_cwd_and_native_exit_codes() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("cwd with spaces");
        std::fs::create_dir_all(&workspace).unwrap();
        let options = || BashExecutionOptions {
            session_id: "powershell-session".into(),
            tool_call_id: "powershell-call".into(),
            command_shell_id: shell::WINDOWS_POWERSHELL_ID.into(),
            timeout_ms: Some(5_000),
            cancellation: None,
            output_tx: None,
        };

        let output = execute_tool_with_options(
            Some(&workspace),
            None,
            "Bash",
            &serde_json::json!({
                "command": "[Console]::Out.Write('stdout π \"quoted\" & <meta>'); [Console]::Error.Write('stderr π \"quoted\" & <meta>')"
            }),
            Some(5_000),
            Some(options()),
        )
        .await;
        assert!(output.ok, "PowerShell output failed: {:?}", output.content);
        assert!(output.content["stdout"].as_str().unwrap().contains("stdout π"));
        assert!(output.content["stderr"].as_str().unwrap().contains("stderr π"));
        assert!(output.content["stdout"].as_str().unwrap().contains("<meta>"));

        let cwd = execute_tool_with_options(
            Some(&workspace),
            None,
            "Bash",
            &serde_json::json!({ "command": "[Console]::Out.Write((Get-Location).Path)" }),
            Some(5_000),
            Some(options()),
        )
        .await;
        assert!(cwd.ok, "PowerShell cwd failed: {:?}", cwd.content);
        let cwd_stdout = cwd.content["stdout"].as_str().unwrap_or_default();
        let normalize_windows_path = |path: &str| {
            path.trim()
                .replace("\\\\?\\", "")
                .replace('/', "\\")
        };
        assert!(
            normalize_windows_path(cwd_stdout).ends_with("\\cwd with spaces"),
            "cwd stdout={cwd_stdout:?}, expected suffix for {:?}",
            workspace
        );

        let error = execute_tool_with_options(
            Some(&workspace),
            None,
            "Bash",
            &serde_json::json!({
                "command": "Get-Item -LiteralPath 'missing file for pi desktop'"
            }),
            Some(5_000),
            Some(options()),
        )
        .await;
        assert_eq!(error.content["exitCode"], 1);
        let stderr = error.content["stderr"].as_str().unwrap_or_default();
        assert!(
            stderr.contains("missing file for pi desktop"),
            "PowerShell error text was {stderr:?}"
        );
        assert!(!stderr.contains("CLIXML"));
        assert!(!stderr.contains("<Objs"));

        let native = execute_tool_with_options(
            Some(&workspace),
            None,
            "Bash",
            &serde_json::json!({ "command": "cmd /c exit 7" }),
            Some(5_000),
            Some(options()),
        )
        .await;
        assert_eq!(native.content["exitCode"], 7);
    }
}
