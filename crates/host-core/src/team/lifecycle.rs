use anyhow::{anyhow, Result};
use rusqlite::params;

use super::model::Team;
use crate::db::{now_ms, Database};

const TEAM_LIFECYCLE_NS: &str = "team-lifecycle-v1";

fn is_team_dissolved(db: &Database, team_session_id: &str) -> Result<bool> {
    Ok(db
        .kv_get(TEAM_LIFECYCLE_NS, team_session_id)?
        .is_some_and(|value| value == serde_json::json!({ "dissolved": true })))
}

pub fn get_team(db: &Database, team_session_id: &str) -> Result<Option<Team>> {
    let mut stmt = db.conn().prepare_cached(
        "SELECT team_session_id, revision, paused, created_at, updated_at
         FROM teams
         WHERE team_session_id = ?1",
    )?;
    let mut rows = stmt.query(params![team_session_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(Team {
            team_session_id: row.get(0)?,
            revision: row.get(1)?,
            paused: row.get::<_, i64>(2)? != 0,
            created_at: row.get::<_, i64>(3)?.to_string(),
            updated_at: row.get::<_, i64>(4)?.to_string(),
        }))
    } else {
        Ok(None)
    }
}

#[allow(dead_code)]
pub fn ensure_team(db: &Database, team_session_id: &str) -> Result<Team> {
    if let Some(t) = get_team(db, team_session_id)? {
        return Ok(t);
    }
    if is_team_dissolved(db, team_session_id)? {
        return Err(anyhow!("TEAM_NOT_FOUND: team has been dissolved"));
    }
    let now = now_ms();
    db.conn().execute(
        "INSERT INTO teams (team_session_id, revision, paused, created_at, updated_at)
         VALUES (?1, 1, 0, ?2, ?2)
         ON CONFLICT(team_session_id) DO NOTHING",
        params![team_session_id, now],
    )?;
    get_team(db, team_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: failed to create or find team"))
}

pub(crate) fn bump_team_revision_conn(
    conn: &rusqlite::Connection,
    team_session_id: &str,
) -> Result<i64> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO teams (team_session_id, revision, paused, created_at, updated_at)
         VALUES (?1, 1, 0, ?2, ?2)
         ON CONFLICT(team_session_id) DO NOTHING",
        params![team_session_id, now],
    )?;
    conn.execute(
        "UPDATE teams SET revision=revision+1, updated_at=?2 WHERE team_session_id=?1",
        params![team_session_id, now],
    )?;
    Ok(conn.query_row(
        "SELECT revision FROM teams WHERE team_session_id=?1",
        [team_session_id],
        |row| row.get(0),
    )?)
}

pub fn pause_team(db: &Database, team_session_id: &str) -> Result<Team> {
    let now = now_ms();
    let rows = db.conn().execute(
        "UPDATE teams
         SET paused = 1, revision = revision + 1, updated_at = ?2
         WHERE team_session_id = ?1",
        params![team_session_id, now],
    )?;
    if rows == 0 {
        return Err(anyhow!(
            "TEAM_NOT_FOUND: team '{team_session_id}' not found"
        ));
    }
    get_team(db, team_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: team '{team_session_id}' not found"))
}

pub fn resume_team(db: &Database, team_session_id: &str) -> Result<Team> {
    let now = now_ms();
    let rows = db.conn().execute(
        "UPDATE teams
         SET paused = 0, revision = revision + 1, updated_at = ?2
         WHERE team_session_id = ?1",
        params![team_session_id, now],
    )?;
    if rows == 0 {
        return Err(anyhow!(
            "TEAM_NOT_FOUND: team '{team_session_id}' not found"
        ));
    }
    get_team(db, team_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: team '{team_session_id}' not found"))
}

/// Enforce deletion rules: a member session cannot be deleted while attached to a team.
pub fn can_delete_session(db: &Database, session_id: &str) -> Result<()> {
    let is_member: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM team_members WHERE member_session_id = ?1)",
        params![session_id],
        |row| row.get(0),
    )?;
    if is_member {
        return Err(anyhow!(
            "TEAM_MEMBER_DELETION_BLOCKED: cannot delete a session while it is an active member of a team. Delete the team lead or remove the member first."
        ));
    }
    Ok(())
}

/// Clean up team relationships when the lead session is deleted.
/// Member sessions remain intact as standalone standard conversations.
#[cfg(test)]
pub fn cleanup_team_on_lead_delete(db: &Database, lead_session_id: &str) -> Result<()> {
    let tx = db.conn().unchecked_transaction()?;
    cleanup_team_on_lead_delete_conn(&tx, lead_session_id)?;
    tx.commit()?;
    Ok(())
}

pub(crate) fn cleanup_team_on_lead_delete_conn(
    conn: &rusqlite::Connection,
    lead_session_id: &str,
) -> Result<()> {
    let has_team: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM teams WHERE team_session_id = ?1)",
        params![lead_session_id],
        |row| row.get(0),
    )?;
    if !has_team {
        return Ok(());
    }

    let now = now_ms();
    conn.execute(
        "UPDATE teams SET paused = 1, updated_at = ?2 WHERE team_session_id = ?1",
        params![lead_session_id, now],
    )?;

    let member_ids = {
        let mut stmt = conn.prepare_cached(
            "SELECT member_session_id FROM team_members WHERE team_session_id = ?1",
        )?;
        let rows = stmt.query_map(params![lead_session_id], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    for member_id in member_ids {
        conn.execute(
            "UPDATE sessions SET execution_profile = 'standard', updated_at = ?2 WHERE id = ?1",
            params![member_id, now],
        )?;
    }

    conn.execute(
        "DELETE FROM team_tasks WHERE team_session_id = ?1",
        params![lead_session_id],
    )?;
    conn.execute(
        "DELETE FROM team_members WHERE team_session_id = ?1",
        params![lead_session_id],
    )?;
    conn.execute(
        "DELETE FROM teams WHERE team_session_id = ?1",
        params![lead_session_id],
    )?;
    conn.execute(
        "INSERT INTO kv (ns, key, value_json, updated_at)
         VALUES (?1, ?2, '{\"dissolved\":true}', ?3)
         ON CONFLICT(ns, key) DO UPDATE SET
           value_json=excluded.value_json, updated_at=excluded.updated_at",
        params![TEAM_LIFECYCLE_NS, lead_session_id, now],
    )?;

    Ok(())
}

pub fn get_team_snapshot(
    db: &Database,
    team_session_id: &str,
) -> Result<super::model::TeamSnapshot> {
    let lead = crate::sessions::get_session(db, team_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: lead session not found"))?;
    if lead.summary.execution_profile != "team"
        || super::roster::get_team_member_by_session_id(db, team_session_id)?.is_some()
    {
        return Err(anyhow!("TEAM_UNAUTHORIZED: session is not a team lead"));
    }
    let team = match get_team(db, team_session_id)? {
        Some(team) => team,
        None if !is_team_dissolved(db, team_session_id)? => {
            let is_member: bool = db.conn().query_row(
                "SELECT EXISTS(SELECT 1 FROM team_members WHERE member_session_id=?1)",
                [team_session_id],
                |row| row.get(0),
            )?;
            if is_member {
                return Err(anyhow!("TEAM_UNAUTHORIZED: session is not a team lead"));
            }
            ensure_team(db, team_session_id)?
        }
        None => return Err(anyhow!("TEAM_NOT_FOUND: team has been dissolved")),
    };
    let mut members = super::roster::list_team_members(db, team_session_id)?;
    for member in &mut members {
        member.presentation = super::get_member_presentation(db, &member.member_session_id)?;
    }
    let board = super::board::get_team_board_projection(db, team_session_id)?;
    let lead_phase = db.conn().query_row(
        "SELECT CASE
             WHEN EXISTS(SELECT 1 FROM turns WHERE session_id=?1 AND status='running') THEN 'running'
             ELSE COALESCE((
                 SELECT CASE status
                     WHEN 'completed' THEN 'completed'
                     WHEN 'error' THEN 'failed'
                     ELSE 'idle'
                 END
                 FROM turns WHERE session_id=?1
                 ORDER BY started_at DESC, rowid DESC LIMIT 1
             ), 'idle')
         END",
        [team_session_id],
        |row| row.get::<_, String>(0),
    )?;
    let queued_message_count = db.conn().query_row(
        "SELECT COUNT(*) FROM session_collaboration_messages
         WHERE plugin_id=?1 AND kind='message' AND status='queued' AND turn_id IS NULL",
        [format!("team:{team_session_id}")],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(super::model::TeamSnapshot {
        team_session_id: team_session_id.to_string(),
        revision: team.revision,
        paused: team.paused,
        members,
        tasks: board.tasks,
        readiness: board.readiness,
        scope_overlaps: board.scope_overlaps,
        lead_phase,
        queued_message_count,
        review: super::review::get_launch_review(db, team_session_id, None)?,
        decision: super::review::get_latest_execution_decision(db, team_session_id)?,
    })
}
