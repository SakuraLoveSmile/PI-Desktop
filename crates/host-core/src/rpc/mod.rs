use std::io::{self, BufRead, BufReader as StdBufReader, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, Mutex, Semaphore};

use crate::artifacts;
use crate::audit;
use crate::notifications;
use crate::permissions::{PermissionDecision, PermissionManager};
use crate::providers::{self, DiscoveredModelInput, ProviderCreateInput, ProviderUpdateInput};
use crate::review;
use crate::scheduled;
use crate::scratch;
use crate::sessions::{self, UiMessage};
use crate::state::{AppState, HOST_VERSION, PROTOCOL_VERSION};
use crate::tools::{self, ToolsExecuteParams};
use crate::transcripts::CompactionRecord;
use crate::workspace;

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcNotification {
    jsonrpc: &'static str,
    method: String,
    params: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheModelsParams {
    provider_id: String,
    models: Vec<DiscoveredModelInput>,
}

#[derive(Debug)]
enum StdinEvent {
    Line(String),
    Error(String),
}

/// Tokio's stdio adapter delegates every read/write to the blocking pool. If
/// the OS temporarily refuses another worker thread, Tokio panics instead of
/// returning an error. The host's control pipe must not share that failure
/// mode, so it uses two fixed, explicitly named threads instead.
fn is_transient_io_error(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
    ) || matches!(error.raw_os_error(), Some(11) | Some(35))
}

fn spawn_stdin_reader(tx: mpsc::UnboundedSender<StdinEvent>) -> io::Result<thread::JoinHandle<()>> {
    thread::Builder::new()
        .name("pi-host-stdin".into())
        .spawn(move || {
            let stdin = io::stdin();
            let mut reader = StdBufReader::new(stdin.lock());
            let mut line = String::new();

            loop {
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if tx
                            .send(StdinEvent::Line(std::mem::take(&mut line)))
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(error) if is_transient_io_error(&error) => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => {
                        let _ = tx.send(StdinEvent::Error(error.to_string()));
                        break;
                    }
                }
            }
        })
}

fn write_stdout_message(writer: &mut impl Write, message: &str) -> io::Result<()> {
    let bytes = message.as_bytes();
    let mut offset = 0;

    while offset < bytes.len() {
        match writer.write(&bytes[offset..]) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "stdout writer made no progress",
                ));
            }
            Ok(written) => offset += written,
            Err(error) if is_transient_io_error(&error) => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(error),
        }
    }

    loop {
        match writer.flush() {
            Ok(()) => return Ok(()),
            Err(error) if is_transient_io_error(&error) => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(error),
        }
    }
}

fn spawn_stdout_writer(
    mut rx: mpsc::UnboundedReceiver<String>,
    done_tx: oneshot::Sender<Option<String>>,
) -> io::Result<thread::JoinHandle<()>> {
    thread::Builder::new()
        .name("pi-host-stdout".into())
        .spawn(move || {
            let stdout = io::stdout();
            let mut writer = stdout.lock();
            let mut writer_error = None;

            while let Some(message) = rx.blocking_recv() {
                if let Err(error) = write_stdout_message(&mut writer, &message) {
                    writer_error = Some(error.to_string());
                    break;
                }
            }

            let _ = done_tx.send(writer_error);
        })
}

pub async fn serve(state: Arc<Mutex<AppState>>) -> Result<()> {
    let (tx, rx) = mpsc::unbounded_channel::<String>();
    // Keep request tasks bounded as well as tool executions. Tool calls have
    // their own class/session budgets below; this cap protects the host from
    // non-tool RPC bursts and prevents an unbounded tokio task fan-out.
    const MAX_IN_FLIGHT_RPC: usize = 32;
    let request_slots = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RPC));

    // Keep stdio off Tokio's blocking pool. Under process/thread pressure,
    // Tokio's stdio adapter can panic while trying to create a worker thread;
    // these two dedicated threads instead report startup errors or stop on a
    // closed pipe without taking down the async request dispatcher.
    let (writer_done_tx, mut writer_done_rx) = oneshot::channel::<Option<String>>();
    let _writer = spawn_stdout_writer(rx, writer_done_tx)
        .map_err(|error| anyhow!("host stdout writer unavailable: {error}"))?;
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<StdinEvent>();
    let _stdin_reader = match spawn_stdin_reader(input_tx) {
        Ok(handle) => handle,
        Err(error) => {
            drop(tx);
            let _ = writer_done_rx.await;
            return Err(anyhow!("host stdin reader unavailable: {error}"));
        }
    };

    let mut input_error = None;
    let mut writer_done = false;
    'serve: loop {
        tokio::select! {
            event = input_rx.recv() => {
                let Some(event) = event else {
                    break 'serve;
                };
                let line = match event {
                    StdinEvent::Line(line) => line,
                    StdinEvent::Error(error) => {
                        input_error = Some(format!("host stdin read failed: {error}"));
                        break 'serve;
                    }
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue 'serve;
                }

                let req: JsonRpcRequest = match serde_json::from_str(trimmed) {
                    Ok(r) => r,
                    Err(e) => {
                        let resp = JsonRpcResponse {
                            jsonrpc: "2.0",
                            id: Value::Null,
                            result: None,
                            error: Some(JsonRpcError {
                                code: -32700,
                                message: format!("parse error: {e}"),
                                data: None,
                            }),
                        };
                        let _ = tx.send(format!("{}\n", serde_json::to_string(&resp)?));
                        continue 'serve;
                    }
                };

                if req.id.is_none() {
                    continue 'serve;
                }

                let id = req.id.clone().unwrap_or(Value::Null);
                let method = req.method.clone();
                let params = req.params.unwrap_or(json!({}));
                let state = state.clone();
                let tx = tx.clone();
                let permit = match request_slots.clone().try_acquire_owned() {
                    Ok(permit) => permit,
                    Err(_) => {
                        let response = JsonRpcResponse {
                            jsonrpc: "2.0",
                            id,
                            result: None,
                            error: Some(rpc_err(
                                -32029,
                                "host RPC capacity is exhausted",
                                "HOST_OVERLOADED",
                            )),
                        };
                        if let Ok(raw) = serde_json::to_string(&response) {
                            let _ = tx.send(format!("{raw}\n"));
                        }
                        continue 'serve;
                    }
                };

                tokio::spawn(async move {
                    let _permit = permit;
                    let out = match handle_request(state, &method, params, tx.clone()).await {
                        Ok(result) => JsonRpcResponse {
                            jsonrpc: "2.0",
                            id,
                            result: Some(result),
                            error: None,
                        },
                        Err(err) => JsonRpcResponse {
                            jsonrpc: "2.0",
                            id,
                            result: None,
                            error: Some(err),
                        },
                    };
                    if let Ok(raw) = serde_json::to_string(&out) {
                        let _ = tx.send(format!("{raw}\n"));
                    }
                });
            }
            result = &mut writer_done_rx => {
                writer_done = true;
                input_error = match result {
                    Ok(Some(error)) => Some(format!("host stdout write failed: {error}")),
                    Ok(None) => Some("host stdout writer stopped".to_string()),
                    Err(_) => Some("host stdout writer status unavailable".to_string()),
                };
                break 'serve;
            }
        }
    }

    drop(tx);
    if !writer_done {
        input_error = match writer_done_rx.await {
            Ok(Some(error)) => Some(format!("host stdout write failed: {error}")),
            Ok(None) => input_error,
            Err(_) => Some("host stdout writer status unavailable".to_string()),
        };
    }
    input_error
        .map(|error| Err(anyhow!("{error}")))
        .unwrap_or(Ok(()))
}

fn rpc_err(code: i64, message: impl Into<String>, error_code: &str) -> JsonRpcError {
    JsonRpcError {
        code,
        message: message.into(),
        data: Some(json!({ "errorCode": error_code })),
    }
}

/// Parse the optional session thinking selector at the RPC boundary.  A
/// missing/null value keeps the backwards-compatible default; present values
/// must be strings from the host's allowlist rather than being silently
/// coerced to `off`.
fn thinking_level_param(params: &Value) -> Result<Option<String>, JsonRpcError> {
    let Some(value) = params.get("thinkingLevel") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let Some(level) = value.as_str() else {
        return Err(rpc_err(
            1002,
            "thinkingLevel must be a string",
            "INVALID_PARAMS",
        ));
    };
    if !sessions::is_valid_thinking_level(level) {
        return Err(rpc_err(
            1002,
            format!(
                "thinkingLevel must be one of {}",
                sessions::THINKING_LEVELS.join(", ")
            ),
            "INVALID_PARAMS",
        ));
    }
    Ok(Some(level.to_string()))
}

fn resolve_tool_workspace(
    state: &AppState,
    session_id: &str,
) -> Result<Option<String>, JsonRpcError> {
    match sessions::get_session(&state.db, session_id) {
        Ok(Some(detail)) => Ok(detail.summary.project_path),
        // Compatibility fallback for old callers that did not persist a
        // session before dispatching a tool request.
        Ok(None) => Ok(state.workspace.path.clone()),
        Err(error) => Err(rpc_err(1000, error.to_string(), "INTERNAL")),
    }
}

async fn emit_notification(tx: &mpsc::UnboundedSender<String>, method: &str, params: Value) {
    let note = JsonRpcNotification {
        jsonrpc: "2.0",
        method: method.to_string(),
        params,
    };
    if let Ok(raw) = serde_json::to_string(&note) {
        let _ = tx.send(format!("{raw}\n"));
    }
}

/// Dispatch a `plugin_*` tool to the desktop runner (Electron main), which
/// executes the plugin JS and answers via `plugins.resolveExecution`.
async fn execute_plugin_tool(
    state: &Arc<Mutex<AppState>>,
    tx: &mpsc::UnboundedSender<String>,
    p: &ToolsExecuteParams,
    timeout_ms: u64,
) -> tools::ToolsExecuteResult {
    let started = std::time::Instant::now();
    let execution_id = uuid::Uuid::new_v4().to_string();
    let (otx, orx) = tokio::sync::oneshot::channel::<Value>();
    {
        let mut st = state.lock().await;
        st.plugin_execs.insert(execution_id.clone(), otx);
    }
    emit_notification(
        tx,
        "plugins.execute",
        json!({
            "executionId": execution_id,
            "sessionId": p.session_id,
            "toolCallId": p.tool_call_id,
            "toolName": p.tool_name,
            "args": p.args,
        }),
    )
    .await;

    let outcome = tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), orx).await;
    let duration_ms = started.elapsed().as_millis() as u64;
    match outcome {
        Ok(Ok(resp)) => {
            let ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            let content = resp.get("content").cloned().unwrap_or(Value::Null);
            let error_code = resp
                .get("errorCode")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            tools::ToolsExecuteResult {
                tool_call_id: p.tool_call_id.clone(),
                ok,
                is_error: if ok { None } else { Some(true) },
                content,
                duration_ms,
                denied: None,
                error_code: if ok {
                    None
                } else {
                    Some(error_code.unwrap_or_else(|| "TOOL_FAILED".into()))
                },
            }
        }
        _ => {
            let mut st = state.lock().await;
            st.plugin_execs.remove(&execution_id);
            tools::ToolsExecuteResult {
                tool_call_id: p.tool_call_id.clone(),
                ok: false,
                is_error: Some(true),
                content: json!({
                    "error": "plugin tool dispatch timed out or no desktop runner is attached",
                    "code": "TOOL_TIMEOUT"
                }),
                duration_ms,
                denied: None,
                error_code: Some("TOOL_TIMEOUT".into()),
            }
        }
    }
}


fn plugin_err(err: impl ToString) -> JsonRpcError {
    let msg = err.to_string();
    if msg.contains("PLUGIN_INVALID") {
        rpc_err(1009, msg, "PLUGIN_INVALID")
    } else if msg.contains("PLUGIN_LOAD_FAILED") {
        rpc_err(1010, msg, "PLUGIN_LOAD_FAILED")
    } else if msg.contains("PLUGIN_INTEGRITY") {
        rpc_err(1012, msg, "PLUGIN_INTEGRITY")
    } else if msg.contains("PLUGIN_PERMISSION_DENIED") {
        rpc_err(1013, msg, "PLUGIN_PERMISSION_DENIED")
    } else if msg.contains("PLUGIN_NOT_FOUND") {
        rpc_err(1003, msg, "NOT_FOUND")
    } else if msg.contains("PLUGIN_NETWORK") {
        rpc_err(1014, msg, "PLUGIN_NETWORK")
    } else {
        rpc_err(1000, msg, "INTERNAL")
    }
}

/// Validation failures from the user-owned MCP registry are the user's typo,
/// not an internal fault, so they get a distinct code the UI can show inline.
fn scope_err(err: impl ToString) -> JsonRpcError {
    let msg = err.to_string();
    if msg.contains("MCP_INVALID") {
        rpc_err(1015, msg, "MCP_INVALID")
    } else {
        rpc_err(1000, msg, "INTERNAL")
    }
}

fn skill_err(err: impl ToString) -> JsonRpcError {
    let msg = err.to_string();
    if msg.contains("SKILL_INVALID") {
        rpc_err(1016, msg, "SKILL_INVALID")
    } else {
        rpc_err(1000, msg, "INTERNAL")
    }
}

/// Read the create/import/update payload for a user skill. Absent fields stay
/// absent so `update` can distinguish "unchanged" from "cleared".
fn parse_skill_input(params: &Value) -> Result<crate::user_skills::UserSkillInput, JsonRpcError> {
    let raw = params
        .get("skill")
        .cloned()
        .unwrap_or_else(|| params.clone());
    serde_json::from_value(raw).map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))
}

fn require_id(params: &Value) -> Result<String, JsonRpcError> {
    params
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))
}

/// Read an `ActivationScope` from request params, accepting either a nested
/// `scope` object or the flat `mode`/`projects` pair the renderer sends.
fn parse_scope(params: &Value) -> Result<crate::activation::ActivationScope, JsonRpcError> {
    let raw = match params.get("scope") {
        Some(scope) => scope.clone(),
        None => json!({
            "mode": params.get("mode").cloned().unwrap_or(json!("global")),
            "projects": params.get("projects").cloned().unwrap_or(json!([])),
        }),
    };
    serde_json::from_value(raw).map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))
}

async fn handle_request(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
    tx: mpsc::UnboundedSender<String>,
) -> Result<Value, JsonRpcError> {
    if method != "app.handshake" {
        let st = state.lock().await;
        if !st.handshook {
            return Err(rpc_err(1001, "handshake required", "UNAUTHORIZED"));
        }
    }

    match method {
        "app.handshake" => {
            let client_version = params
                .get("protocolVersion")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            if client_version != PROTOCOL_VERSION {
                return Err(rpc_err(
                    1011,
                    format!("protocol mismatch: client={client_version} host={PROTOCOL_VERSION}"),
                    "PROTOCOL_MISMATCH",
                ));
            }
            let mut st = state.lock().await;
            st.handshook = true;
            // Restore the current workspace from kv → projects.
            if let Ok(Some(pid)) = st.db.kv_get("app", "currentProjectId") {
                let pid = pid
                    .as_i64()
                    .or_else(|| pid.as_str().and_then(|s| s.parse::<i64>().ok()));
                if let Some(pid) = pid {
                    if let Ok(Some(path)) = st.db.project_path(pid) {
                        if !path.is_empty() {
                            st.workspace.set(PathBuf::from(path));
                        }
                    }
                }
            }
            Ok(json!({
                "protocolVersion": PROTOCOL_VERSION,
                "version": HOST_VERSION,
                "capabilities": [
                    "tools", "sessions", "providers", "secrets", "plugins", "permissions",
                    "scheduled", "artifacts", "search", "turns", "notifications"
                ]
            }))
        }
        "app.health" => {
            let st = state.lock().await;
            let budget = st.tool_budget.snapshot();
            Ok(json!({
                "ok": true,
                "protocolVersion": PROTOCOL_VERSION,
                "version": HOST_VERSION,
                "uptimeMs": st.uptime_ms(),
                "toolBudget": {
                    "active": budget.active,
                    "queued": budget.queued,
                    "total": budget.total,
                    "shell": budget.shell,
                    "reads": budget.reads,
                    "mutations": budget.mutations,
                    "plugins": budget.plugins
                }
            }))
        }
        "app.getVersion" => Ok(json!({
            "name": "pi-desktop-host-core",
            "version": HOST_VERSION,
            "protocolVersion": PROTOCOL_VERSION
        })),

        "workspace.get" => {
            let st = state.lock().await;
            Ok(json!({ "workspace": st.workspace.get() }))
        }
        "projects.list" => {
            let st = state.lock().await;
            let projects = st
                .db
                .list_projects()
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "projects": projects }))
        }
        "workspace.set" => {
            let path = params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "path required", "INVALID_PARAMS"))?;
            let mut st = state.lock().await;
            let ws = st.workspace.set(PathBuf::from(path));
            let pid = st
                .db
                .ensure_project(&ws.path, true)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            st.db
                .kv_set("app", "currentProjectId", &json!(pid))
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "workspace": ws }))
        }
        "workspace.clear" => {
            let mut st = state.lock().await;
            st.workspace.clear();
            st.db
                .kv_delete("app", "currentProjectId")
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }
        "review.rollback" => {
            let session_id = params
                .get("sessionId")
                .and_then(|value| value.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let snapshot_id = params
                .get("snapshotId")
                .and_then(|value| value.as_str())
                .ok_or_else(|| rpc_err(1002, "snapshotId required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let workspace_root = resolve_tool_workspace(&st, session_id)?;
            let outcome = review::rollback_change(
                &st.data_dir,
                session_id,
                snapshot_id,
                workspace_root.as_deref().map(std::path::Path::new),
            )
            .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
            if matches!(outcome.status, "rolledBack" | "alreadyRolledBack") {
                sessions::update_tool_review_state(
                    &st.db,
                    session_id,
                    &outcome.message_id,
                    snapshot_id,
                    "rolledBack",
                )
                .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
            }
            Ok(serde_json::to_value(outcome).map_err(|error| {
                rpc_err(1000, error.to_string(), "INTERNAL")
            })?)
        }

        "settings.get" => {
            let st = state.lock().await;
            let stored = st
                .db
                .get_setting("app")
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(stored.unwrap_or_else(|| {
                json!({
                    "defaultMode": "agent",
                    "theme": "dark",
                    "enterToSend": true,
                    "contextCompaction": {
                        "enabled": true,
                        "reserveTokens": 16384,
                        "keepRecentTokens": 20000
                    },
                    "onboardingDismissed": false
                })
            }))
        }
        "settings.set" => {
            let st = state.lock().await;
            st.db
                .set_setting("app", &params)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }

        "secrets.set" => {
            let secret_ref = params
                .get("secretRef")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "secretRef required", "INVALID_PARAMS"))?;
            let value = params
                .get("value")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "value required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let backend = st
                .secrets
                .set(secret_ref, value)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true, "backend": backend }))
        }
        "secrets.delete" => {
            let secret_ref = params
                .get("secretRef")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "secretRef required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            st.secrets
                .delete(secret_ref)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }
        "secrets.has" => {
            let secret_ref = params
                .get("secretRef")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "secretRef required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            Ok(json!({ "has": st.secrets.has(secret_ref) }))
        }
        "secrets.getForRuntime" => {
            let secret_ref = params
                .get("secretRef")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "secretRef required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let value = st
                .secrets
                .get(secret_ref)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "value": value }))
        }

        "providers.list" => {
            let include_disabled = params
                .get("includeDisabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let st = state.lock().await;
            let list = providers::list_providers(&st.db, &st.secrets, include_disabled)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "providers": list }))
        }
        "providers.create" => {
            let input: ProviderCreateInput = serde_json::from_value(params)
                .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let provider = providers::create_provider(&st.db, &st.secrets, input)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "provider": provider }))
        }
        "providers.update" => {
            let input: ProviderUpdateInput = serde_json::from_value(params)
                .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let provider = providers::update_provider(&st.db, &st.secrets, input)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "provider": provider }))
        }
        "providers.delete" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let ok = providers::delete_provider(&st.db, &st.secrets, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": ok }))
        }
        "providers.get" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let provider = providers::get_provider(&st.db, &st.secrets, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "provider": provider }))
        }
        "providers.getSecret" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let value = providers::get_secret_for_provider(&st.db, &st.secrets, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "value": value }))
        }
        "providers.listModels" => {
            let provider_id = params.get("providerId").and_then(|v| v.as_str());
            let st = state.lock().await;
            let models = providers::list_models(&st.db, provider_id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "models": models }))
        }
        "providers.cacheModels" => {
            let input: CacheModelsParams = serde_json::from_value(params)
                .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let cached =
                providers::cache_discovered_models(&st.db, &input.provider_id, &input.models)
                    .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            let models = providers::list_models(&st.db, Some(&input.provider_id))
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "cached": cached, "models": models }))
        }
        "providers.testConnection" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let provider = providers::get_provider(&st.db, &st.secrets, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                .ok_or_else(|| rpc_err(1007, "provider not found", "NOT_FOUND"))?;
            Ok(json!({
                "ok": provider.has_secret || provider.auth_kind == "none",
                "provider": provider
            }))
        }

        "session.list" => {
            let st = state.lock().await;
            let sessions = sessions::list_sessions(&st.db)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "sessions": sessions }))
        }
        "session.create" => {
            let thinking_level = thinking_level_param(&params)?;
            let st = state.lock().await;
            let session = sessions::create_session_with_thinking(
                &st.db,
                params
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                params
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                params
                    .get("providerId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                params
                    .get("modelId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                params
                    .get("projectPath")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                thinking_level,
            )
            .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "session": session }))
        }
        "session.fork" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let title = params.get("title").and_then(|v| v.as_str());
            let through_message_id = params
                .get("throughMessageId")
                .and_then(|v| v.as_str());
            let st = state.lock().await;
            let session =
                match sessions::fork_session_through(&st.db, session_id, title, through_message_id)
                    .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                {
                    sessions::ForkSessionResult::Created(session) => session,
                    sessions::ForkSessionResult::NotFound => {
                        return Err(rpc_err(1007, "session not found", "NOT_FOUND"))
                    }
                    sessions::ForkSessionResult::Busy => {
                        return Err(rpc_err(1008, "session is running", "CONFLICT"))
                    }
                };
            Ok(json!({ "session": session }))
        }
        "session.get" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let session = sessions::get_session(&st.db, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "session": session }))
        }
        "session.configure" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let mode = params
                .get("mode")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "mode required", "INVALID_PARAMS"))?;
            let thinking_level = thinking_level_param(&params)?;
            let st = state.lock().await;
            let session = sessions::configure_session_with_thinking(
                &st.db,
                id,
                mode,
                params.get("providerId").and_then(|v| v.as_str()),
                params.get("modelId").and_then(|v| v.as_str()),
                thinking_level.as_deref(),
                params.get("permissionMode").and_then(|v| v.as_str()),
            )
            .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?
            .ok_or_else(|| rpc_err(1007, "session not found", "NOT_FOUND"))?;
            Ok(json!({ "session": session }))
        }
        "session.delete" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let ok = sessions::delete_session(&st.db, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            if ok {
                scratch::remove_session_dir(&st.data_dir, id);
                review::remove_session(&st.data_dir, id);
            }
            Ok(json!({ "ok": ok }))
        }
        "session.rename" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let title = params
                .get("title")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "title required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let ok = sessions::rename_session(&st.db, id, title)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": ok }))
        }
        "session.appendMessage" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let message: UiMessage = serde_json::from_value(
                params
                    .get("message")
                    .cloned()
                    .ok_or_else(|| rpc_err(1002, "message required", "INVALID_PARAMS"))?,
            )
            .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let turn_id = params
                .get("turnId")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let st = state.lock().await;
            sessions::append_message(&st.db, session_id, &message, turn_id.as_deref())
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }
        "session.appendCompaction" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let compaction: CompactionRecord = serde_json::from_value(
                params
                    .get("compaction")
                    .cloned()
                    .ok_or_else(|| rpc_err(1002, "compaction required", "INVALID_PARAMS"))?,
            )
            .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let st = state.lock().await;
            sessions::append_compaction(&st.db, session_id, &compaction)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }
        "session.replaceMessages" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let messages: Vec<UiMessage> = serde_json::from_value(
                params
                    .get("messages")
                    .cloned()
                    .ok_or_else(|| rpc_err(1002, "messages required", "INVALID_PARAMS"))?,
            )
            .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let st = state.lock().await;
            sessions::replace_messages(&st.db, session_id, &messages)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }
        "session.saveRevision" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let root_user_id = params
                .get("rootUserId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "rootUserId required", "INVALID_PARAMS"))?;
            let messages: Vec<UiMessage> = serde_json::from_value(
                params
                    .get("messages")
                    .cloned()
                    .ok_or_else(|| rpc_err(1002, "messages required", "INVALID_PARAMS"))?,
            )
            .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let make_active = params
                .get("makeActive")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let st = state.lock().await;
            let revision = sessions::save_message_revision(
                &st.db,
                session_id,
                root_user_id,
                &messages,
                make_active,
            )
            .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "revision": revision }))
        }
        "session.listRevisions" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let root_user_id = params
                .get("rootUserId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "rootUserId required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let revisions =
                sessions::list_message_revisions(&st.db, session_id, root_user_id)
                    .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "revisions": revisions }))
        }
        "session.activateRevision" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let root_user_id = params
                .get("rootUserId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "rootUserId required", "INVALID_PARAMS"))?;
            let revision_index = params
                .get("revisionIndex")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| rpc_err(1002, "revisionIndex required", "INVALID_PARAMS"))?;
            let prefix: Vec<UiMessage> = serde_json::from_value(
                params
                    .get("prefix")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
            )
            .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let messages = sessions::activate_message_revision(
                &st.db,
                session_id,
                root_user_id,
                revision_index,
                &prefix,
            )
            .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "messages": messages }))
        }

        "session.import" => {
            let summary: sessions::SessionSummary = serde_json::from_value(
                params
                    .get("session")
                    .cloned()
                    .ok_or_else(|| rpc_err(1002, "session required", "INVALID_PARAMS"))?,
            )
            .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let messages: Vec<UiMessage> = serde_json::from_value(
                params
                    .get("messages")
                    .cloned()
                    .ok_or_else(|| rpc_err(1002, "messages required", "INVALID_PARAMS"))?,
            )
            .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let imported = sessions::import_session(&st.db, &summary, &messages)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true, "imported": imported, "skipped": !imported }))
        }

        "session.beginTurn" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let turn_id = sessions::begin_turn(
                &st.db,
                session_id,
                params.get("providerId").and_then(|v| v.as_str()),
                params.get("modelId").and_then(|v| v.as_str()),
            )
            .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "turnId": turn_id }))
        }
        "session.endTurn" => {
            let turn_id = params
                .get("turnId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "turnId required", "INVALID_PARAMS"))?;
            let status = params
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("completed");
            let st = state.lock().await;
            let result = sessions::end_turn(
                &st.db,
                turn_id,
                status,
                params.get("errorCode").and_then(|v| v.as_str()),
                params.get("usage"),
                params
                    .get("createNotification")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
            )
            .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            let mut response = json!({ "ok": result.updated });
            if let Some(notification) = result.notification {
                response["notification"] = json!(notification);
            }
            Ok(response)
        }

        "notification.list" => {
            let unread_only = params
                .get("unreadOnly")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let limit = params
                .get("limit")
                .and_then(|value| value.as_i64())
                .unwrap_or(crate::db::NOTIFICATION_KEEP);
            let st = state.lock().await;
            let (notifications, unread_count) = notifications::list(&st.db, unread_only, limit)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({
                "notifications": notifications,
                "unreadCount": unread_count
            }))
        }
        "notification.markRead" => {
            let id = params
                .get("id")
                .and_then(|value| value.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let ok = notifications::mark_read(&st.db, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": ok }))
        }
        "notification.markAllRead" => {
            let st = state.lock().await;
            notifications::mark_all_read(&st.db)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }
        "notification.clear" => {
            let st = state.lock().await;
            notifications::clear(&st.db).map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }

        "search.query" => {
            let query = params
                .get("query")
                .or_else(|| params.get("q"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = params.get("limit").and_then(|v| v.as_i64()).unwrap_or(20);
            let st = state.lock().await;
            let hits = sessions::search_messages(&st.db, query, limit)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "hits": hits }))
        }

        "artifacts.list" => {
            let session_id = params.get("sessionId").and_then(|v| v.as_str());
            let limit = params.get("limit").and_then(|v| v.as_i64()).unwrap_or(200);
            let st = state.lock().await;
            let artifacts = artifacts::list(&st.db, session_id, limit)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "artifacts": artifacts }))
        }

        "scheduled.list" => {
            let st = state.lock().await;
            let tasks = scheduled::list_tasks(&st.db)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "tasks": tasks }))
        }
        "scheduled.create" => {
            let st = state.lock().await;
            let task = scheduled::create_task(&st.db, &params)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "task": task }))
        }
        "scheduled.update" => {
            let st = state.lock().await;
            let task = scheduled::update_task(&st.db, &params)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                .ok_or_else(|| rpc_err(1007, "task not found", "NOT_FOUND"))?;
            Ok(json!({ "task": task }))
        }
        "scheduled.delete" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let ok = scheduled::delete_task(&st.db, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": ok }))
        }
        "scheduled.import" => {
            let tasks = params
                .get("tasks")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let st = state.lock().await;
            let imported = scheduled::import_tasks(&st.db, &tasks)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "imported": imported }))
        }
        "scheduled.run" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let task = scheduled::get_task(&st.db, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                .ok_or_else(|| rpc_err(1007, "task not found", "NOT_FOUND"))?;
            let settings = st
                .db
                .get_setting("app")
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                .unwrap_or_else(|| json!({}));
            let session = sessions::create_session(
                &st.db,
                Some(task.title.clone()),
                Some(
                    settings
                        .get("defaultMode")
                        .and_then(|v| v.as_str())
                        .unwrap_or("agent")
                        .to_string(),
                ),
                settings
                    .get("defaultProviderId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                settings
                    .get("defaultModelId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                st.workspace.get().map(|w| w.path),
            )
            .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            let run_id = match scheduled::begin_run(&st.db, id, Some(&session.id)) {
                Ok(run_id) => run_id,
                Err(error) => {
                    let _ = sessions::delete_session(&st.db, &session.id);
                    return Err(rpc_err(1000, error.to_string(), "INTERNAL"));
                }
            };
            let task = scheduled::get_task(&st.db, id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                .unwrap_or(task);
            Ok(json!({
                "sessionId": session.id,
                "prompt": task.prompt,
                "task": task,
                "runId": run_id
            }))
        }
        "scheduled.finishRun" => {
            let run_id = params
                .get("runId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "runId required", "INVALID_PARAMS"))?;
            let status = params
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("completed");
            let st = state.lock().await;
            let ok = scheduled::finish_run(
                &st.db,
                run_id,
                status,
                params.get("errorCode").and_then(|v| v.as_str()),
            )
            .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": ok }))
        }
        "scheduled.listRuns" => {
            let task_id = params.get("taskId").and_then(|v| v.as_str());
            let limit = params.get("limit").and_then(|v| v.as_i64()).unwrap_or(50);
            let st = state.lock().await;
            let runs = scheduled::list_runs(&st.db, task_id, limit)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "runs": runs }))
        }

        "tools.list" => Ok(json!({ "tools": tools::builtin_tool_defs() })),
        "tools.execute" => {
            // Segmented timing (D137): a slow tool call is almost never slow
            // *inside* the tool — the wait is either the approval prompt or the
            // model round trip that follows. Splitting the host's own share
            // into approval / execution / bookkeeping is what makes the three
            // distinguishable in host/timing.log instead of one opaque
            // duration.
            let call_started = std::time::Instant::now();
            let p: ToolsExecuteParams = serde_json::from_value(params.clone())
                .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;

            let (auto_decision, workspace_path, scratch_path, pending_rx, request_opt) = {
                let mut st = state.lock().await;
                st.permissions.expire_stale();
                // Effective permission mode (D115): per-session override
                // unless it is `inherit`, then the global settings default,
                // then `ask`. Unknown sessions (legacy callers) resolve to
                // the global default too.
                let session_pm = sessions::session_permission_mode(&st.db, &p.session_id)
                    .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                    .filter(|m| m != "inherit");
                let effective_pm = match session_pm {
                    Some(m) => m,
                    None => st
                        .db
                        .get_setting("app")
                        .ok()
                        .flatten()
                        .and_then(|s| {
                            s.get("defaultPermissionMode")
                                .and_then(|v| v.as_str())
                                .map(str::to_string)
                        })
                        .filter(|m| sessions::is_valid_permission_mode(m) && m != "inherit")
                        .unwrap_or_else(|| "ask".to_string()),
                };
                let mut auto = st.permissions.evaluate_auto_with_permission_mode(
                    &p.session_id,
                    &p.tool_name,
                    &p.mode,
                    &effective_pm,
                    &st.session_grants,
                );
                // Resolve the tool root from the persisted session instead of
                // the mutable global workspace. This keeps background turns
                // isolated when the renderer switches between project tabs.
                // Fall back to the global workspace only for legacy callers
                // that do not have a persisted session.
                let ws = resolve_tool_workspace(&st, &p.session_id)?;
                let scratch = scratch::session_dir(&st.data_dir, &p.session_id);
                // Write/Edit targeting the session scratch dir never touch
                // the user's project — skip the prompt (D114). The lexical
                // pre-check only decides prompting; execution still goes
                // through the symlink-aware resolver, so it cannot be used
                // to escape containment. Chat mode already resolved to Deny
                // above and is unaffected.
                if auto.is_none() && matches!(p.tool_name.as_str(), "Write" | "Edit") {
                    if let (Some(scratch_dir), Some(path)) = (
                        scratch.as_deref(),
                        p.args.get("path").and_then(|v| v.as_str()),
                    ) {
                        if workspace::lexically_inside(scratch_dir, path) {
                            auto = Some(PermissionDecision::AllowOnce);
                        }
                    }
                }
                if let Some(decision) = auto {
                    (Some(decision), ws, scratch, None, None)
                } else {
                    let reason = match p.tool_name.as_str() {
                        "Write" | "Edit" => "Modifies files in your workspace",
                        "Bash" => "Runs a shell command in your workspace",
                        name if name.starts_with("mcp_") => {
                            "MCP server tool requires approval"
                        }
                        name if name.starts_with("plugin_") => {
                            "Plugin-provided tool requires approval"
                        }
                        _ => "High-risk tool requires approval",
                    };
                    let (req, rx) = st.permissions.create_request(
                        &p.session_id,
                        &p.tool_call_id,
                        &p.tool_name,
                        p.args.clone(),
                        reason,
                    );
                    (None, ws, scratch, Some(rx), Some(req))
                }
            };

            let prompted = request_opt.is_some();
            if let Some(req) = request_opt {
                emit_notification(
                    &tx,
                    "permissions.request",
                    json!({
                        "requestId": req.request_id,
                        "sessionId": req.session_id,
                        "toolCallId": req.tool_call_id,
                        "toolName": req.tool_name,
                        "risk": req.risk,
                        "argsPreview": req.args_preview,
                        "reason": req.reason,
                        "timeoutMs": req.timeout_ms
                    }),
                )
                .await;
                tracing::info!(request_id = %req.request_id, tool = %req.tool_name, "permission required");
            }

            let final_decision = if let Some(d) = auto_decision {
                d
            } else if let Some(rx) = pending_rx {
                match tokio::time::timeout(
                    std::time::Duration::from_millis(crate::permissions::PERMISSION_TIMEOUT_MS),
                    rx,
                )
                .await
                {
                    Ok(Ok(d)) => d,
                    _ => PermissionDecision::Deny,
                }
            } else {
                PermissionDecision::Deny
            };
            // Everything up to here is approval: the auto-decision path costs
            // microseconds, the prompt path costs however long the user took.
            let permission_wait_ms = call_started.elapsed().as_millis() as u64;

            if matches!(final_decision, PermissionDecision::Deny) {
                let st = state.lock().await;
                let _ = audit::append(
                    &st.db,
                    "tool_denied",
                    Some(&p.session_id),
                    json!({
                        "toolName": p.tool_name,
                        "toolCallId": p.tool_call_id,
                        "mode": p.mode,
                        "prompted": prompted,
                        "permissionWaitMs": permission_wait_ms,
                        "totalMs": call_started.elapsed().as_millis() as u64
                    }),
                );
                tracing::info!(
                    tool = %p.tool_name,
                    tool_call_id = %p.tool_call_id,
                    session_id = %p.session_id,
                    prompted,
                    permission_wait_ms,
                    execute_ms = 0,
                    overhead_ms = 0,
                    total_ms = call_started.elapsed().as_millis() as u64,
                    outcome = "denied",
                    "tool timing"
                );
                let error_code = if p.mode != "agent"
                    && !PermissionManager::read_only_mode_allows(&p.tool_name)
                {
                    if p.tool_name == "Bash" {
                        "BASH_DISABLED_IN_READ_ONLY"
                    } else {
                        "WRITE_DISABLED_IN_READ_ONLY"
                    }
                } else {
                    "TOOL_DENIED"
                };
                return Ok(json!({
                    "toolCallId": p.tool_call_id,
                    "ok": false,
                    "isError": true,
                    "content": { "error": "permission denied", "code": error_code },
                    "durationMs": 0,
                    "denied": true,
                    "errorCode": error_code
                }));
            }

            if matches!(final_decision, PermissionDecision::AllowSession) {
                let mut st = state.lock().await;
                st.session_grants
                    .entry(p.session_id.clone())
                    .or_default()
                    .push(p.tool_name.clone());
            }

            // Admission happens after permission so a user waiting on a prompt
            // cannot occupy an execution slot. The permit is held through the
            // complete tool lifecycle and is released on every return path.
            let tool_budget = {
                let st = state.lock().await;
                st.tool_budget.clone()
            };
            let _tool_permit = match tool_budget.acquire(&p.session_id, &p.tool_name).await {
                Ok(permit) => permit,
                Err(error) => {
                    tracing::warn!(
                        tool = %p.tool_name,
                        session_id = %p.session_id,
                        error_code = error.code(),
                        "tool admission rejected"
                    );
                    return Ok(json!({
                        "toolCallId": p.tool_call_id,
                        "ok": false,
                        "isError": true,
                        "content": {
                            "error": error.message(),
                            "code": error.code()
                        },
                        "durationMs": call_started.elapsed().as_millis() as u64,
                        "denied": false,
                        "errorCode": error.code()
                    }));
                }
            };

            let ws_path = workspace_path.map(PathBuf::from);
            let timeout = p.timeout_ms.unwrap_or(60_000);
            let data_dir = { state.lock().await.data_dir.clone() };
            let pending_review = review::prepare_change(
                &data_dir,
                &p.session_id,
                &p.tool_call_id,
                ws_path.as_deref(),
                scratch_path.as_deref(),
                &p.tool_name,
                &p.args,
            )
            .unwrap_or_else(|error| {
                tracing::warn!(
                    session_id = %p.session_id,
                    tool_call_id = %p.tool_call_id,
                    error = %error,
                    "review snapshot preparation failed"
                );
                None
            });
            let mut result = if tools::is_desktop_dispatched(&p.tool_name) {
                execute_plugin_tool(&state, &tx, &p, timeout).await
            } else {
                tools::execute_tool(
                    ws_path.as_deref(),
                    scratch_path.as_deref(),
                    &p.tool_name,
                    &p.args,
                    timeout,
                )
                .await
            };
            result.tool_call_id = p.tool_call_id.clone();

            if let Some(pending) = pending_review {
                if result.ok {
                    match review::finalize_change(&pending) {
                        Ok(change) => {
                            if let Some(object) = result.content.as_object_mut() {
                                object.insert(
                                    "review".to_string(),
                                    serde_json::to_value(change).map_err(|error| {
                                        rpc_err(1000, error.to_string(), "INTERNAL")
                                    })?,
                                );
                            }
                        }
                        Err(error) => {
                            tracing::warn!(
                                session_id = %p.session_id,
                                tool_call_id = %p.tool_call_id,
                                error = %error,
                                "review snapshot finalization failed"
                            );
                            review::discard_change(pending);
                        }
                    }
                } else {
                    review::discard_change(pending);
                }
            }

            let st = state.lock().await;
            // Scratch files are temp by definition: keep them out of the
            // artifacts table so the work panel file list only shows
            // workspace deliverables (D114).
            let in_scratch =
                result.content.get("root").and_then(|v| v.as_str()) == Some("scratch");
            if result.ok && !in_scratch && matches!(p.tool_name.as_str(), "Write" | "Edit") {
                if let Some(rel) = result.content.get("path").and_then(|v| v.as_str()) {
                    let abs = match ws_path.as_deref() {
                        Some(root) => root.join(rel).to_string_lossy().to_string(),
                        None => rel.to_string(),
                    };
                    let op = if p.tool_name == "Write" {
                        "write"
                    } else {
                        "edit"
                    };
                    let _ =
                        artifacts::record(&st.db, &p.session_id, &abs, op, p.turn_id.as_deref());
                }
            }
            // `overhead_ms` is the host's own share outside approval and the
            // tool body: workspace resolution, the state lock, artifacts and
            // audit writes. It should stay near zero; if it does not, the
            // bottleneck is host-core itself rather than the user or the model.
            let total_ms = call_started.elapsed().as_millis() as u64;
            let overhead_ms =
                total_ms.saturating_sub(permission_wait_ms.saturating_add(result.duration_ms));
            let _ = audit::append(
                &st.db,
                "tool_execute",
                Some(&p.session_id),
                json!({
                    "toolName": p.tool_name,
                    "toolCallId": p.tool_call_id,
                    "ok": result.ok,
                    "durationMs": result.duration_ms,
                    "errorCode": result.error_code,
                    "prompted": prompted,
                    "permissionWaitMs": permission_wait_ms,
                    "overheadMs": overhead_ms,
                    "totalMs": total_ms
                }),
            );
            tracing::info!(
                tool = %p.tool_name,
                tool_call_id = %p.tool_call_id,
                session_id = %p.session_id,
                prompted,
                permission_wait_ms,
                execute_ms = result.duration_ms,
                overhead_ms,
                total_ms,
                outcome = if result.ok { "ok" } else { "error" },
                "tool timing"
            );

            serde_json::to_value(result).map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))
        }

        "permissions.evaluate" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let tool_name = params
                .get("toolName")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let mode = params
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("agent");
            let st = state.lock().await;
            let decision =
                st.permissions
                    .evaluate_auto(session_id, tool_name, mode, &st.session_grants);
            Ok(json!({
                "decision": decision,
                "risk": PermissionManager::tool_risk(tool_name)
            }))
        }
        "permissions.resolve" => {
            let request_id = params
                .get("requestId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "requestId required", "INVALID_PARAMS"))?;
            let decision_raw = params
                .get("decision")
                .and_then(|v| v.as_str())
                .unwrap_or("deny");
            let decision = match decision_raw {
                "allow-once" => PermissionDecision::AllowOnce,
                "allow-session" => PermissionDecision::AllowSession,
                _ => PermissionDecision::Deny,
            };
            let mut st = state.lock().await;
            st.permissions
                .resolve(request_id, decision)
                .map_err(|code| {
                    let c = if code == "NOT_FOUND" { 1007 } else { 1000 };
                    rpc_err(c, code.clone(), &code)
                })?;
            Ok(json!({ "ok": true }))
        }
        "permissions.listSessionGrants" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let st = state.lock().await;
            Ok(json!({
                "grants": st.session_grants.get(session_id).cloned().unwrap_or_default()
            }))
        }
        "permissions.clearSessionGrants" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let mut st = state.lock().await;
            st.session_grants.remove(session_id);
            Ok(json!({ "ok": true }))
        }

        "plugins.list" => {
            let st = state.lock().await;
            Ok(json!({ "plugins": st.plugins.list() }))
        }
        "plugins.resolveExecution" => {
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let sender = {
                let mut st = state.lock().await;
                st.plugin_execs.remove(execution_id)
            };
            match sender {
                Some(sender) => {
                    let _ = sender.send(params.clone());
                    Ok(json!({ "ok": true }))
                }
                None => Err(rpc_err(1003, "unknown executionId", "NOT_FOUND")),
            }
        }
        "plugins.loadDev" => {
            let path = params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "path required", "INVALID_PARAMS"))?;
            let mut st = state.lock().await;
            let plugin = st.plugins.load_dev(path).map_err(|e| {
                let msg = e.to_string();
                if msg.contains("PLUGIN_INVALID") {
                    rpc_err(1009, msg, "PLUGIN_INVALID")
                } else {
                    rpc_err(1010, msg, "PLUGIN_LOAD_FAILED")
                }
            })?;
            Ok(json!({ "plugin": plugin }))
        }
        "plugins.enable" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let mut st = state.lock().await;
            let plugin = st
                .plugins
                .set_enabled(id, true)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "plugin": plugin }))
        }
        "plugins.disable" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let mut st = state.lock().await;
            let plugin = st
                .plugins
                .set_enabled(id, false)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "plugin": plugin }))
        }
        "plugins.uninstall" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let mut st = state.lock().await;
            let ok = st
                .plugins
                .uninstall(id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": ok }))
        }
        "plugins.getPermissions" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let plugin = st.plugins.list().into_iter().find(|p| p.id == id);
            Ok(json!({
                "permissions": plugin.map(|p| p.permissions).unwrap_or_default()
            }))
        }
        "plugins.installFromPath" => {
            let path = params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "path required", "INVALID_PARAMS"))?;
            let enable = params
                .get("enable")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let granted = params
                .get("grantedPermissions")
                .cloned()
                .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok());
            let mut st = state.lock().await;
            let result = st
                .plugins
                .install_from_path(
                    path,
                    crate::plugins::InstallOptions {
                        source: "installed".into(),
                        enable,
                        marketplace: None,
                        expected_shasum: None,
                        auto_update: false,
                        granted_permissions: granted,
                    },
                )
                .map_err(|e| plugin_err(e))?;
            Ok(json!({ "result": result }))
        }
        "plugins.installFromPackage" => {
            let path = params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "path required", "INVALID_PARAMS"))?;
            let enable = params
                .get("enable")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let granted = params
                .get("grantedPermissions")
                .cloned()
                .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok());
            let expected_shasum = params
                .get("expectedShasum")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mut st = state.lock().await;
            let result = st
                .plugins
                .install_from_package(
                    path,
                    crate::plugins::InstallOptions {
                        source: "installed".into(),
                        enable,
                        marketplace: None,
                        expected_shasum,
                        auto_update: false,
                        granted_permissions: granted,
                    },
                )
                .map_err(|e| plugin_err(e))?;
            Ok(json!({ "result": result }))
        }
        "plugins.grantPermissions" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let permissions = params
                .get("permissions")
                .cloned()
                .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
                .unwrap_or_default();
            let mut st = state.lock().await;
            let plugin = st
                .plugins
                .grant_permissions(id, permissions)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "plugin": plugin }))
        }
        "plugins.revokePermissions" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let permissions = params
                .get("permissions")
                .cloned()
                .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
                .unwrap_or_default();
            let mut st = state.lock().await;
            let plugin = st
                .plugins
                .revoke_permissions(id, permissions)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "plugin": plugin }))
        }
        "plugins.setAutoUpdate" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let enabled = params
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let mut st = state.lock().await;
            let plugin = st
                .plugins
                .set_auto_update(id, enabled)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "plugin": plugin }))
        }
        "plugins.setScope" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let scope = parse_scope(&params)?;
            let mut st = state.lock().await;
            let plugin = st
                .plugins
                .set_scope(id, scope)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "plugin": plugin }))
        }

        "mcp.list" => {
            let st = state.lock().await;
            Ok(json!({ "servers": st.mcp_servers.list() }))
        }
        "mcp.active" => {
            // The agent-facing view: what a session on this project may reach.
            let project_path = params.get("projectPath").and_then(|v| v.as_str());
            let st = state.lock().await;
            Ok(json!({ "servers": st.mcp_servers.active_for(project_path) }))
        }
        "mcp.upsert" => {
            let input: crate::mcp_servers::McpServerInput =
                serde_json::from_value(params.get("server").cloned().unwrap_or(params.clone()))
                    .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
            let mut st = state.lock().await;
            let server = st.mcp_servers.upsert(input).map_err(scope_err)?;
            Ok(json!({ "server": server }))
        }
        "mcp.remove" => {
            let id = require_id(&params)?;
            let mut st = state.lock().await;
            let ok = st
                .mcp_servers
                .remove(&id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": ok }))
        }
        "mcp.setEnabled" => {
            let id = require_id(&params)?;
            let enabled = params
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let mut st = state.lock().await;
            let server = st
                .mcp_servers
                .set_enabled(&id, enabled)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "server": server }))
        }
        "mcp.setScope" => {
            let id = require_id(&params)?;
            let scope = parse_scope(&params)?;
            let mut st = state.lock().await;
            let server = st
                .mcp_servers
                .set_scope(&id, scope)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "server": server }))
        }

        "skills.list" => {
            let st = state.lock().await;
            Ok(json!({ "skills": st.user_skills.list() }))
        }
        "skills.active" => {
            let project_path = params.get("projectPath").and_then(|v| v.as_str());
            let st = state.lock().await;
            Ok(json!({ "skills": st.user_skills.active_for(project_path) }))
        }
        "skills.create" => {
            let input = parse_skill_input(&params)?;
            let mut st = state.lock().await;
            let skill = st.user_skills.create(input).map_err(skill_err)?;
            Ok(json!({ "skill": skill }))
        }
        "skills.import" => {
            let source = params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "path required", "INVALID_PARAMS"))?
                .to_string();
            let input = parse_skill_input(&params)?;
            let mut st = state.lock().await;
            let skill = st.user_skills.import(&source, input).map_err(skill_err)?;
            Ok(json!({ "skill": skill }))
        }
        "skills.update" => {
            let id = require_id(&params)?;
            let input = parse_skill_input(&params)?;
            let mut st = state.lock().await;
            let skill = st.user_skills.update(&id, input).map_err(skill_err)?;
            Ok(json!({ "skill": skill }))
        }
        "skills.read" => {
            let id = require_id(&params)?;
            let st = state.lock().await;
            match st.user_skills.read(&id).map_err(skill_err)? {
                Some((skill, body)) => Ok(json!({ "skill": skill, "body": body })),
                None => Ok(json!({ "skill": null, "body": null })),
            }
        }
        "skills.remove" => {
            let id = require_id(&params)?;
            let mut st = state.lock().await;
            let ok = st
                .user_skills
                .remove(&id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": ok }))
        }
        "skills.setEnabled" => {
            let id = require_id(&params)?;
            let enabled = params
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let mut st = state.lock().await;
            let skill = st
                .user_skills
                .set_enabled(&id, enabled)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "skill": skill }))
        }
        "skills.setScope" => {
            let id = require_id(&params)?;
            let scope = parse_scope(&params)?;
            let mut st = state.lock().await;
            let skill = st
                .user_skills
                .set_scope(&id, scope)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "skill": skill }))
        }

        "market.refresh" => {
            let force = params
                .get("force")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let st = state.lock().await;
            let meta = st
                .plugins
                .refresh_market(force)
                .map_err(|e| plugin_err(e))?;
            Ok(meta)
        }
        "market.search" => {
            let query = params.get("query").and_then(|v| v.as_str());
            let category = params.get("category").and_then(|v| v.as_str());
            let st = state.lock().await;
            let plugins = st
                .plugins
                .market_search(query, category)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "plugins": plugins, "providerId": "official" }))
        }
        "market.getDetail" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let plugin = st
                .plugins
                .market_get(id)
                .map_err(|e| plugin_err(e))?;
            Ok(json!({ "plugin": plugin }))
        }
        "market.install" => {
            let id = params
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
            let version = params.get("version").and_then(|v| v.as_str());
            let enable = params
                .get("enable")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let auto_update = params
                .get("autoUpdate")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let granted = params
                .get("grantedPermissions")
                .cloned()
                .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok());
            let mut st = state.lock().await;
            let result = st
                .plugins
                .install_from_market(id, version, enable, auto_update, granted)
                .map_err(|e| plugin_err(e))?;
            Ok(json!({ "result": result }))
        }
        "market.checkUpdates" => {
            let mut st = state.lock().await;
            let updates = st
                .plugins
                .check_updates()
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "updates": updates, "plugins": st.plugins.list() }))
        }
        "market.applyUpdates" => {
            let only_auto = params
                .get("onlyAuto")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let mut st = state.lock().await;
            let results = st
                .plugins
                .apply_updates(only_auto)
                .map_err(|e| plugin_err(e))?;
            Ok(json!({ "results": results, "plugins": st.plugins.list() }))
        }

        "app.getOnboarding" => {
            let st = state.lock().await;
            let settings = st
                .db
                .get_setting("app")
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                .unwrap_or_else(|| json!({}));
            let dismissed = settings
                .get("onboardingDismissed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let providers = providers::list_providers(&st.db, &st.secrets, true)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            let has_provider = !providers.is_empty();
            let has_secret = providers.iter().any(|p| p.has_secret);
            let has_project = st.workspace.get().is_some();
            let session_count = sessions::session_count(&st.db)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            let has_session = session_count > 0;
            let steps = vec![
                json!({"id":"provider","title":"Add a model provider","done": has_provider, "action":"settings.providers"}),
                json!({"id":"secret","title":"Save your API key","done": has_secret, "action":"settings.providers"}),
                json!({"id":"project","title":"Open a project folder","done": has_project, "action":"project.open"}),
                json!({"id":"prompt","title":"Send your first prompt","done": has_session, "action":"chat.focus"}),
                json!({"id":"plugin","title":"Load a development plugin (optional)","done": !st.plugins.list().is_empty(), "action":"plugins.open"}),
            ];
            let critical_incomplete = !has_provider || !has_secret || !has_session;
            Ok(json!({
                "showChecklist": critical_incomplete && !dismissed,
                "steps": steps
            }))
        }

        "audit.append" => {
            let kind = params
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("custom");
            let session_id = params.get("sessionId").and_then(|v| v.as_str());
            let payload = params.get("payload").cloned().unwrap_or(json!({}));
            let st = state.lock().await;
            audit::append(&st.db, kind, session_id, payload)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }

        _ => Err(rpc_err(
            -32601,
            format!("method not found: {method}"),
            "NOT_FOUND",
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::{self, Write};
    use std::sync::Arc;

    use serde_json::json;
    use tokio::sync::{mpsc, Mutex};

    use super::{handle_request, resolve_tool_workspace};
    use crate::sessions;
    use crate::state::AppState;

    #[test]
    fn control_stdio_treats_os_resource_pressure_as_transient() {
        assert!(super::is_transient_io_error(&io::Error::from(
            io::ErrorKind::WouldBlock
        )));
        assert!(super::is_transient_io_error(&io::Error::from(
            io::ErrorKind::Interrupted
        )));
        assert!(super::is_transient_io_error(&io::Error::from_raw_os_error(
            11
        )));
        assert!(super::is_transient_io_error(&io::Error::from_raw_os_error(
            35
        )));
        assert!(!super::is_transient_io_error(&io::Error::from(
            io::ErrorKind::BrokenPipe
        )));
    }

    #[test]
    fn stdout_message_retries_partial_writes_without_duplication() {
        struct PartialWriter {
            bytes: Vec<u8>,
            blocked: bool,
        }

        impl Write for PartialWriter {
            fn write(&mut self, input: &[u8]) -> io::Result<usize> {
                if self.blocked {
                    self.blocked = false;
                    return Err(io::Error::from(io::ErrorKind::WouldBlock));
                }
                let written = input.len().min(2);
                self.bytes.extend_from_slice(&input[..written]);
                Ok(written)
            }

            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }

        let mut writer = PartialWriter {
            bytes: Vec::new(),
            blocked: true,
        };
        assert!(super::write_stdout_message(&mut writer, "hello").is_ok());
        assert_eq!(writer.bytes, b"hello");
    }

    #[test]
    fn tool_workspace_follows_the_persisted_session_project() {
        let data_dir = tempfile::tempdir().unwrap();
        let project_a = data_dir.path().join("project-a");
        let project_b = data_dir.path().join("project-b");
        fs::create_dir_all(&project_a).unwrap();
        fs::create_dir_all(&project_b).unwrap();
        let mut state = AppState::open(data_dir.path()).unwrap();
        state.workspace.set(&project_b);
        let session = sessions::create_session(
            &state.db,
            Some("Project A".into()),
            Some("agent".into()),
            None,
            None,
            Some(project_a.to_string_lossy().into_owned()),
        )
        .unwrap();

        let resolved = resolve_tool_workspace(&state, &session.id).unwrap();

        assert_eq!(
            resolved.as_deref(),
            Some(project_a.canonicalize().unwrap().to_string_lossy().as_ref())
        );
    }

    #[test]
    fn temporary_session_does_not_inherit_the_active_workspace() {
        let data_dir = tempfile::tempdir().unwrap();
        let active_project = data_dir.path().join("active-project");
        fs::create_dir_all(&active_project).unwrap();
        let mut state = AppState::open(data_dir.path()).unwrap();
        state.workspace.set(&active_project);
        let session = sessions::create_session(
            &state.db,
            Some("Temporary".into()),
            Some("agent".into()),
            None,
            None,
            None,
        )
        .unwrap();

        assert_eq!(resolve_tool_workspace(&state, &session.id).unwrap(), None);
        assert_eq!(
            resolve_tool_workspace(&state, "legacy-missing-session").unwrap(),
            state.workspace.path
        );
    }

    /// D137: the audit row for a tool call must carry the three segments
    /// separately, so "the tool was slow" can be told apart from "the user
    /// took 20s to approve it".
    #[tokio::test]
    async fn tool_execute_audit_records_segmented_timing() {
        let data_dir = tempfile::tempdir().unwrap();
        let project = data_dir.path().join("project");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join("note.txt"), "hello").unwrap();
        let mut app_state = AppState::open(data_dir.path()).unwrap();
        app_state.handshook = true;
        let session = sessions::create_session(
            &app_state.db,
            Some("Timing".into()),
            Some("agent".into()),
            None,
            None,
            Some(project.to_string_lossy().into_owned()),
        )
        .unwrap();
        let state = Arc::new(Mutex::new(app_state));
        let (tx, _rx) = mpsc::unbounded_channel();

        // Read is low risk, so it auto-allows and never prompts — the run
        // therefore has a zero approval segment by construction.
        let result = handle_request(
            state.clone(),
            "tools.execute",
            json!({
                "sessionId": session.id,
                "toolCallId": "tc-1",
                "toolName": "Read",
                "args": { "path": "note.txt" },
                "mode": "agent"
            }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(result["ok"], json!(true), "read succeeded: {result}");

        let st = state.lock().await;
        let payload: String = st
            .db
            .conn()
            .query_row(
                "SELECT payload_json FROM audit_log WHERE kind = 'tool_execute' ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let payload: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(payload["toolName"], json!("Read"));
        assert_eq!(payload["prompted"], json!(false));
        // Auto-allowed, so the approval segment is bookkeeping only: assert it
        // is negligible rather than exactly zero, since a loaded test runner
        // can still spend a millisecond there.
        let permission_wait_ms = payload["permissionWaitMs"].as_u64().unwrap();
        assert!(
            permission_wait_ms < 100,
            "auto-allow does not wait: {permission_wait_ms}ms"
        );
        let execute_ms = payload["durationMs"].as_u64().unwrap();
        let overhead_ms = payload["overheadMs"].as_u64().unwrap();
        let total_ms = payload["totalMs"].as_u64().unwrap();
        assert!(
            total_ms >= execute_ms,
            "total {total_ms} covers execution {execute_ms}"
        );
        assert_eq!(
            overhead_ms,
            total_ms - execute_ms - permission_wait_ms,
            "segments add up to the total"
        );
    }

    #[tokio::test]
    async fn provider_model_cache_roundtrips_through_rpc() {
        let data_dir = tempfile::tempdir().unwrap();
        let mut app_state = AppState::open(data_dir.path()).unwrap();
        app_state.handshook = true;
        let state = Arc::new(Mutex::new(app_state));
        let (tx, _rx) = mpsc::unbounded_channel();

        let created = handle_request(
            state.clone(),
            "providers.create",
            json!({
                "name": "Local catalog",
                "baseUrl": "http://localhost:11434/v1",
                "authKind": "none",
                "defaultModelId": "model-a"
            }),
            tx.clone(),
        )
        .await
        .unwrap();
        let provider_id = created["provider"]["id"].as_str().unwrap();

        let cached = handle_request(
            state.clone(),
            "providers.cacheModels",
            json!({
                "providerId": provider_id,
                "models": [
                    {
                        "modelId": "model-a",
                        "displayName": "Model A",
                        "capabilities": ["text"]
                    },
                    {
                        "modelId": "model-b",
                        "displayName": "Model B",
                        "capabilities": ["text", "reasoning"]
                    }
                ]
            }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(cached["cached"], 2);

        let listed = handle_request(
            state,
            "providers.listModels",
            json!({ "providerId": provider_id }),
            tx,
        )
        .await
        .unwrap();
        assert_eq!(listed["models"].as_array().unwrap().len(), 2);
        assert_eq!(listed["models"][1]["modelId"], "model-b");
        assert_eq!(listed["models"][1]["capabilities"][1], "reasoning");
    }

    #[tokio::test]
    async fn notification_rpc_lifecycle() {
        let data_dir = tempfile::tempdir().unwrap();
        let mut app_state = AppState::open(data_dir.path()).unwrap();
        app_state.handshook = true;
        let session = sessions::create_session(
            &app_state.db,
            Some("RPC task".into()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let turn = sessions::begin_turn(&app_state.db, &session.id, None, None).unwrap();
        sessions::end_turn(&app_state.db, &turn, "completed", None, None, true).unwrap();
        let visible_turn = sessions::begin_turn(&app_state.db, &session.id, None, None).unwrap();
        let state = Arc::new(Mutex::new(app_state));
        let (tx, _rx) = mpsc::unbounded_channel();

        let ended_visible = handle_request(
            state.clone(),
            "session.endTurn",
            json!({
                "turnId": visible_turn,
                "status": "completed",
                "createNotification": false
            }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(ended_visible, json!({ "ok": true }));

        let listed = handle_request(
            state.clone(),
            "notification.list",
            json!({ "unreadOnly": true, "limit": 10 }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(listed["unreadCount"], 1);
        assert_eq!(listed["notifications"][0]["kind"], "task.completed");
        assert_eq!(listed["notifications"][0]["sessionTitle"], "RPC task");
        let id = listed["notifications"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let marked = handle_request(
            state.clone(),
            "notification.markRead",
            json!({ "id": id }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(marked, json!({ "ok": true }));
        let marked_all = handle_request(
            state.clone(),
            "notification.markAllRead",
            json!({}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(marked_all, json!({ "ok": true }));
        let cleared = handle_request(state.clone(), "notification.clear", json!({}), tx)
            .await
            .unwrap();
        assert_eq!(cleared, json!({ "ok": true }));

        let remaining: i64 = state
            .lock()
            .await
            .db
            .conn()
            .query_row("SELECT COUNT(*) FROM notifications", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }
}
