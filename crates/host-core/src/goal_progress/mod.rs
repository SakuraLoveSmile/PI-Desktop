use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

use crate::db::Database;

pub const GOAL_PROGRESS_KV_NAMESPACE: &str = "goal_progress_v1";
pub const GOAL_PROGRESS_AUTH_KV_NAMESPACE: &str = "goal_progress_auth_v1";
pub const GOAL_PROGRESS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgressItem {
    pub id: String,
    pub label: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgressSnapshot {
    pub schema_version: u32,
    pub session_id: String,
    pub proposal_id: String,
    pub execution_id: String,
    pub revision: i64,
    pub items: Vec<GoalProgressItem>,
    pub updated_at: i64,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn execution_turn_id(db: &Database, execution_id: &str) -> Result<Option<String>> {
    Ok(db
        .conn()
        .prepare_cached("SELECT turn_id FROM goal_reports WHERE execution_id = ?1")?
        .query_row(params![execution_id], |row| row.get(0))
        .optional()?
        .flatten())
}

pub fn invalidate_write_token_conn(conn: &Connection, execution_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM kv WHERE ns = ?1 AND key = ?2",
        params![GOAL_PROGRESS_AUTH_KV_NAMESPACE, execution_id],
    )?;
    Ok(())
}

pub fn cleanup_auth_tokens_conn(conn: &Connection) -> Result<()> {
    conn.execute(
        "DELETE FROM kv WHERE ns = ?1",
        params![GOAL_PROGRESS_AUTH_KV_NAMESPACE],
    )?;
    Ok(())
}

pub fn cleanup_session_conn(conn: &Connection, session_id: &str) -> Result<()> {
    let mut stmt =
        conn.prepare_cached("SELECT ns, key, value_json FROM kv WHERE ns IN (?1, ?2)")?;
    let rows = stmt.query_map(
        params![GOAL_PROGRESS_KV_NAMESPACE, GOAL_PROGRESS_AUTH_KV_NAMESPACE],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    )?;
    let mut keys = Vec::new();
    for row in rows {
        let (namespace, key, value) = row?;
        if serde_json::from_str::<Value>(&value)
            .ok()
            .and_then(|payload| {
                payload
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .as_deref()
            == Some(session_id)
        {
            keys.push((namespace, key));
        }
    }
    let mut delete = conn.prepare_cached("DELETE FROM kv WHERE ns = ?1 AND key = ?2")?;
    for (namespace, key) in keys {
        delete.execute(params![namespace, key])?;
    }
    Ok(())
}

pub fn issue_write_token(
    db: &Database,
    session_id: &str,
    execution_id: &str,
    turn_id: &str,
) -> Result<String> {
    let row: Option<(String, Option<String>, String, Option<String>)> = db
        .conn()
        .prepare_cached(
            "SELECT session_id, execution_state, request_id, COALESCE(execution_kind, kind) FROM plan_approvals WHERE execution_id = ?1",
        )?
        .query_row(params![execution_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .optional()?;

    let (stored_session_id, execution_state, proposal_id, execution_kind) =
        row.ok_or_else(|| anyhow!("UNAUTHORIZED: execution not found"))?;

    if stored_session_id != session_id {
        return Err(anyhow!("UNAUTHORIZED: session mismatch"));
    }
    if execution_state.as_deref() != Some("running") {
        return Err(anyhow!(
            "GOAL_PROGRESS_NOT_RUNNING: execution is not running"
        ));
    }
    if execution_kind.as_deref() != Some("goal") {
        return Err(anyhow!("UNAUTHORIZED: execution is not a Goal"));
    }

    let bound_turn_id = execution_turn_id(db, execution_id)?
        .ok_or_else(|| anyhow!("UNAUTHORIZED: Goal execution turn is not bound"))?;
    if bound_turn_id != turn_id {
        return Err(anyhow!("UNAUTHORIZED: turn mismatch"));
    }

    let turn_ended: Option<Option<i64>> = db
        .conn()
        .prepare_cached("SELECT ended_at FROM turns WHERE id = ?1 AND session_id = ?2")?
        .query_row(params![turn_id, session_id], |r| r.get(0))
        .optional()?;

    if let Some(ended) = turn_ended {
        if ended.is_some() {
            return Err(anyhow!("GOAL_PROGRESS_NOT_RUNNING: turn has ended"));
        }
    } else {
        return Err(anyhow!("GOAL_PROGRESS_NOT_RUNNING: turn not found"));
    }

    let write_token = format!("gptk_{}", Uuid::new_v4().simple());
    let now = now_ms();
    let auth_payload = json!({
        "writeToken": write_token,
        "sessionId": session_id,
        "executionId": execution_id,
        "proposalId": proposal_id,
        "turnId": turn_id,
        "createdAt": now,
    });

    db.conn().prepare_cached(
        "INSERT INTO kv (ns, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(ns, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
    )?.execute(params![
        GOAL_PROGRESS_AUTH_KV_NAMESPACE,
        execution_id,
        auth_payload.to_string(),
        now,
    ])?;

    Ok(write_token)
}

pub fn get_progress(
    db: &Database,
    session_id: Option<&str>,
    execution_id: &str,
) -> Result<Option<GoalProgressSnapshot>> {
    let row: Option<String> = db
        .conn()
        .prepare_cached("SELECT value_json FROM kv WHERE ns = ?1 AND key = ?2")?
        .query_row(params![GOAL_PROGRESS_KV_NAMESPACE, execution_id], |r| {
            r.get(0)
        })
        .optional()?;

    if let Some(json_str) = row {
        let snapshot: GoalProgressSnapshot = serde_json::from_str(&json_str)?;
        if let Some(expected_session) = session_id {
            if snapshot.session_id != expected_session {
                return Err(anyhow!("UNAUTHORIZED: session mismatch"));
            }
        }
        Ok(Some(snapshot))
    } else {
        Ok(None)
    }
}

pub fn update_progress(
    db: &Database,
    session_id: &str,
    execution_id: &str,
    write_token: &str,
    expected_revision: Option<i64>,
    items: Vec<GoalProgressItem>,
) -> Result<GoalProgressSnapshot> {
    // 1. Verify execution & session
    let row: Option<(String, Option<String>, String, Option<String>)> = db
        .conn()
        .prepare_cached(
            "SELECT session_id, execution_state, request_id, COALESCE(execution_kind, kind) FROM plan_approvals WHERE execution_id = ?1",
        )?
        .query_row(params![execution_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .optional()?;

    let (stored_session_id, execution_state, proposal_id, execution_kind) =
        row.ok_or_else(|| anyhow!("UNAUTHORIZED: execution not found"))?;

    if stored_session_id != session_id {
        return Err(anyhow!("UNAUTHORIZED: session mismatch"));
    }
    if execution_state.as_deref() != Some("running") {
        return Err(anyhow!(
            "GOAL_PROGRESS_NOT_RUNNING: execution is not running"
        ));
    }
    if execution_kind.as_deref() != Some("goal") {
        return Err(anyhow!("UNAUTHORIZED: execution is not a Goal"));
    }

    // 2. Verify writeToken and auth record
    let auth_str: Option<String> = db
        .conn()
        .prepare_cached("SELECT value_json FROM kv WHERE ns = ?1 AND key = ?2")?
        .query_row(
            params![GOAL_PROGRESS_AUTH_KV_NAMESPACE, execution_id],
            |r| r.get(0),
        )
        .optional()?;

    let auth_val: Value = auth_str
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or_else(|| anyhow!("UNAUTHORIZED: no write authorization exists"))?;

    let recorded_token = auth_val
        .get("writeToken")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if recorded_token.is_empty() || recorded_token != write_token {
        return Err(anyhow!("UNAUTHORIZED: invalid writeToken"));
    }

    let turn_id = auth_val
        .get("turnId")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("UNAUTHORIZED: turn identity missing in auth record"))?;
    if execution_turn_id(db, execution_id)?.as_deref() != Some(turn_id) {
        return Err(anyhow!("UNAUTHORIZED: turn mismatch"));
    }

    // 3. Verify turn is running in turns table (ended_at is null)
    let turn_ended: Option<Option<i64>> = db
        .conn()
        .prepare_cached("SELECT ended_at FROM turns WHERE id = ?1 AND session_id = ?2")?
        .query_row(params![turn_id, session_id], |r| r.get(0))
        .optional()?;

    if let Some(ended) = turn_ended {
        if ended.is_some() {
            return Err(anyhow!("GOAL_PROGRESS_NOT_RUNNING: turn has ended"));
        }
    } else {
        return Err(anyhow!("GOAL_PROGRESS_NOT_RUNNING: turn not found"));
    }

    // 4. Validate items
    let mut seen_ids = HashSet::new();
    for (idx, item) in items.iter().enumerate() {
        if item.id.trim().is_empty() {
            return Err(anyhow!(
                "INVALID_ARGUMENT: items[{}].id cannot be empty",
                idx
            ));
        }
        let id = item.id.trim();
        if !seen_ids.insert(id.to_string()) {
            return Err(anyhow!("INVALID_ARGUMENT: duplicate item id {}", id));
        }
        if item.label.trim().is_empty() {
            return Err(anyhow!(
                "INVALID_ARGUMENT: items[{}].label cannot be empty",
                idx
            ));
        }
        if !matches!(
            item.status.as_str(),
            "pending" | "in_progress" | "completed" | "failed"
        ) {
            return Err(anyhow!(
                "INVALID_ARGUMENT: invalid item status {}",
                item.status
            ));
        }
    }

    // 5. Concurrency check
    let existing = get_progress(db, Some(session_id), execution_id)?;
    let new_revision = match existing {
        Some(ref snap) => {
            if let Some(exp) = expected_revision {
                if snap.revision != exp {
                    return Err(anyhow!(
                        "CONFLICT: expected revision {}, current revision is {}",
                        exp,
                        snap.revision
                    ));
                }
            }
            snap.revision + 1
        }
        None => {
            if let Some(exp) = expected_revision {
                if exp != 0 {
                    return Err(anyhow!(
                        "CONFLICT: expected revision {} but snapshot does not exist",
                        exp
                    ));
                }
            }
            1
        }
    };

    let now = now_ms();
    let items = items
        .into_iter()
        .map(|item| GoalProgressItem {
            id: item.id.trim().to_string(),
            label: item.label.trim().to_string(),
            status: item.status,
        })
        .collect();
    let snapshot = GoalProgressSnapshot {
        schema_version: GOAL_PROGRESS_SCHEMA_VERSION,
        session_id: session_id.to_string(),
        proposal_id,
        execution_id: execution_id.to_string(),
        revision: new_revision,
        items,
        updated_at: now,
    };

    let snapshot_json = serde_json::to_string(&snapshot)?;
    db.conn().prepare_cached(
        "INSERT INTO kv (ns, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(ns, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
    )?.execute(params![
        GOAL_PROGRESS_KV_NAMESPACE,
        execution_id,
        snapshot_json,
        now,
    ])?;

    Ok(snapshot)
}

#[cfg(test)]
mod tests;
