use anyhow::{anyhow, Result};
use rusqlite::params;

use super::model::Team;
use crate::db::{now_ms, Database};

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
pub fn cleanup_team_on_lead_delete(db: &Database, lead_session_id: &str) -> Result<()> {
    let tx = db.conn().unchecked_transaction()?;
    let has_team: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM teams WHERE team_session_id = ?1)",
        params![lead_session_id],
        |row| row.get(0),
    )?;
    if !has_team {
        tx.commit()?;
        return Ok(());
    }

    let now = now_ms();
    tx.execute(
        "UPDATE teams SET paused = 1, updated_at = ?2 WHERE team_session_id = ?1",
        params![lead_session_id, now],
    )?;

    let member_ids = {
        let mut stmt = tx.prepare_cached(
            "SELECT member_session_id FROM team_members WHERE team_session_id = ?1",
        )?;
        let rows = stmt.query_map(params![lead_session_id], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    for member_id in member_ids {
        tx.execute(
            "UPDATE sessions SET execution_profile = 'standard', updated_at = ?2 WHERE id = ?1",
            params![member_id, now],
        )?;
    }

    tx.execute(
        "DELETE FROM team_tasks WHERE team_session_id = ?1",
        params![lead_session_id],
    )?;
    tx.execute(
        "DELETE FROM team_members WHERE team_session_id = ?1",
        params![lead_session_id],
    )?;
    tx.execute(
        "DELETE FROM teams WHERE team_session_id = ?1",
        params![lead_session_id],
    )?;

    tx.commit()?;
    Ok(())
}
