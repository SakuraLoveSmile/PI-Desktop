//! Session-owned Bash jobs. The existing runner remains the sole process-tree owner.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};

use crate::db::{now_ms, Database};
use crate::state::AppState;
use crate::tool_budget::ToolPermit;
use crate::tools::{self, BashExecutionOptions};

pub(crate) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS background_processes (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 tool_call_id TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('starting','running','stopping','completed','failed','stopped','timed_out','interrupted')),
 started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER,
 stdout TEXT NOT NULL DEFAULT '', stderr TEXT NOT NULL DEFAULT '',
 stdout_truncated INTEGER NOT NULL DEFAULT 0, stderr_truncated INTEGER NOT NULL DEFAULT 0,
 result_json TEXT, UNIQUE(session_id,tool_call_id)
);
CREATE INDEX IF NOT EXISTS background_processes_session ON background_processes(session_id,started_at DESC);
CREATE TRIGGER IF NOT EXISTS background_processes_block_session_delete
BEFORE DELETE ON sessions
WHEN EXISTS (SELECT 1 FROM background_processes WHERE session_id=OLD.id AND status IN ('starting','running','stopping'))
BEGIN SELECT RAISE(ABORT, 'SESSION_HAS_BACKGROUND_PROCESSES'); END;
";
const OUTPUT_LIMIT: usize = 64 * 1024;
const OUTPUT_CHANGED_INTERVAL: Duration = Duration::from_millis(250);
const SELECT: &str = "SELECT id,session_id,tool_call_id,command,cwd,status,started_at,ended_at,exit_code FROM background_processes";
pub type JobRegistry = HashMap<String, tokio::task::JoinHandle<()>>;
pub type OutputRegistry = HashMap<String, Arc<StdMutex<BackgroundOutput>>>;
pub type FinalizationRegistry = HashMap<String, PendingFinalization>;
pub struct PendingFinalization {
    process: BackgroundProcessSummary,
    result: tools::ToolsExecuteResult,
    persistence_error: Option<String>,
}

/// Retry only on an explicit scoped read/list/stop. Never restart the command.
pub fn retry_session(st: &mut AppState, session: &str) {
    let ids: Vec<_> = st
        .pending_background_finalizations
        .iter()
        .filter(|(_, pending)| pending.process.session_id == session)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        finalize(st, &id);
    }
}
pub fn has_pending_finalization(st: &AppState, session: &str) -> bool {
    st.pending_background_finalizations
        .values()
        .any(|pending| pending.process.session_id == session)
}
fn finalize(st: &mut AppState, id: &str) {
    let Some(pending) = st.pending_background_finalizations.get(id) else {
        return;
    };
    let result = (|| -> Result<()> {
        let encoded = serde_json::to_string(&pending.result)?;
        let output = st
            .background_outputs
            .get(id)
            .ok_or_else(|| anyhow!("background output owner missing"))?;
        let out = output
            .lock()
            .map_err(|_| anyhow!("background output lock poisoned"))?;
        let process = &pending.process;
        let changed=st.db.conn.execute(
            "UPDATE background_processes SET status=?2,ended_at=?3,exit_code=?4,
             stdout=?5,stderr=?6,stdout_truncated=?7,stderr_truncated=?8,result_json=?9 WHERE id=?1",
            params![id,process.status,process.ended_at,process.exit_code,out.stdout,out.stderr,
                out.stdout_truncated,out.stderr_truncated,encoded],
        )?;
        if changed != 1 {
            return Err(anyhow!("background process row missing"));
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            st.pending_background_finalizations.remove(id);
            if let Some(output) = st.background_outputs.remove(id) {
                match output.lock() {
                    Ok(mut output) => output.changed(),
                    Err(error) => tracing::error!(%error,"background output lock poisoned"),
                }
            }
        }
        Err(error) => {
            tracing::error!(%error,"background process completion write failed; retained terminal result");
            if let Some(pending) = st.pending_background_finalizations.get_mut(id) {
                pending.persistence_error = Some(format!(
                    "Background process result could not be saved: {error}"
                ));
            }
        }
    }
}
pub fn list_view(st: &AppState, session: &str) -> Result<Vec<BackgroundProcessSummary>> {
    let mut processes = list(&st.db, session)?;
    for process in &mut processes {
        if let Some(pending) = st.pending_background_finalizations.get(&process.id) {
            *process = pending.process.clone();
        }
    }
    Ok(processes)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundProcessSummary {
    #[serde(flatten)]
    pub(crate) service: Option<crate::background_services::ServiceMetadata>,
    pub id: String,
    pub session_id: String,
    pub tool_call_id: String,
    pub command: String,
    pub cwd: String,
    pub status: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<BackgroundProcessSummary> {
    Ok(BackgroundProcessSummary {
        service: None,
        id: r.get(0)?,
        session_id: r.get(1)?,
        tool_call_id: r.get(2)?,
        command: r.get(3)?,
        cwd: r.get(4)?,
        status: r.get(5)?,
        started_at: r.get(6)?,
        ended_at: r.get(7)?,
        exit_code: r.get(8)?,
    })
}
pub fn recover(db: &Database) -> Result<()> {
    let tx = db.conn.unchecked_transaction()?;
    crate::background_services::recover(db, now_ms())?;
    tx.execute("UPDATE background_processes SET status='interrupted',ended_at=?1 WHERE status IN ('starting','running','stopping')", [chrono::Utc::now().to_rfc3339()])?;
    tx.commit()?;
    Ok(())
}
pub fn has_active(db: &Database, session: &str) -> Result<bool> {
    Ok(db.conn.query_row("SELECT EXISTS(SELECT 1 FROM background_processes WHERE session_id=?1 AND status IN ('starting','running','stopping'))",[session],|r|r.get(0))?)
}
pub fn list(db: &Database, session: &str) -> Result<Vec<BackgroundProcessSummary>> {
    let mut stmt = db.conn.prepare(&format!(
        "{SELECT} WHERE session_id=?1 AND (
             status IN ('starting','running','stopping') OR id IN (
               SELECT id FROM background_processes WHERE session_id=?1
               AND status NOT IN ('starting','running','stopping')
               ORDER BY started_at DESC,id DESC LIMIT 100
             )) ORDER BY started_at DESC,id DESC"
    ))?;
    let mut rows: Vec<BackgroundProcessSummary> = stmt
        .query_map([session], row)?
        .collect::<rusqlite::Result<_>>()?;
    for process in &mut rows {
        process.service = crate::background_services::metadata(db, &process.id)?;
    }
    Ok(rows)
}
pub fn get(db: &Database, session: &str, id: &str) -> Result<Option<BackgroundProcessSummary>> {
    let mut process = db
        .conn
        .query_row(
            &format!("{SELECT} WHERE session_id=?1 AND id=?2"),
            params![session, id],
            row,
        )
        .optional()?;
    if let Some(process) = &mut process {
        process.service = crate::background_services::metadata(db, &process.id)?;
    }
    Ok(process)
}
pub fn duplicate(
    db: &Database,
    session: &str,
    call: &str,
) -> Result<Option<BackgroundProcessSummary>> {
    let mut process = db
        .conn
        .query_row(
            &format!("{SELECT} WHERE session_id=?1 AND tool_call_id=?2"),
            params![session, call],
            row,
        )
        .optional()?;
    if let Some(process) = &mut process {
        process.service = crate::background_services::metadata(db, &process.id)?;
    }
    Ok(process)
}

pub fn duplicate_view(
    st: &AppState,
    session: &str,
    call: &str,
) -> Result<Option<BackgroundProcessSummary>> {
    Ok(duplicate(&st.db, session, call)?.map(|process| {
        st.pending_background_finalizations
            .get(&process.id)
            .map(|pending| pending.process.clone())
            .unwrap_or(process)
    }))
}

#[derive(Debug)]
pub struct BackgroundOutput {
    stdout: String,
    stderr: String,
    stdout_truncated: bool,
    stderr_truncated: bool,
    session: String,
    id: String,
    revision: u64,
    dirty: bool,
    last_changed: Instant,
    tx: mpsc::UnboundedSender<String>,
}
impl BackgroundOutput {
    fn new(session: String, id: String, tx: mpsc::UnboundedSender<String>) -> Self {
        Self {
            stdout: String::new(),
            stderr: String::new(),
            stdout_truncated: false,
            stderr_truncated: false,
            session,
            id,
            revision: 0,
            dirty: false,
            last_changed: Instant::now(),
            tx,
        }
    }
    pub fn push(&mut self, stderr: bool, chunk: &str) {
        let (text, truncated) = if stderr {
            (&mut self.stderr, &mut self.stderr_truncated)
        } else {
            (&mut self.stdout, &mut self.stdout_truncated)
        };
        if stderr {
            text.push_str(chunk);
            if text.len() > OUTPUT_LIMIT {
                let mut cut = text.len() - OUTPUT_LIMIT;
                while !text.is_char_boundary(cut) {
                    cut += 1;
                }
                text.drain(..cut);
                *truncated = true;
            }
        } else {
            let available = OUTPUT_LIMIT.saturating_sub(text.len());
            let mut end = chunk.len().min(available);
            while !chunk.is_char_boundary(end) {
                end -= 1;
            }
            text.push_str(&chunk[..end]);
            *truncated |= end < chunk.len();
        }
        self.dirty = true;
        self.flush_due();
    }
    pub fn changed(&mut self) {
        self.revision = self.revision.saturating_add(1);
        self.dirty = false;
        self.last_changed = Instant::now();
        let _ = self.tx.send(json!({"jsonrpc":"2.0","method":"backgroundProcesses.changed","params":{"sessionId":self.session,"id":self.id,"revision":self.revision}}).to_string()+"\n");
    }
    pub fn flush_due(&mut self) {
        if self.dirty && self.last_changed.elapsed() >= OUTPUT_CHANGED_INTERVAL {
            self.changed();
        }
    }
    fn fields(&self) -> Value {
        json!({"stdout":self.stdout,"stderr":self.stderr,"stdoutTruncated":self.stdout_truncated,"stderrTruncated":self.stderr_truncated})
    }
}
pub fn read(st: &AppState, session: &str, id: &str) -> Result<Value> {
    let process =
        get(&st.db, session, id)?.ok_or_else(|| anyhow!("BACKGROUND_PROCESS_NOT_FOUND"))?;
    let mut value = if let Some(output) = st.background_outputs.get(id) {
        output
            .lock()
            .map_err(|_| anyhow!("background output lock poisoned"))?
            .fields()
    } else {
        st.db.conn.query_row("SELECT stdout,stderr,stdout_truncated,stderr_truncated FROM background_processes WHERE id=?1",[id],|r|Ok(json!({"stdout":r.get::<_,String>(0)?,"stderr":r.get::<_,String>(1)?,"stdoutTruncated":r.get::<_,bool>(2)?,"stderrTruncated":r.get::<_,bool>(3)?})))?
    };
    if let Some(pending) = st.pending_background_finalizations.get(id) {
        if pending.process.session_id != session {
            return Err(anyhow!("BACKGROUND_PROCESS_NOT_FOUND"));
        }
        value["process"] = serde_json::to_value(&pending.process)?;
        if let Some(error) = &pending.result.error_code {
            value["errorCode"] = json!(error);
        }
        if let Some(message) = pending.result.content.get("error").and_then(Value::as_str) {
            value["errorMessage"] = json!(message);
        }
        if let Some(error) = &pending.persistence_error {
            value["persistenceError"] = json!(error);
        }
    } else {
        value["process"] = serde_json::to_value(process)?;
        let encoded: Option<String> = st.db.conn.query_row(
            "SELECT result_json FROM background_processes WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        if let Some(encoded) = encoded {
            let result: Value = serde_json::from_str(&encoded)?;
            if let Some(error) = result.get("errorCode").and_then(Value::as_str) {
                value["errorCode"] = json!(error);
            }
            if let Some(message) = result
                .get("content")
                .and_then(|content| content.get("error"))
                .and_then(Value::as_str)
            {
                value["errorMessage"] = json!(message);
            }
        }
    }
    Ok(value)
}

pub struct ApprovedJob {
    pub workspace: PathBuf,
    pub scratch: Option<PathBuf>,
    pub args: Value,
    pub options: BashExecutionOptions,
    pub permit: ToolPermit,
    pub timeout_is_default: bool,
}
pub async fn start(
    state: Arc<Mutex<AppState>>,
    tx: mpsc::UnboundedSender<String>,
    mut job: ApprovedJob,
) -> Result<BackgroundProcessSummary> {
    let session = job.options.session_id.clone();
    let call = job.options.tool_call_id.clone();
    let command = job
        .args
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("command required"))?
        .to_string();
    let mut st = state.lock().await;
    if st.shutting_down
        || job
            .options
            .cancellation
            .as_ref()
            .is_some_and(|rx| *rx.borrow())
    {
        return Err(anyhow!("TOOL_ABORTED"));
    }
    if duplicate(&st.db, &session, &call)?.is_some() {
        return Err(anyhow!("TOOL_BUSY"));
    }
    let summary = BackgroundProcessSummary {
        service: None,
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session.clone(),
        tool_call_id: call.clone(),
        command,
        cwd: job.workspace.to_string_lossy().into_owned(),
        status: "starting".into(),
        started_at: chrono::Utc::now().to_rfc3339(),
        ended_at: None,
        exit_code: None,
    };
    st.db.conn.execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![summary.id,summary.session_id,summary.tool_call_id,summary.command,summary.cwd,summary.status,summary.started_at])?;
    let output = Arc::new(StdMutex::new(BackgroundOutput::new(
        session.clone(),
        summary.id.clone(),
        tx,
    )));
    job.options.output_tx = None;
    job.options.background_output = Some(output.clone());
    st.background_jobs.retain(|_, task| !task.is_finished());
    st.background_outputs
        .insert(summary.id.clone(), output.clone());
    let id = summary.id.clone();
    let task_state = state.clone();
    let mut terminal_summary = summary.clone();
    let task = tokio::spawn(async move {
        let _permit = job.permit;
        {
            let st = task_state.lock().await;
            if let Err(error)=st.db.conn.execute("UPDATE background_processes SET status='running' WHERE id=?1 AND status='starting'",[&id]) {tracing::error!(%error,"background process status write failed");}
        }
        match output.lock() {
            Ok(mut output) => output.changed(),
            Err(error) => tracing::error!(%error,"background output lock poisoned"),
        }
        let started = Instant::now();
        let timeout_ms = job
            .options
            .timeout_ms
            .unwrap_or(tools::DEFAULT_BASH_TIMEOUT_MS);
        let timeout_is_default = job.timeout_is_default;
        let mut result = tools::execute_tool_with_path_access(
            Some(&job.workspace),
            job.scratch.as_deref(),
            "Bash",
            &job.args,
            tools::ToolExecutionOptions {
                timeout_ms: job.options.timeout_ms,
                bash_options: Some(job.options),
                allow_external_paths: false,
                hashline: None,
            },
        )
        .await;
        annotate_timeout(&mut result, timeout_ms, timeout_is_default);
        let mut st = task_state.lock().await;
        let status = if st.shutting_down {
            "interrupted"
        } else {
            match result.error_code.as_deref() {
                Some("TOOL_ABORTED") => "stopped",
                Some("TOOL_TIMEOUT") => "timed_out",
                _ if result.ok => "completed",
                _ => "failed",
            }
        };
        terminal_summary.status = status.to_string();
        terminal_summary.ended_at = Some(chrono::Utc::now().to_rfc3339());
        terminal_summary.exit_code = result
            .content
            .get("exitCode")
            .and_then(Value::as_i64)
            .and_then(|code| i32::try_from(code).ok());
        st.pending_background_finalizations.insert(
            id.clone(),
            PendingFinalization {
                process: terminal_summary,
                result,
                persistence_error: None,
            },
        );
        finalize(&mut st, &id);
        if let Some(output) = st.background_outputs.get(&id) {
            match output.lock() {
                Ok(mut output) => output.changed(),
                Err(error) => tracing::error!(%error,"background output lock poisoned"),
            }
        }
        let _ = crate::audit::append(
            &st.db,
            "background_process_terminal",
            Some(&session),
            json!({"id":id,"toolCallId":call,"status":status,"durationMs":started.elapsed().as_millis() as u64,"at":now_ms()}),
        );
        st.clear_bash_cancellation(&session, &call);
    });
    st.background_jobs.insert(summary.id.clone(), task);
    Ok(summary)
}

/// Stored in the existing result envelope; historical records retain their unknown provenance.
fn annotate_timeout(result: &mut tools::ToolsExecuteResult, timeout_ms: u64, is_default: bool) {
    if result.error_code.as_deref() != Some("TOOL_TIMEOUT") {
        return;
    }
    let seconds = timeout_ms as f64 / 1000.0;
    let source = if is_default { "default" } else { "explicit" };
    result.content["error"] = json!(format!(
        "Background Bash timed out after the {source} {seconds} second limit. For long runs, pass timeout in seconds (1-21600); the default remains 60 seconds."
    ));
    result.content["timeoutMs"] = json!(timeout_ms);
    result.content["timeoutIsDefault"] = json!(is_default);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_timeout_provenance_keeps_default_and_explicit_limits_distinct() {
        for (limit, default) in [(60_000, true), (60_000, false), (90_000, false)] {
            let mut result = tools::ToolsExecuteResult {
                tool_call_id: "job".into(),
                ok: false,
                is_error: Some(true),
                content: json!({"error":"bash timed out", "stdout":"retained"}),
                duration_ms: limit,
                denied: None,
                error_code: Some("TOOL_TIMEOUT".into()),
                command_shell_id: None,
            };
            annotate_timeout(&mut result, limit, default);
            assert_eq!(result.content["timeoutMs"], limit);
            assert_eq!(result.content["timeoutIsDefault"], default);
            let source = if default { "default" } else { "explicit" };
            assert!(result.content["error"].as_str().unwrap().contains(source));
            assert_eq!(result.content["stdout"], "retained");
        }
    }

    #[test]
    fn background_output_flushes_suppressed_output_after_silence() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut output = BackgroundOutput::new("session".into(), "process".into(), tx);
        // Pin the throttle window without waiting for wall-clock time.
        output.last_changed = Instant::now() + Duration::from_secs(1);
        output.push(false, "early stdout");
        output.push(true, "early stderr");
        output.flush_due();
        assert!(rx.try_recv().is_err());

        output.last_changed = Instant::now() - Duration::from_millis(250);
        output.flush_due();
        let event: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(event["method"], "backgroundProcesses.changed");
        assert_eq!(event["params"]["sessionId"], "session");
        assert_eq!(event["params"]["id"], "process");
        assert_eq!(event["params"]["revision"], 1);
        assert_eq!(output.fields()["stdout"], "early stdout");
        assert_eq!(output.fields()["stderr"], "early stderr");

        output.last_changed = Instant::now() - Duration::from_millis(250);
        output.flush_due();
        assert!(rx.try_recv().is_err(), "clean ticks must not emit events");
    }

    #[test]
    fn background_output_lifecycle_notification_flushes_pending_output() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut output = BackgroundOutput::new("session".into(), "process".into(), tx);
        output.last_changed = Instant::now() + Duration::from_secs(1);
        output.push(false, "last output");
        output.changed();
        let event: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(event["params"]["revision"], 1);
        assert_eq!(output.fields()["stdout"], "last output");

        output.last_changed = Instant::now() - Duration::from_millis(250);
        output.flush_due();
        assert!(rx.try_recv().is_err());
    }
}
