//! Host-owned, exact task-to-turn associations. Completion is provisional until
//! the associated turn wins the terminal CAS; unrelated owned tasks are untouched.
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::model::TeamTask;
use crate::db::now_ms;

const NS: &str = "team-task-attempt-v1";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Attempt {
    schema_version: u8,
    team_session_id: String,
    task_id: String,
    owner_session_id: Option<String>,
    turn_session_id: String,
    turn_id: String,
    task_revision: i64,
    completion_claim: bool,
    settled_status: Option<String>,
}

fn key(team: &str, task: &str) -> Result<String> {
    Ok(serde_json::to_string(&(team, task))?)
}

fn read(conn: &Connection, team: &str, task: &str) -> Result<Option<Attempt>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM kv WHERE ns=?1 AND key=?2",
            params![NS, key(team, task)?],
            |row| row.get(0),
        )
        .optional()?;
    raw.map(|value| decode(&value)).transpose()
}

fn decode(raw: &str) -> Result<Attempt> {
    let attempt: Attempt = serde_json::from_str(raw)?;
    if attempt.schema_version != 1 {
        return Err(anyhow!("unsupported Team task attempt version"));
    }
    Ok(attempt)
}

fn save(conn: &Connection, attempt: &Attempt) -> Result<()> {
    conn.execute(
        "INSERT INTO kv(ns,key,value_json,updated_at) VALUES (?1,?2,?3,?4)
         ON CONFLICT(ns,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
        params![NS, key(&attempt.team_session_id, &attempt.task_id)?, serde_json::to_string(attempt)?, now_ms()],
    )?;
    Ok(())
}

pub(crate) fn clear_task(conn: &Connection, team: &str, task: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM kv WHERE ns=?1 AND key=?2",
        params![NS, key(team, task)?],
    )?;
    Ok(())
}

fn running_turn(conn: &Connection, session: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM turns WHERE session_id=?1 AND status='running'",
            [session],
            |row| row.get(0),
        )
        .optional()?)
}

/// The runtime pins its caller turn when available, preventing delayed old tool
/// requests from binding to a newer retry. Legacy callers remain compatible.
pub(crate) fn validate_caller_turn(conn: &Connection, session: &str, expected: &str) -> Result<()> {
    if running_turn(conn, session)?.as_deref() != Some(expected) {
        return Err(anyhow!(
            "TEAM_TURN_INVALID: task update no longer belongs to the active caller turn"
        ));
    }
    Ok(())
}

/// Only tasks explicitly started in this member turn, at their current revision.
pub(super) fn active_task_ids(
    conn: &Connection,
    team: &str,
    member: &str,
    turn: &str,
) -> Result<Vec<String>> {
    let mut statement = conn.prepare_cached("SELECT t.task_id FROM team_tasks t JOIN kv k
      ON k.ns=?1 AND json_extract(k.value_json,'$.teamSessionId')=t.team_session_id
        AND json_extract(k.value_json,'$.taskId')=t.task_id
      WHERE t.team_session_id=?2 AND t.owner_session_id=?3 AND t.deleted=0 AND t.status='in_progress'
        AND json_extract(k.value_json,'$.turnSessionId')=?3 AND json_extract(k.value_json,'$.turnId')=?4
        AND json_extract(k.value_json,'$.ownerSessionId')=?3
        AND json_extract(k.value_json,'$.taskRevision')=t.revision
        AND json_extract(k.value_json,'$.settledStatus') IS NULL ORDER BY t.task_id")?;
    let rows = statement.query_map(params![NS, team, member, turn], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(super) fn update(
    conn: &Connection,
    current: &TeamTask,
    caller: &str,
    owner: Option<&str>,
    deleted: bool,
    requested_status: Option<&str>,
    next_revision: i64,
) -> Result<String> {
    if deleted || owner != current.owner_session_id.as_deref() {
        clear_task(conn, &current.team_session_id, &current.task_id)?;
        if deleted {
            return Ok(requested_status.unwrap_or(&current.status).into());
        }
    }
    let existing = read(conn, &current.team_session_id, &current.task_id)?;
    if matches!(requested_status, Some("pending" | "failed" | "cancelled")) {
        clear_task(conn, &current.team_session_id, &current.task_id)?;
        return Ok(requested_status.unwrap_or(&current.status).into());
    }
    if matches!(requested_status, Some("in_progress" | "completed")) {
        let owner_turn = owner
            .map(|session| running_turn(conn, session))
            .transpose()?
            .flatten();
        let binding = if let Some(turn) = owner_turn {
            Some((owner.unwrap_or(caller), turn))
        } else {
            running_turn(conn, caller)?.map(|turn| (caller, turn))
        };
        if let Some((session, turn)) = binding {
            save(
                conn,
                &Attempt {
                    schema_version: 1,
                    team_session_id: current.team_session_id.clone(),
                    task_id: current.task_id.clone(),
                    owner_session_id: owner.map(str::to_owned),
                    turn_session_id: session.into(),
                    turn_id: turn,
                    task_revision: next_revision,
                    completion_claim: requested_status == Some("completed"),
                    settled_status: None,
                },
            )?;
            return Ok("in_progress".into());
        }
        if requested_status == Some("completed")
            && existing.as_ref().is_some_and(|attempt| {
                matches!(attempt.settled_status.as_deref(), Some("error" | "aborted"))
            })
        {
            return Err(anyhow!("TEAM_TASK_REVISION_CONFLICT: failed task attempt requires an explicit retry or a new verification turn"));
        }
        clear_task(conn, &current.team_session_id, &current.task_id)?;
    } else if let Some(mut attempt) = existing {
        // A description/metadata update must not silently lose a pending claim.
        if attempt.task_revision == current.revision {
            attempt.task_revision = next_revision;
            save(conn, &attempt)?;
        } else {
            clear_task(conn, &current.team_session_id, &current.task_id)?;
        }
    }
    Ok(requested_status.unwrap_or(&current.status).into())
}

/// Called within the same transaction as the successful terminal turn CAS.
pub(crate) fn settle_turn(conn: &Connection, turn: &str, status: &str) -> Result<()> {
    let attempts = {
        let mut stmt = conn.prepare_cached("SELECT value_json FROM kv WHERE ns=?1 AND json_extract(value_json,'$.turnId')=?2 AND json_extract(value_json,'$.settledStatus') IS NULL")?;
        let rows = stmt.query_map(params![NS, turn], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for raw in attempts {
        let mut attempt = decode(&raw)?;
        let next_status = match status {
            "completed" if attempt.completion_claim => Some("completed"),
            "error" => Some("failed"),
            "aborted" => Some("cancelled"),
            _ => None,
        };
        let Some(next_status) = next_status else {
            clear_task(conn, &attempt.team_session_id, &attempt.task_id)?;
            continue;
        };
        let now = now_ms();
        let changed = conn.execute(
            "UPDATE team_tasks SET status=?1,revision=revision+1,updated_at=?2
             WHERE team_session_id=?3 AND task_id=?4 AND revision=?5 AND deleted=0
               AND status='in_progress' AND owner_session_id IS ?6",
            params![
                next_status,
                now,
                attempt.team_session_id,
                attempt.task_id,
                attempt.task_revision,
                attempt.owner_session_id
            ],
        )?;
        if changed == 0 {
            clear_task(conn, &attempt.team_session_id, &attempt.task_id)?;
            continue;
        }
        let revision: i64 = conn.query_row(
            "SELECT revision FROM teams WHERE team_session_id=?1",
            [&attempt.team_session_id],
            |row| row.get(0),
        )?;
        if conn.execute("UPDATE teams SET revision=revision+1,updated_at=?2 WHERE team_session_id=?1 AND revision=?3", params![attempt.team_session_id, now, revision])? != 1 {
            return Err(anyhow!("TEAM_TASK_REVISION_CONFLICT: team changed during task settlement"));
        }
        if status == "completed" {
            clear_task(conn, &attempt.team_session_id, &attempt.task_id)?;
        } else {
            attempt.task_revision += 1;
            attempt.settled_status = Some(status.into());
            save(conn, &attempt)?;
        }
    }
    Ok(())
}

pub(crate) fn cleanup_session(conn: &Connection, session: &str) -> Result<()> {
    conn.execute("DELETE FROM kv WHERE ns=?1 AND (json_extract(value_json,'$.teamSessionId')=?2 OR json_extract(value_json,'$.ownerSessionId')=?2 OR json_extract(value_json,'$.turnSessionId')=?2)", params![NS, session])?;
    Ok(())
}
