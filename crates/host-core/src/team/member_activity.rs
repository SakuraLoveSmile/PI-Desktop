//! Host observations only: no repository activity, report bodies or commands.
use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::sessions::physical_usage_operations;
use crate::{background_processes, db::Database, state::AppState};

pub(crate) const ACTIVITY_WINDOW_MS: i64 = 600_000;
const USAGE_NS: &str = "team-member-usage-observations-v1";

pub(crate) fn cleanup_session(conn: &rusqlite::Connection, session: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM kv WHERE ns=?1 AND key=?2",
        params![USAGE_NS, session],
    )?;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UsageObservation {
    pub(super) operation_id: String,
    pub(super) observed_at_ms: i64,
    pub(super) total_tokens: i64,
}

pub(super) fn observations(db: &Database, session: &str) -> Result<Vec<UsageObservation>> {
    Ok(db
        .kv_get(USAGE_NS, session)?
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default())
}

/// Called inside the billing savepoint. A replay never refreshes activity;
/// identities already in a legacy ledger have unknown observation time.
pub(crate) fn observe_usage(
    db: &Database,
    session: &str,
    previous: Option<&Value>,
    incoming: &Value,
    now: i64,
) -> Result<()> {
    if super::get_team_member_by_session_id(db, session)?.is_none()
        && crate::sessions::session_execution_profile(db, session)?.as_deref() != Some("team")
    {
        return Ok(());
    }
    let mut observed = observations(db, session)?;
    observed.retain(|record| record.observed_at_ms >= now.saturating_sub(ACTIVITY_WINDOW_MS));
    let known = previous.map(physical_usage_operations).unwrap_or_default();
    for operation in physical_usage_operations(incoming) {
        let Some(id) = operation.get("operationId").and_then(Value::as_str) else {
            continue;
        };
        let total = operation
            .get("totalTokens")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0);
        if let Some(record) = observed.iter_mut().find(|record| record.operation_id == id) {
            record.total_tokens = record.total_tokens.max(total);
        } else if !known
            .iter()
            .any(|record| record.get("operationId").and_then(Value::as_str) == Some(id))
        {
            observed.push(UsageObservation {
                operation_id: id.into(),
                observed_at_ms: now,
                total_tokens: total,
            });
        }
    }
    db.kv_set(USAGE_NS, session, &serde_json::to_value(observed)?)?;
    Ok(())
}

fn queue(db: &Database, team: &str, session: &str, outgoing: bool, now: i64) -> Result<Value> {
    // ACK is durable admission, not consumption. Keep queued messages even
    // when their turn_queue receipt already exists; never count it twice.
    let column = if outgoing {
        "source_session_id"
    } else {
        "target_session_id"
    };
    let (count, oldest): (i64, Option<i64>) = db.conn().query_row(
        &format!(
            "SELECT COUNT(*), MIN(created_at) FROM session_collaboration_messages
            WHERE plugin_id=?1 AND {column}=?2 AND kind='message' AND status='queued'"
        ),
        params![super::team_plugin_origin(team), session],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(json!({"count":count,"oldestAgeMs":oldest.map(|time| now.saturating_sub(time).max(0))}))
}

pub(crate) fn member(
    st: &AppState,
    team: &str,
    session: &str,
    name: &str,
    now: i64,
) -> Result<Value> {
    let db = &st.db;
    let turn: Option<(String, String, i64, Option<i64>)> = db.conn().query_row(
        "SELECT id,status,started_at,ended_at FROM turns WHERE session_id=?1 ORDER BY started_at DESC,id DESC LIMIT 1",
        [session], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).optional()?;
    let audit_tool: Option<(i64, String)> = db.conn().query_row(
        "SELECT ts,payload_json FROM audit_log WHERE session_id=?1
         AND kind IN ('tool_execute','tool_denied','tool_aborted') ORDER BY ts DESC,id DESC LIMIT 1",
        [session], |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional()?;
    let message_tool: Option<(i64, String)> = db
        .conn()
        .query_row(
            "SELECT created_at,tool_name FROM messages WHERE session_id=?1 AND role='tool'
         AND tool_name IS NOT NULL ORDER BY created_at DESC,seq DESC LIMIT 1",
            [session],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let audit_tool = audit_tool
        .map(|(time, payload)| -> Result<_> {
            let payload: Value = serde_json::from_str(&payload)?;
            Ok((
                time,
                payload
                    .get("toolName")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_owned(),
            ))
        })
        .transpose()?;
    let last_tool = audit_tool
        .into_iter()
        .chain(message_tool)
        .max_by_key(|(time, _)| *time);
    let last_outgoing: Option<i64> = db.conn().query_row(
        "SELECT MAX(created_at) FROM session_collaboration_messages WHERE plugin_id=?1
         AND source_session_id=?2 AND kind='message'
         AND idempotency_key NOT LIKE 'team-review:%'
         AND idempotency_key NOT LIKE 'member-turn-failed:%'",
        params![super::team_plugin_origin(team), session],
        |r| r.get(0),
    )?;
    let usage: Vec<_> = observations(db, session)?
        .into_iter()
        .filter(|record| record.observed_at_ms >= now.saturating_sub(ACTIVITY_WINDOW_MS))
        .collect();
    let all_processes = background_processes::list_view(st, session)?;
    let mut last_background: Option<i64> = None;
    for process in &all_processes {
        for time in std::iter::once(&process.started_at).chain(process.ended_at.as_ref()) {
            let timestamp = match time.parse::<i64>() {
                Ok(time) => time,
                Err(_) => chrono::DateTime::parse_from_rfc3339(time)?.timestamp_millis(),
            };
            last_background = Some(last_background.unwrap_or(timestamp).max(timestamp));
        }
    }
    let processes: Vec<_> = all_processes
        .into_iter()
        .filter(|process| matches!(process.status.as_str(), "starting" | "running" | "stopping"))
        .map(|process| {
            json!({"id":process.id,"toolCallId":process.tool_call_id,
            "status":process.status,"startedAt":process.started_at})
        })
        .collect();
    let active_bash: Vec<_> = st
        .active_bash_cancellations
        .keys()
        .filter(|(owner, _)| owner == session)
        .map(|(_, id)| id.clone())
        .collect();
    let last_activity = turn
        .as_ref()
        .filter(|(_, status, _, _)| status == "running")
        .map(|(_, _, start, _)| *start)
        .into_iter()
        .chain(last_tool.as_ref().map(|(time, _)| *time))
        .chain(usage.iter().map(|record| record.observed_at_ms))
        .chain(last_background)
        .chain(last_outgoing)
        .max();
    let recent = last_activity.is_some_and(|time| now.saturating_sub(time) <= ACTIVITY_WINDOW_MS);
    let active = recent || !processes.is_empty() || !active_bash.is_empty();
    Ok(json!({
        "memberSessionId":session,"memberName":name,"observedAtMs":now,
        "activityWindowMs":ACTIVITY_WINDOW_MS,"requiresForce":active,"lastActivityAtMs":last_activity,
        "turn":turn.map(|(id,status,start,end)| json!({"id":id,"status":status,"startedAtMs":start,
            "durationMs":end.unwrap_or(now).saturating_sub(start).max(0)})),
        "lastTool":last_tool.map(|(time,name)| json!({"name":name,"observedAtMs":time})),
        "runningBackgroundProcesses":processes,"activeBashToolCallIds":active_bash,
        "recentUsage":{"completedCallCount":usage.len(),"totalTokens":usage.iter().fold(0_i64,|sum,record| sum.saturating_add(record.total_tokens)),
            "windowMs":ACTIVITY_WINDOW_MS,"coverage":"host_observed_usage"},
        "incomingQueue":queue(db,team,session,false,now)?,"outgoingQueue":queue(db,team,session,true,now)?,
    }))
}

pub(crate) fn roster(st: &AppState, team: &str) -> Result<Vec<Value>> {
    let now = crate::db::now_ms();
    let mut result = vec![member(st, team, team, "Lead", now)?];
    for record in super::list_team_members(&st.db, team)? {
        result.push(member(
            st,
            team,
            &record.member_session_id,
            &record.name,
            now,
        )?);
    }
    Ok(result)
}
