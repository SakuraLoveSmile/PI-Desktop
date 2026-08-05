use anyhow::Result;
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufRead, BufReader, ErrorKind};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use crate::workspace::{resolve_tool_path, ToolRoot};

pub mod shell;

/// Which end of an over-budget payload survives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Head,
    Tail,
}

/// Per-tool output budget (spec 03-runtime/16).
///
/// One shared 256KB cap used to govern every tool, which in practice meant no
/// cap at all: measured sessions averaged 154KB per `Read` and spent 56% of
/// their whole context on read/search results, which then forced compaction
/// and re-searching. Search and read results get the tighter budget because
/// they are re-fetchable on demand; shell output is not.
#[derive(Debug, Clone, Copy)]
pub struct OutputBudget {
    pub max_bytes: usize,
    pub max_lines: usize,
    pub direction: Direction,
}

/// Read / Glob / Grep.
pub const BUDGET_SEARCH: OutputBudget = OutputBudget {
    max_bytes: 48 * 1024,
    max_lines: 2000,
    direction: Direction::Head,
};

/// Bash stdout: a command's output is usually the whole point of the call and
/// cannot be re-derived by narrowing a pattern, so it keeps a larger share.
pub const BUDGET_SHELL: OutputBudget = OutputBudget {
    max_bytes: 96 * 1024,
    max_lines: 4000,
    direction: Direction::Head,
};

/// Bash stderr keeps the tail: when a command fails, the actionable message is
/// the last thing it printed. Dropping it to retain 96KB of progress noise is
/// exactly what makes the model retry blindly.
pub const BUDGET_SHELL_ERR: OutputBudget = OutputBudget {
    max_bytes: 96 * 1024,
    max_lines: 4000,
    direction: Direction::Tail,
};

/// Upper bound on a spilled full-output copy. Bounded for two reasons: the
/// buffer is held in host memory before it lands on disk, and a runaway
/// command must not fill the user's disk. 512KB covers the realistic "grep the
/// full log" follow-up.
pub const SPILL_MAX_BYTES: usize = 512 * 1024;

/// Longest single line any tool hands to the model. Minified bundles and
/// sourcemaps are routinely one multi-megabyte line; before this cap a single
/// Grep hit could carry tens of KB of it.
pub const MAX_LINE_CHARS: usize = 2000;

/// Read window when the caller does not ask for one.
const DEFAULT_READ_LINES: usize = 2000;

/// Grep hits returned when the caller does not ask for a limit.
const GREP_DEFAULT_HEAD_LIMIT: usize = 200;

/// Bound on the file list Grep sorts before scanning, so a pathological tree
/// cannot make the candidate pass itself unbounded.
const GREP_MAX_CANDIDATE_FILES: usize = 20_000;

/// Glob entries returned when the caller does not ask for a limit, and the
/// ceiling it may ask for.
const GLOB_DEFAULT_LIMIT: usize = 100;
const GLOB_MAX_LIMIT: usize = 1000;

/// Extensions we refuse to read as text even when the byte sniff is
/// inconclusive (a short archive header can look printable).
const BINARY_EXTENSIONS: &[&str] = &[
    "7z", "a", "bin", "class", "dat", "dll", "doc", "docx", "dylib", "exe", "gz", "ico", "jar",
    "lib", "o", "obj", "odp", "ods", "odt", "pdf", "png", "ppt", "pptx", "pyc", "pyo", "so", "tar",
    "wasm", "war", "webp", "xls", "xlsx", "zip",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsExecuteParams {
    pub session_id: String,
    pub turn_id: Option<String>,
    pub tool_call_id: String,
    pub tool_name: String,
    pub args: Value,
    pub mode: String,
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
}

fn fits(text: &str, budget: OutputBudget) -> bool {
    text.len() <= budget.max_bytes && text.lines().count() <= budget.max_lines
}

/// Truncate to `budget`, first spilling the fuller copy under `scratch` so the
/// marker can point the model at something it can Grep instead of re-running
/// the command. Best-effort: a failed spill costs the hint, never the result.
fn truncate_with_spill(
    text: &str,
    budget: OutputBudget,
    scratch: Option<&Path>,
    label: &str,
) -> (String, bool) {
    if fits(text, budget) {
        return (text.to_string(), false);
    }
    let spilled = spill_output(scratch, label, text);
    (truncate_to(text, budget, spilled.as_deref()), true)
}

fn truncate_to(text: &str, budget: OutputBudget, spilled: Option<&Path>) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let window: &[&str] = match budget.direction {
        Direction::Head => &lines[..lines.len().min(budget.max_lines)],
        Direction::Tail => &lines[lines.len().saturating_sub(budget.max_lines)..],
    };

    let mut kept: Vec<&str> = Vec::new();
    let mut bytes = 0_usize;
    let mut single_line_clip = None;
    match budget.direction {
        Direction::Head => {
            for line in window {
                let size = line.len() + usize::from(!kept.is_empty());
                if bytes + size > budget.max_bytes {
                    break;
                }
                kept.push(line);
                bytes += size;
            }
        }
        Direction::Tail => {
            for line in window.iter().rev() {
                let size = line.len() + usize::from(!kept.is_empty());
                if bytes + size > budget.max_bytes {
                    break;
                }
                kept.push(line);
                bytes += size;
            }
            kept.reverse();
        }
    }

    // A single line longer than the entire budget (minified bundle, `tr`-style
    // one-shot output) fits no complete line, and returning nothing at all
    // would be worse than returning a prefix of it.
    if kept.is_empty() {
        if let Some(line) = match budget.direction {
            Direction::Head => window.first(),
            Direction::Tail => window.last(),
        } {
            let clipped = match budget.direction {
                Direction::Head => clip_head(line, budget.max_bytes),
                Direction::Tail => clip_tail(line, budget.max_bytes),
            };
            single_line_clip = Some(clipped.len());
            kept.push(clipped);
        }
    }

    let hint = match spilled {
        Some(path) => format!(
            " Full output saved to {} — Grep it, or Read it with offset/limit.",
            path.display()
        ),
        None => " Narrow the request to see more.".to_string(),
    };
    let marker = match single_line_clip {
        Some(bytes) => format!(
            "[truncated: no complete line fits the {}KB limit; kept {} bytes of a single {}-byte line.{}]",
            budget.max_bytes / 1024,
            bytes,
            match budget.direction {
                Direction::Head => window.first(),
                Direction::Tail => window.last(),
            }
            .map(|line| line.len())
            .unwrap_or(0),
            hint
        ),
        None => format!(
            "[truncated: kept the {} {} of {} lines; limit {} lines / {}KB.{}]",
            match budget.direction {
                Direction::Head => "first",
                Direction::Tail => "last",
            },
            kept.len(),
            lines.len(),
            budget.max_lines,
            budget.max_bytes / 1024,
            hint
        ),
    };

    let body = kept.join("\n");
    match budget.direction {
        Direction::Head => format!("{body}\n\n{marker}"),
        Direction::Tail => format!("{marker}\n\n{body}"),
    }
}

fn clip_head(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn clip_tail(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut start = text.len() - max_bytes;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

/// Monotonic within the process; the timestamp covers restarts, and the path is
/// already namespaced per session by the scratch dir.
static SPILL_SEQ: AtomicU64 = AtomicU64::new(0);

fn spill_output(scratch: Option<&Path>, label: &str, text: &str) -> Option<PathBuf> {
    // Created here rather than up front in execute_tool: a session whose
    // commands all stayed under budget should not get an empty directory.
    let dir = scratch?.join("tool-output");
    std::fs::create_dir_all(&dir).ok()?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or(0);
    let seq = SPILL_SEQ.fetch_add(1, Ordering::Relaxed);
    let path = dir.join(format!("{label}-{stamp}-{seq}.log"));
    match std::fs::write(&path, text) {
        Ok(()) => Some(path),
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "tool output spill failed");
            None
        }
    }
}

async fn read_capped<R: AsyncRead + Unpin>(reader: &mut R, cap: usize) -> Vec<u8> {
    let mut output = Vec::with_capacity(cap.min(8192));
    let mut buffer = [0_u8; 8192];
    while let Ok(read) = reader.read(&mut buffer).await {
        if read == 0 {
            break;
        }
        if output.len() < cap {
            let remaining = cap - output.len();
            output.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        // Continue draining after the cap so the child cannot block on a full
        // OS pipe. The retained prefix is enough to mark the result truncated
        // without allowing command output to exhaust host memory.
    }
    output
}

struct ScannedLine {
    text: String,
    /// The line was longer than the cap and got cut.
    clipped: bool,
}

/// Line reader that never materializes more than the per-line cap.
///
/// `read_to_string` (and `BufRead::read_until`) would pull a whole minified
/// bundle or sourcemap into memory just to throw almost all of it away, and
/// that is precisely the file shape the agent hits most often.
struct LineReader<R: BufRead> {
    reader: R,
}

impl LineReader<BufReader<File>> {
    fn open(path: &Path) -> std::io::Result<Self> {
        Ok(Self {
            reader: BufReader::with_capacity(64 * 1024, File::open(path)?),
        })
    }
}

impl<R: BufRead> LineReader<R> {
    /// Peek the buffered head of the stream and decide whether it is binary,
    /// without consuming anything. Cheaper than a second open, and it keeps
    /// Grep from matching lossy garbage inside object files.
    fn looks_binary(&mut self) -> bool {
        let Ok(head) = self.reader.fill_buf() else {
            return false;
        };
        if head.is_empty() {
            return false;
        }
        let sample = &head[..head.len().min(4096)];
        if sample.contains(&0) {
            return true;
        }
        // UTF-8 continuation bytes are >= 0x80, so text in any language stays
        // well under the threshold.
        let non_printable = sample
            .iter()
            .filter(|byte| **byte < 9 || (**byte > 13 && **byte < 32))
            .count();
        non_printable * 10 > sample.len() * 3
    }

    /// Next line with its trailing newline (and CR) stripped, clipped to
    /// `max_chars`. `Ok(None)` marks end of input.
    fn next_line(&mut self, max_chars: usize) -> std::io::Result<Option<ScannedLine>> {
        // Cap the raw read at the widest UTF-8 encoding of the char budget so
        // the char clip below never has to split a multi-byte sequence.
        let max_bytes = max_chars.saturating_mul(4);
        let mut buf: Vec<u8> = Vec::new();
        let mut clipped = false;
        let mut saw_input = false;
        loop {
            let chunk = match self.reader.fill_buf() {
                Ok(chunk) => chunk,
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            };
            if chunk.is_empty() {
                break;
            }
            saw_input = true;
            let newline = chunk.iter().position(|byte| *byte == b'\n');
            let take = newline.unwrap_or(chunk.len());
            let room = max_bytes.saturating_sub(buf.len());
            if take > room {
                buf.extend_from_slice(&chunk[..room]);
                clipped = true;
            } else {
                buf.extend_from_slice(&chunk[..take]);
            }
            self.reader
                .consume(newline.map(|idx| idx + 1).unwrap_or(take));
            if newline.is_some() {
                break;
            }
        }
        if !saw_input {
            return Ok(None);
        }
        if buf.last() == Some(&b'\r') {
            buf.pop();
        }
        let text = String::from_utf8_lossy(&buf).into_owned();
        let (text, char_clipped) = clip_chars(text, max_chars);
        Ok(Some(ScannedLine {
            text,
            clipped: clipped || char_clipped,
        }))
    }
}

fn clip_chars(text: String, max_chars: usize) -> (String, bool) {
    match text.char_indices().nth(max_chars) {
        Some((idx, _)) => (text[..idx].to_string(), true),
        None => (text, false),
    }
}

pub async fn execute_tool(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    tool_name: &str,
    args: &Value,
    timeout_ms: u64,
) -> ToolsExecuteResult {
    let started = Instant::now();
    let tool_call_id = "local".to_string();
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
        "Glob" => tool_glob(workspace, scratch, args),
        "Grep" => tool_grep(workspace, scratch, args),
        "Write" => tool_write(workspace, scratch, args),
        "Edit" => tool_edit(workspace, scratch, args),
        "Bash" => tool_bash(workspace, scratch, args, timeout_ms).await,
        other if other.starts_with("plugin_") => Err((
            "TOOL_NOT_FOUND".into(),
            format!(
                "plugin tool {other} requires the desktop runner (dispatched via plugins.execute)"
            ),
        )),
        other => Err(("TOOL_NOT_FOUND".into(), format!("unknown tool: {other}"))),
    };

    match result {
        Ok(content) => {
            // Preserve Bash stdout/stderr/exitCode for the model, but still
            // surface a non-zero command as a failed tool result. Previously
            // the shell process could exit 1/128 while the outer tool stayed
            // successful, which hid command failures from the UI and timing
            // logs and encouraged blind patch retries.
            let command_failed = tool_name == "Bash"
                && match content.get("exitCode") {
                    Some(Value::Number(code)) => code.as_i64() != Some(0),
                    Some(Value::Null) => true,
                    _ => false,
                };
            ToolsExecuteResult {
                tool_call_id,
                ok: !command_failed,
                is_error: command_failed.then_some(true),
                content,
                duration_ms: started.elapsed().as_millis() as u64,
                denied: None,
                error_code: command_failed.then_some("TOOL_FAILED".into()),
            }
        }
        Err((code, message)) => ToolsExecuteResult {
            tool_call_id,
            ok: false,
            is_error: Some(true),
            content: json!({ "error": message, "code": code }),
            duration_ms: started.elapsed().as_millis() as u64,
            denied: Some(code == "TOOL_DENIED" || code == "PATH_OUTSIDE_WORKSPACE"),
            error_code: Some(code),
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
    let offset = args
        .get("offset")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        .min(usize::MAX as u64) as usize;
    // A window, not a whole file: an unpaginated Read was the single largest
    // context consumer measured (154KB average), and the old >512KB refusal
    // pushed the model into hand-rolled `sed`/`awk` pipelines instead.
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|v| v.min(usize::MAX as u64) as usize)
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_READ_LINES)
        .min(BUDGET_SEARCH.max_lines);

    let meta = std::fs::metadata(&resolved)
        .map_err(|e| ("TOOL_FAILED".into(), format!("read failed: {e}")))?;
    if meta.is_dir() {
        return Err((
            "TOOL_FAILED".into(),
            "path is a directory; use Glob to list it".into(),
        ));
    }
    let display = display_tool_path(root_kind, root, &resolved);
    let extension = resolved
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase());
    if let Some(ext) = &extension {
        if BINARY_EXTENSIONS.contains(&ext.as_str()) {
            return Err((
                "TOOL_BINARY_CONTENT".into(),
                format!("{display} is a binary file (.{ext}) and has no text to read"),
            ));
        }
    }

    let mut reader = LineReader::open(&resolved)
        .map_err(|e| ("TOOL_FAILED".into(), format!("read failed: {e}")))?;
    if reader.looks_binary() {
        return Err((
            "TOOL_BINARY_CONTENT".into(),
            format!("{display} looks like binary content and was not read as text"),
        ));
    }

    let read_error = |e: std::io::Error| ("TOOL_FAILED".to_string(), format!("read failed: {e}"));
    let mut eof = false;
    let mut skipped = 0_usize;
    while skipped < offset {
        match reader.next_line(MAX_LINE_CHARS).map_err(read_error)? {
            Some(_) => skipped += 1,
            None => {
                eof = true;
                break;
            }
        }
    }

    let mut kept: Vec<String> = Vec::new();
    let mut bytes = 0_usize;
    let mut clipped_lines = 0_usize;
    let mut budget_capped = false;
    while !eof && kept.len() < limit {
        match reader.next_line(MAX_LINE_CHARS).map_err(read_error)? {
            Some(line) => {
                let size = line.text.len() + usize::from(!kept.is_empty());
                if bytes + size > BUDGET_SEARCH.max_bytes {
                    budget_capped = true;
                    break;
                }
                bytes += size;
                if line.clipped {
                    clipped_lines += 1;
                }
                kept.push(line.text);
            }
            None => eof = true,
        }
    }
    // Distinguish "stopped on the limit" from "reached the end", so the notice
    // can promise a useful next offset instead of guessing.
    let mut has_more = budget_capped;
    if !eof && !budget_capped {
        match reader.next_line(1).map_err(read_error)? {
            Some(_) => has_more = true,
            None => eof = true,
        }
    }

    let next_offset = skipped + kept.len();
    let total_lines = eof.then_some(next_offset);
    let mut notes: Vec<String> = Vec::new();
    if let Some(total) = total_lines {
        if kept.is_empty() && offset > 0 {
            notes.push(format!(
                "offset {offset} is past the end of the file ({total} lines total)"
            ));
        }
    }
    if budget_capped {
        notes.push(format!(
            "stopped at the {}KB result budget",
            BUDGET_SEARCH.max_bytes / 1024
        ));
    }
    if has_more {
        notes.push(format!(
            "more lines remain; read again with offset={next_offset}"
        ));
    } else if let Some(total) = total_lines {
        notes.push(format!("end of file ({total} lines total)"));
    }
    if clipped_lines > 0 {
        notes.push(format!(
            "{clipped_lines} line(s) longer than {MAX_LINE_CHARS} characters were cut"
        ));
    }

    // `content` stays byte-faithful to the requested window — no line numbers,
    // no inline marker — so text copied out of it still matches for Edit.
    // Everything the model needs to know about the window lives in the
    // sibling fields it also receives.
    let mut out = json!({
        "path": display,
        "root": root_label(root_kind),
        "content": kept.join("\n"),
        "truncated": has_more || clipped_lines > 0,
        "offset": offset,
        "lineCount": kept.len(),
        "fileBytes": meta.len(),
    });
    if let Some(total) = total_lines {
        out["totalLines"] = json!(total);
    }
    if !notes.is_empty() {
        out["notice"] = json!(notes.join("; "));
    }
    Ok(out)
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
    let match_count = original.match_indices(old_str).count();
    if match_count == 0 {
        return Err((
            "TOOL_FAILED".into(),
            "old_string not found in file; re-read the current file and retry with a fresh, unique context instead of repairing an old patch".into(),
        ));
    }
    if match_count > 1 {
        return Err((
            "TOOL_FAILED".into(),
            format!(
                "old_string matches {match_count} locations; re-read the current file and include more surrounding context"
            ),
        ));
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

fn build_glob_set(pattern: &str) -> Result<globset::GlobSet, (String, String)> {
    let glob = globset::GlobBuilder::new(pattern)
        .literal_separator(true)
        .build()
        .map_err(|e| ("INVALID_ARGUMENT".into(), e.to_string()))?;
    let mut set = globset::GlobSetBuilder::new();
    set.add(glob);
    set.build()
        .map_err(|e| ("INVALID_ARGUMENT".into(), e.to_string()))
}

/// A pattern matches either the path relative to the search root or the bare
/// file name, so both `src/**/*.ts` and `*.ts` do what the caller meant.
/// Returning nothing for `*.ts` is what sends the model back to shell `find`.
fn glob_matches(set: &globset::GlobSet, relative: &Path) -> bool {
    if set.is_match(relative) {
        return true;
    }
    relative
        .file_name()
        .map(|name| set.is_match(Path::new(name)))
        .unwrap_or(false)
}

/// Resolve the optional `path` argument to a search root.
///
/// Returns the root plus whether it was explicitly scoped, which decides how
/// ignore files apply: an explicit path is an explicit request, so only ignore
/// files at or below it count. Otherwise a `path` pointing into an ignored tree
/// (`node_modules`, `dist`) would be filtered to zero matches by the
/// workspace's own `.gitignore` — again pushing the model back to the shell.
fn search_root(
    root: &Path,
    scratch: Option<&Path>,
    args: &Value,
) -> Result<(PathBuf, ToolRoot, bool), (String, String)> {
    match args
        .get("path")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        Some(path) => {
            let (resolved, kind) =
                resolve_tool_path(root, scratch, path).map_err(|e| (e.clone(), e))?;
            if !resolved.is_dir() {
                return Err((
                    "INVALID_ARGUMENT".into(),
                    format!("path is not a directory: {path}"),
                ));
            }
            Ok((resolved, kind, true))
        }
        None => Ok((root.to_path_buf(), ToolRoot::Workspace, false)),
    }
}

fn candidate_files(
    search_root: &Path,
    scoped: bool,
    include: Option<&globset::GlobSet>,
    max_files: usize,
) -> (Vec<PathBuf>, bool) {
    let mut walker = WalkBuilder::new(search_root);
    walker.hidden(false).git_ignore(true);
    if scoped {
        walker.parents(false);
    }
    let mut candidates: Vec<(PathBuf, SystemTime)> = Vec::new();
    let mut capped = false;
    for entry in walker.build().flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let relative = path.strip_prefix(search_root).unwrap_or(path);
        if let Some(set) = include {
            if !glob_matches(set, relative) {
                continue;
            }
        }
        if candidates.len() >= max_files {
            capped = true;
            break;
        }
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .unwrap_or(UNIX_EPOCH);
        candidates.push((path.to_path_buf(), mtime));
    }
    // Most recently touched first: the file someone just edited is far more
    // likely to be the one the question is about than an alphabetically early
    // one, so a capped result keeps the useful half.
    candidates.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    (
        candidates.into_iter().map(|(path, _)| path).collect(),
        capped,
    )
}

fn tool_glob(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    args: &Value,
) -> Result<Value, (String, String)> {
    let root = require_workspace(workspace)?;
    let pattern = args
        .get("pattern")
        .and_then(|v| v.as_str())
        .unwrap_or("**/*");
    let set = build_glob_set(pattern)?;
    let (search_dir, root_kind, scoped) = search_root(root, scratch, args)?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|v| v.min(GLOB_MAX_LIMIT as u64) as usize)
        .filter(|v| *v > 0)
        .unwrap_or(GLOB_DEFAULT_LIMIT);

    let (files, mut truncated) =
        candidate_files(&search_dir, scoped, Some(&set), GLOB_MAX_LIMIT * 8);
    let mut matches: Vec<String> = Vec::new();
    let mut bytes = 0_usize;
    for path in &files {
        if matches.len() >= limit {
            truncated = true;
            break;
        }
        let shown = display_tool_path(root_kind, root, path);
        bytes += shown.len() + 8;
        if bytes > BUDGET_SEARCH.max_bytes {
            truncated = true;
            break;
        }
        matches.push(shown);
    }

    let mut out = json!({
        "matches": matches,
        "count": matches.len(),
        "truncated": truncated,
    });
    if truncated {
        out["notice"] = json!(format!(
            "more files match; raise limit (max {GLOB_MAX_LIMIT}) or narrow pattern/path. Results are ordered by modification time, newest first"
        ));
    }
    Ok(out)
}

fn tool_grep(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    args: &Value,
) -> Result<Value, (String, String)> {
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
    let (search_dir, root_kind, scoped) = search_root(root, scratch, args)?;
    let include = args
        .get("include")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(build_glob_set)
        .transpose()?;
    let mode = args
        .get("outputMode")
        .and_then(|v| v.as_str())
        .unwrap_or("content");
    if !matches!(mode, "content" | "filesWithMatches" | "count") {
        return Err((
            "INVALID_ARGUMENT".into(),
            format!("unknown outputMode: {mode} (content | filesWithMatches | count)"),
        ));
    }
    let head_limit = args
        .get("headLimit")
        .and_then(|v| v.as_u64())
        .map(|v| v.min(BUDGET_SEARCH.max_lines as u64) as usize)
        .filter(|v| *v > 0)
        .unwrap_or(GREP_DEFAULT_HEAD_LIMIT);

    let (files, mut truncated) = candidate_files(
        &search_dir,
        scoped,
        include.as_ref(),
        GREP_MAX_CANDIDATE_FILES,
    );

    let mut hits: Vec<Value> = Vec::new();
    let mut counts: Vec<Value> = Vec::new();
    let mut matched_files: Vec<String> = Vec::new();
    let mut total_matches = 0_usize;
    let mut clipped_lines = 0_usize;
    let mut bytes = 0_usize;
    'files: for path in &files {
        let Ok(mut reader) = LineReader::open(path) else {
            continue;
        };
        // Skipped rather than lossily decoded: a regex over mangled bytes
        // produces hits nobody can act on.
        if reader.looks_binary() {
            continue;
        }
        let shown = display_tool_path(root_kind, root, path);
        let mut line_no = 0_usize;
        let mut file_matches = 0_usize;
        // A read error mid-file is treated as end of file: partial matches from
        // what was readable beat dropping the file entirely.
        while let Ok(Some(line)) = reader.next_line(MAX_LINE_CHARS) {
            line_no += 1;
            if !re.is_match(&line.text) {
                continue;
            }
            file_matches += 1;
            total_matches += 1;
            if line.clipped {
                clipped_lines += 1;
            }
            match mode {
                "content" => {
                    // 48 bytes covers the JSON envelope of one hit.
                    bytes += shown.len() + line.text.len() + 48;
                    if hits.len() >= head_limit || bytes > BUDGET_SEARCH.max_bytes {
                        truncated = true;
                        break 'files;
                    }
                    hits.push(json!({
                        "path": shown,
                        "line": line_no,
                        "text": line.text,
                    }));
                }
                // One hit settles it; no reason to read the rest of the file.
                "filesWithMatches" => break,
                _ => {}
            }
        }
        if file_matches == 0 {
            continue;
        }
        matched_files.push(shown.clone());
        if mode == "count" {
            counts.push(json!({ "path": shown, "count": file_matches }));
        }
        if mode != "content" && matched_files.len() >= head_limit {
            truncated = true;
            break;
        }
    }

    let mut notes: Vec<String> = Vec::new();
    if truncated {
        notes.push(
            "results are truncated (ordered by modification time, newest first); narrow path/include or raise headLimit".into(),
        );
    }
    if clipped_lines > 0 {
        notes.push(format!(
            "{clipped_lines} matching line(s) longer than {MAX_LINE_CHARS} characters were cut"
        ));
    }

    let mut out = match mode {
        "filesWithMatches" => json!({
            "files": matched_files,
            "count": total_matches,
            "truncated": truncated,
        }),
        "count" => json!({
            "counts": counts,
            "count": total_matches,
            "truncated": truncated,
        }),
        _ => json!({
            "matches": hits,
            "count": hits.len(),
            "files": matched_files.len(),
            "truncated": truncated,
        }),
    };
    if !notes.is_empty() {
        out["notice"] = json!(notes.join("; "));
    }
    Ok(out)
}

async fn tool_bash(
    workspace: Option<&Path>,
    scratch: Option<&Path>,
    args: &Value,
    timeout_ms: u64,
) -> Result<Value, (String, String)> {
    let root = require_workspace(workspace)?;
    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("INVALID_ARGUMENT".into(), "command required".into()))?;

    let resolved =
        shell::resolve_shell().map_err(|message| ("SHELL_NOT_FOUND".to_string(), message))?;
    let mut cmd = Command::new(&resolved.program);
    cmd.args(resolved.args)
        .arg(command)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(scratch_dir) = scratch {
        // Shell commands drop temp files via $PI_SCRATCH_DIR instead of the
        // workspace (D114); the dir was created by execute_tool above.
        cmd.env("PI_SCRATCH_DIR", scratch_dir);
    }
    if let Some(user_path) = shell::user_login_path() {
        // D181: let Bash see the toolchain the user's own login shell exports
        // (nvm, Homebrew, ...). The probe is best-effort and cached, so a
        // missing/wedged user shell silently keeps the host PATH.
        cmd.env("PATH", user_path);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: bash.exe must not flash a console over the GUI.
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = None;
    let backoffs = [50_u64, 100, 250];
    let mut last_spawn_error = None;
    for (attempt, delay_ms) in backoffs.iter().copied().enumerate() {
        match cmd.spawn() {
            Ok(process) => {
                child = Some(process);
                break;
            }
            Err(error)
                if (error.kind() == std::io::ErrorKind::WouldBlock
                    || error.raw_os_error() == Some(35)
                    || error.raw_os_error() == Some(11))
                    && attempt + 1 < backoffs.len() =>
            {
                last_spawn_error = Some(error);
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
            Err(error) => {
                last_spawn_error = Some(error);
                break;
            }
        }
    }
    let mut child = child.ok_or_else(|| {
        let error = last_spawn_error.expect("spawn failure must have an error");
        let resource_error = error.kind() == std::io::ErrorKind::WouldBlock
            || error.raw_os_error() == Some(35)
            || error.raw_os_error() == Some(11);
        let code = if resource_error {
            "PROCESS_RESOURCE_EXHAUSTED"
        } else {
            "TOOL_FAILED"
        };
        (code.into(), format!("spawn failed: {error}"))
    })?;

    // Drain pipes concurrently with waiting: a child producing more than the
    // OS pipe buffer (~64KB) would otherwise block forever on write and only
    // die at the timeout.
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_task = tokio::spawn(async move {
        if let Some(out) = stdout_pipe.as_mut() {
            return read_capped(out, SPILL_MAX_BYTES + 1).await;
        }
        Vec::new()
    });
    let stderr_task = tokio::spawn(async move {
        if let Some(err) = stderr_pipe.as_mut() {
            return read_capped(err, SPILL_MAX_BYTES + 1).await;
        }
        Vec::new()
    });

    let wait =
        tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), child.wait()).await;

    match wait {
        Ok(Ok(status)) => {
            let stdout_buf = stdout_task.await.unwrap_or_default();
            let stderr_buf = stderr_task.await.unwrap_or_default();
            let stdout = String::from_utf8_lossy(&stdout_buf).to_string();
            let stderr = String::from_utf8_lossy(&stderr_buf).to_string();
            let (stdout, trunc_out) =
                truncate_with_spill(&stdout, BUDGET_SHELL, scratch, "bash-stdout");
            let (stderr, trunc_err) =
                truncate_with_spill(&stderr, BUDGET_SHELL_ERR, scratch, "bash-stderr");
            Ok(json!({
                "exitCode": status.code(),
                "stdout": stdout,
                "stderr": stderr,
                "truncated": trunc_out || trunc_err,
            }))
        }
        Ok(Err(e)) => Err(("TOOL_FAILED".into(), format!("bash failed: {e}"))),
        Err(_) => {
            let _ = child.start_kill();
            // Reap the child before releasing the tool permit. This avoids
            // accumulating zombie/process-table entries during timeout bursts.
            let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
            stdout_task.abort();
            stderr_task.abort();
            Err(("TOOL_TIMEOUT".into(), "bash timed out".into()))
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
    // Descriptions carry the real limits and the scoping parameters on purpose:
    // when a tool looks like it can only do the naive thing, the model routes
    // around it through Bash, and hand-rolled shell pipelines are what blew up
    // context in the first place.
    json!([
        {
            "name": "Read",
            "description": format!(
                "Read a window of a text file inside the workspace or the session scratch directory. \
                 Returns at most {} lines ({}KB) starting at `offset`; lines longer than {} characters are cut. \
                 Prefer this over `cat`/`sed`/`head` in Bash. Paginate with `offset` instead of dumping whole files — \
                 the `notice` field tells you the next offset when more remains.",
                DEFAULT_READ_LINES,
                BUDGET_SEARCH.max_bytes / 1024,
                MAX_LINE_CHARS
            ),
            "risk": "low",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Workspace-relative path, or an absolute path inside the scratch directory" },
                    "offset": { "type": "integer", "description": "0-based line to start at (default 0)", "minimum": 0 },
                    "limit": { "type": "integer", "description": format!("Lines to read (default {}, max {})", DEFAULT_READ_LINES, BUDGET_SEARCH.max_lines), "minimum": 1 }
                },
                "required": ["path"]
            }
        },
        {
            "name": "Glob",
            "description": format!(
                "List files by glob pattern, newest first. Returns at most `limit` entries (default {}, max {}). \
                 The pattern matches either the path relative to the search root or the bare file name, so both \
                 `src/**/*.ts` and `*.ts` work. Prefer this over `find`/`ls` in Bash.",
                GLOB_DEFAULT_LIMIT, GLOB_MAX_LIMIT
            ),
            "risk": "low",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Glob pattern, e.g. `**/*.rs`" },
                    "path": { "type": "string", "description": "Directory to search in; defaults to the workspace root. Pass it explicitly to search inside a git-ignored tree such as node_modules or dist" },
                    "limit": { "type": "integer", "description": format!("Max entries (default {}, max {})", GLOB_DEFAULT_LIMIT, GLOB_MAX_LIMIT), "minimum": 1 }
                },
                "required": ["pattern"]
            }
        },
        {
            "name": "Grep",
            "description": format!(
                "Search file contents by regex, results ordered by file modification time (newest first). \
                 Returns at most `headLimit` matches (default {}, hard budget {}KB) and cuts matching lines at \
                 {} characters. Scope with `path` and `include` rather than filtering shell `grep` output; use \
                 `outputMode: \"filesWithMatches\"` or `\"count\"` when you only need the file list or tallies.",
                GREP_DEFAULT_HEAD_LIMIT,
                BUDGET_SEARCH.max_bytes / 1024,
                MAX_LINE_CHARS
            ),
            "risk": "low",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Rust-regex pattern matched per line" },
                    "path": { "type": "string", "description": "Directory to search in; defaults to the workspace root. Pass it explicitly to search inside a git-ignored tree such as node_modules or dist" },
                    "include": { "type": "string", "description": "Glob filter on file path or name, e.g. `*.{ts,tsx}`" },
                    "outputMode": { "type": "string", "enum": ["content", "filesWithMatches", "count"], "description": "content (default): matching lines; filesWithMatches: matching file paths; count: per-file match counts" },
                    "headLimit": { "type": "integer", "description": format!("Max matches (content) or files (other modes); default {}", GREP_DEFAULT_HEAD_LIMIT), "minimum": 1 },
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
            "description": "Replace one unique text occurrence in a workspace or scratch-directory file; re-read before retrying stale or ambiguous context",
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
            "description": format!(
                "Run a non-interactive shell command in the workspace. stdout keeps its first {}KB, stderr its \
                 last {}KB, and anything over budget is spilled to a file named in the truncation marker. \
                 Use Read/Glob/Grep for reading and searching instead of shell equivalents; when a shell search \
                 is genuinely needed prefer `rg` and exclude build output.",
                BUDGET_SHELL.max_bytes / 1024,
                BUDGET_SHELL_ERR.max_bytes / 1024
            ),
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
        // drain concurrently with wait(). Single line under BUDGET_SHELL so
        // full drainage is observable in the returned stdout.
        let dir = tempfile::tempdir().unwrap();
        let result = execute_tool(
            Some(dir.path()),
            None,
            "Bash",
            &serde_json::json!({ "command": "head -c 80000 /dev/zero | tr '\\0' 'a'" }),
            15_000,
        )
        .await;
        assert!(result.ok, "bash tool failed: {:?}", result.content);
        let stdout = result.content["stdout"].as_str().unwrap_or_default();
        assert_eq!(stdout.len(), 80_000, "stdout fully drained");
        assert_eq!(result.content["truncated"].as_bool(), Some(false));
    }

    #[tokio::test]
    async fn bash_over_budget_output_spills_to_scratch() {
        let ws = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let scratch = data.path().join("scratch/session-spill");
        let lines = BUDGET_SHELL.max_lines + 500;
        let result = execute_tool(
            Some(ws.path()),
            Some(&scratch),
            "Bash",
            &serde_json::json!({ "command": format!("seq 1 {lines}") }),
            30_000,
        )
        .await;
        assert!(result.ok, "bash tool failed: {:?}", result.content);
        assert_eq!(result.content["truncated"].as_bool(), Some(true));
        let stdout = result.content["stdout"].as_str().unwrap();
        assert!(stdout.starts_with("1\n2\n"), "head retained");
        assert!(stdout.contains("[truncated:"), "marker present");

        // The marker names a spill file that holds the whole output.
        let spill_dir = scratch.join("tool-output");
        let spilled: Vec<_> = std::fs::read_dir(&spill_dir).unwrap().flatten().collect();
        assert_eq!(spilled.len(), 1, "one spill file per truncated stream");
        let spill_path = spilled[0].path();
        assert!(
            stdout.contains(&spill_path.display().to_string()),
            "marker points at the spill file: {stdout:?}"
        );
        let full = std::fs::read_to_string(&spill_path).unwrap();
        assert_eq!(full.lines().count(), lines, "spill kept every line");
    }

    #[tokio::test]
    async fn bash_stderr_keeps_the_tail() {
        // A failing command's actionable message is its last line.
        let ws = tempfile::tempdir().unwrap();
        let lines = BUDGET_SHELL_ERR.max_lines + 200;
        let result = execute_tool(
            Some(ws.path()),
            None,
            "Bash",
            &serde_json::json!({
                "command": format!("seq 1 {lines} >&2; printf 'error: the real problem\\n' >&2; exit 2")
            }),
            30_000,
        )
        .await;
        assert!(!result.ok);
        let stderr = result.content["stderr"].as_str().unwrap();
        assert!(
            stderr.trim_end().ends_with("error: the real problem"),
            "tail retained: {:?}",
            &stderr[stderr.len().saturating_sub(120)..]
        );
        assert!(stderr.starts_with("[truncated:"), "marker leads a tail cut");
    }

    #[test]
    fn single_oversized_line_keeps_a_prefix() {
        // Minified bundles are one enormous line: keeping nothing would be
        // worse than keeping a clipped prefix.
        let text = "x".repeat(BUDGET_SEARCH.max_bytes * 2);
        let (out, truncated) = truncate_with_spill(&text, BUDGET_SEARCH, None, "test");
        assert!(truncated);
        assert!(out.starts_with(&"x".repeat(1000)));
        assert!(out.contains("no complete line fits"));
        assert!(out.len() < BUDGET_SEARCH.max_bytes + 512);
    }

    #[tokio::test]
    async fn read_paginates_instead_of_refusing_large_files() {
        let dir = tempfile::tempdir().unwrap();
        let big = dir.path().join("big.txt");
        // Comfortably past the 512KB the old implementation refused outright.
        let body: String = (1..=70_000).map(|n| format!("line {n}\n")).collect();
        assert!(body.len() > 512 * 1024);
        std::fs::write(&big, &body).unwrap();

        let first = execute_tool(
            Some(dir.path()),
            None,
            "Read",
            &serde_json::json!({ "path": "big.txt" }),
            5_000,
        )
        .await;
        assert!(first.ok, "read failed: {:?}", first.content);
        assert_eq!(first.content["lineCount"].as_u64(), Some(2000));
        assert!(first.content["totalLines"].is_null(), "total unknown yet");
        let content = first.content["content"].as_str().unwrap();
        assert!(content.starts_with("line 1\nline 2\n"));
        assert!(content.ends_with("line 2000"));
        assert!(content.len() <= BUDGET_SEARCH.max_bytes);
        assert_eq!(first.content["truncated"].as_bool(), Some(true));
        assert!(first.content["notice"]
            .as_str()
            .unwrap()
            .contains("offset=2000"));

        let tail = execute_tool(
            Some(dir.path()),
            None,
            "Read",
            &serde_json::json!({ "path": "big.txt", "offset": 69_998, "limit": 10 }),
            5_000,
        )
        .await;
        assert!(tail.ok, "read failed: {:?}", tail.content);
        assert_eq!(
            tail.content["content"].as_str(),
            Some("line 69999\nline 70000")
        );
        assert_eq!(tail.content["totalLines"].as_u64(), Some(70_000));
        assert!(tail.content["notice"]
            .as_str()
            .unwrap()
            .contains("end of file"));
    }

    #[tokio::test]
    async fn read_clips_overlong_lines() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("bundle.min.js"),
            format!("{}\nshort\n", "a".repeat(MAX_LINE_CHARS * 3)),
        )
        .unwrap();
        let result = execute_tool(
            Some(dir.path()),
            None,
            "Read",
            &serde_json::json!({ "path": "bundle.min.js" }),
            5_000,
        )
        .await;
        assert!(result.ok, "read failed: {:?}", result.content);
        let content = result.content["content"].as_str().unwrap();
        let first_line = content.lines().next().unwrap();
        assert_eq!(first_line.chars().count(), MAX_LINE_CHARS);
        assert!(content.ends_with("\nshort"), "later lines survive");
        assert!(result.content["notice"]
            .as_str()
            .unwrap()
            .contains("longer than 2000 characters"));
    }

    #[tokio::test]
    async fn read_rejects_binary_content() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("blob.dat"), b"\x00\x01\x02binary").unwrap();
        std::fs::write(dir.path().join("blob"), b"text\x00\x00\x00\x01\x02\x03").unwrap();
        for name in ["blob.dat", "blob"] {
            let result = execute_tool(
                Some(dir.path()),
                None,
                "Read",
                &serde_json::json!({ "path": name }),
                5_000,
            )
            .await;
            assert!(!result.ok, "{name} should be refused");
            assert_eq!(
                result.error_code.as_deref(),
                Some("TOOL_BINARY_CONTENT"),
                "{name}"
            );
        }
    }

    #[tokio::test]
    async fn grep_scopes_clips_and_bounds_results() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::create_dir_all(dir.path().join("dist")).unwrap();
        std::fs::write(dir.path().join("src/a.ts"), "const needle = 1;\n").unwrap();
        std::fs::write(dir.path().join("src/b.md"), "needle in markdown\n").unwrap();
        std::fs::write(
            dir.path().join("dist/bundle.js"),
            format!("needle{}\n", "!".repeat(MAX_LINE_CHARS * 4)),
        )
        .unwrap();

        let scoped = execute_tool(
            Some(dir.path()),
            None,
            "Grep",
            &serde_json::json!({ "pattern": "needle", "path": "src", "include": "*.ts" }),
            5_000,
        )
        .await;
        assert!(scoped.ok, "grep failed: {:?}", scoped.content);
        assert_eq!(scoped.content["count"].as_u64(), Some(1));
        assert_eq!(
            scoped.content["matches"][0]["path"].as_str(),
            Some("src/a.ts")
        );

        // An overlong minified hit is clipped instead of carrying the bundle.
        let clipped = execute_tool(
            Some(dir.path()),
            None,
            "Grep",
            &serde_json::json!({ "pattern": "needle", "path": "dist" }),
            5_000,
        )
        .await;
        assert!(clipped.ok, "grep failed: {:?}", clipped.content);
        let text = clipped.content["matches"][0]["text"].as_str().unwrap();
        assert_eq!(text.chars().count(), MAX_LINE_CHARS);
        assert!(clipped.content["notice"]
            .as_str()
            .unwrap()
            .contains("were cut"));

        let files = execute_tool(
            Some(dir.path()),
            None,
            "Grep",
            &serde_json::json!({ "pattern": "needle", "outputMode": "filesWithMatches" }),
            5_000,
        )
        .await;
        assert!(files.ok, "grep failed: {:?}", files.content);
        let listed: Vec<&str> = files.content["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(listed.len(), 3, "every file listed once: {listed:?}");

        let counts = execute_tool(
            Some(dir.path()),
            None,
            "Grep",
            &serde_json::json!({ "pattern": "needle", "path": "src", "outputMode": "count" }),
            5_000,
        )
        .await;
        assert!(counts.ok, "grep failed: {:?}", counts.content);
        assert_eq!(counts.content["count"].as_u64(), Some(2));
        assert_eq!(counts.content["counts"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn grep_head_limit_bounds_hits() {
        let dir = tempfile::tempdir().unwrap();
        let body: String = (0..500).map(|_| "needle\n").collect();
        std::fs::write(dir.path().join("many.txt"), body).unwrap();
        let result = execute_tool(
            Some(dir.path()),
            None,
            "Grep",
            &serde_json::json!({ "pattern": "needle", "headLimit": 5 }),
            5_000,
        )
        .await;
        assert!(result.ok, "grep failed: {:?}", result.content);
        assert_eq!(result.content["count"].as_u64(), Some(5));
        assert_eq!(result.content["truncated"].as_bool(), Some(true));
        assert!(result.content["notice"]
            .as_str()
            .unwrap()
            .contains("headLimit"));
    }

    #[tokio::test]
    async fn search_reaches_explicitly_named_ignored_directories() {
        // The measured failure: the agent asked about a package under
        // node_modules, got nothing back because the workspace ignore rules
        // filtered it, and fell back to hand-rolled shell pipelines. Uses
        // `.ignore` rather than `.gitignore` because the `ignore` crate only
        // honors the latter inside a real git repo; `parents(false)` governs
        // both the same way.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".ignore"), "node_modules\n").unwrap();
        std::fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        std::fs::write(
            dir.path().join("node_modules/pkg/index.js"),
            "export const needle = 1;\n",
        )
        .unwrap();

        let unscoped = execute_tool(
            Some(dir.path()),
            None,
            "Grep",
            &serde_json::json!({ "pattern": "needle" }),
            5_000,
        )
        .await;
        assert_eq!(
            unscoped.content["count"].as_u64(),
            Some(0),
            "ignored by default"
        );

        let scoped = execute_tool(
            Some(dir.path()),
            None,
            "Grep",
            &serde_json::json!({ "pattern": "needle", "path": "node_modules/pkg" }),
            5_000,
        )
        .await;
        assert_eq!(
            scoped.content["count"].as_u64(),
            Some(1),
            "reachable when named"
        );

        let globbed = execute_tool(
            Some(dir.path()),
            None,
            "Glob",
            &serde_json::json!({ "pattern": "*.js", "path": "node_modules/pkg" }),
            5_000,
        )
        .await;
        assert_eq!(globbed.content["count"].as_u64(), Some(1));
        assert_eq!(
            globbed.content["matches"][0].as_str(),
            Some("node_modules/pkg/index.js")
        );
    }

    #[tokio::test]
    async fn glob_orders_by_mtime_and_bounds_entries() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["old.rs", "mid.rs", "new.rs"] {
            std::fs::write(dir.path().join(name), "fn main() {}\n").unwrap();
            // Coarse filesystem mtime resolution needs a real gap.
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let result = execute_tool(
            Some(dir.path()),
            None,
            "Glob",
            &serde_json::json!({ "pattern": "*.rs" }),
            5_000,
        )
        .await;
        assert!(result.ok, "glob failed: {:?}", result.content);
        let matches: Vec<&str> = result.content["matches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(matches, vec!["new.rs", "mid.rs", "old.rs"]);

        let limited = execute_tool(
            Some(dir.path()),
            None,
            "Glob",
            &serde_json::json!({ "pattern": "*.rs", "limit": 1 }),
            5_000,
        )
        .await;
        assert_eq!(limited.content["count"].as_u64(), Some(1));
        assert_eq!(limited.content["truncated"].as_bool(), Some(true));
    }

    #[test]
    fn tool_defs_advertise_the_scoping_parameters() {
        // The model only reaches for these instead of Bash if it can see them.
        let defs = builtin_tool_defs();
        let by_name = |name: &str| -> Value {
            defs.as_array()
                .unwrap()
                .iter()
                .find(|def| def["name"] == name)
                .unwrap()
                .clone()
        };
        let read = by_name("Read");
        assert!(read["parameters"]["properties"]["offset"].is_object());
        assert!(read["parameters"]["properties"]["limit"].is_object());
        let grep = by_name("Grep");
        for param in ["path", "include", "outputMode", "headLimit"] {
            assert!(
                grep["parameters"]["properties"][param].is_object(),
                "Grep advertises {param}"
            );
        }
        assert!(by_name("Glob")["parameters"]["properties"]["limit"].is_object());
        assert!(read["description"].as_str().unwrap().contains("2000 lines"));
    }

    #[tokio::test]
    async fn bash_nonzero_exit_preserves_output_and_marks_failure() {
        let dir = tempfile::tempdir().unwrap();
        let result = execute_tool(
            Some(dir.path()),
            None,
            "Bash",
            &serde_json::json!({
                "command": "printf 'diagnostic' >&2; exit 7"
            }),
            15_000,
        )
        .await;

        assert!(!result.ok);
        assert_eq!(result.is_error, Some(true));
        assert_eq!(result.error_code.as_deref(), Some("TOOL_FAILED"));
        assert_eq!(result.content["exitCode"].as_i64(), Some(7));
        assert_eq!(result.content["stderr"].as_str(), Some("diagnostic"));
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

    #[tokio::test]
    async fn edit_requires_fresh_unique_context() {
        let ws = tempfile::tempdir().unwrap();
        let target = ws.path().join("note.txt");
        std::fs::write(&target, "before\nbefore\n").unwrap();

        let ambiguous = execute_tool(
            Some(ws.path()),
            None,
            "Edit",
            &serde_json::json!({
                "path": "note.txt",
                "old_string": "before",
                "new_string": "after"
            }),
            5_000,
        )
        .await;
        assert!(!ambiguous.ok);
        assert!(ambiguous.content["error"]
            .as_str()
            .unwrap()
            .contains("matches 2 locations"));

        let stale = execute_tool(
            Some(ws.path()),
            None,
            "Edit",
            &serde_json::json!({
                "path": "note.txt",
                "old_string": "missing",
                "new_string": "after"
            }),
            5_000,
        )
        .await;
        assert!(!stale.ok);
        assert!(stale.content["error"]
            .as_str()
            .unwrap()
            .contains("re-read the current file"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bash_inherits_user_login_path() {
        // D181: the Bash tool runs with the user's login-shell PATH so nvm /
        // Homebrew tools resolve; when no probe is possible it falls back to
        // the host PATH (still non-empty for the spawned bash).
        let dir = tempfile::tempdir().unwrap();
        let result = execute_tool(
            Some(dir.path()),
            None,
            "Bash",
            &serde_json::json!({ "command": "printf %s \"$PATH\"" }),
            15_000,
        )
        .await;
        assert!(result.ok, "bash failed: {:?}", result.content);
        let stdout = result.content["stdout"].as_str().unwrap_or_default();
        if let Some(user_path) = shell::user_login_path() {
            // `bash -lc` re-runs the bash profile at startup; conda/brew
            // hooks may prepend, dedupe, or reorder entries, so assert every
            // injected entry survives rather than the exact ordering.
            let injected: std::collections::HashSet<&str> =
                user_path.split(':').collect();
            let actual: std::collections::HashSet<&str> =
                stdout.split(':').collect();
            assert!(
                injected.is_subset(&actual),
                "every injected login-PATH entry is present"
            );
        } else {
            assert!(!stdout.is_empty(), "falls back to host PATH");
        }
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
}
