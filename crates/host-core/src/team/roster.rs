use anyhow::{anyhow, Result};
use rusqlite::params;

use super::model::{TeamMember, MAX_TEAM_MEMBERS};
use crate::db::{now_ms, Database};
use crate::sessions::{self, ForkSessionResult, SessionCreateOptions};

/// Validate that a session is the Host-authoritative Team lead.
pub fn validate_team_lead(db: &Database, team_session_id: &str) -> Result<()> {
    let profile = sessions::session_execution_profile(db, team_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: lead session not found"))?;
    if profile != "team" {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: session is not configured with the team execution profile"
        ));
    }
    Ok(())
}

/// Validate a Team participant from durable Host state. The lead is represented
/// by `team_session_id`; all other participants must be present in the roster.
pub fn validate_team_participant(
    db: &Database,
    team_session_id: &str,
    participant_session_id: &str,
) -> Result<String> {
    validate_team_lead(db, team_session_id)?;
    if participant_session_id == team_session_id {
        return Ok("Lead".to_string());
    }
    let member = get_team_member_by_session_id(db, participant_session_id)?
        .ok_or_else(|| anyhow!("TEAM_UNAUTHORIZED: session is not a member of this team"))?;
    if member.team_session_id != team_session_id {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: session belongs to a different team"
        ));
    }
    let profile = sessions::session_execution_profile(db, participant_session_id)?
        .ok_or_else(|| anyhow!("TEAM_UNAUTHORIZED: member session not found"))?;
    if profile != "team" {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: member session is not configured with the team execution profile"
        ));
    }
    Ok(member.name)
}

pub fn is_valid_member_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return false;
    }
    trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn validate_member_name(name: &str) -> Result<()> {
    if !is_valid_member_name(name) {
        return Err(anyhow!(
            "TEAM_INVALID_MEMBER_NAME: member name must be 1-64 alphanumeric characters, hyphens, or underscores"
        ));
    }
    Ok(())
}

pub fn list_team_members(db: &Database, team_session_id: &str) -> Result<Vec<TeamMember>> {
    let mut stmt = db.conn().prepare_cached(
        "SELECT team_session_id, member_session_id, name, description, context_kind,
                phase, model_id, provider_id, error, created_at, updated_at
         FROM team_members
         WHERE team_session_id = ?1
         ORDER BY created_at ASC, name ASC",
    )?;
    let members = stmt
        .query_map(params![team_session_id], |row| {
            Ok(TeamMember {
                team_session_id: row.get(0)?,
                member_session_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                context_kind: row.get(4)?,
                phase: row.get(5)?,
                model_id: row.get(6)?,
                provider_id: row.get(7)?,
                error: row.get(8)?,
                created_at: row.get::<_, i64>(9)?.to_string(),
                updated_at: row.get::<_, i64>(10)?.to_string(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(members)
}

pub fn get_team_member_by_name(
    db: &Database,
    team_session_id: &str,
    name: &str,
) -> Result<Option<TeamMember>> {
    let mut stmt = db.conn().prepare_cached(
        "SELECT team_session_id, member_session_id, name, description, context_kind,
                phase, model_id, provider_id, error, created_at, updated_at
         FROM team_members
         WHERE team_session_id = ?1 AND lower(name) = lower(?2)",
    )?;
    let mut rows = stmt.query(params![team_session_id, name])?;
    if let Some(row) = rows.next()? {
        Ok(Some(TeamMember {
            team_session_id: row.get(0)?,
            member_session_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            context_kind: row.get(4)?,
            phase: row.get(5)?,
            model_id: row.get(6)?,
            provider_id: row.get(7)?,
            error: row.get(8)?,
            created_at: row.get::<_, i64>(9)?.to_string(),
            updated_at: row.get::<_, i64>(10)?.to_string(),
        }))
    } else {
        Ok(None)
    }
}

pub fn get_team_member_by_session_id(
    db: &Database,
    member_session_id: &str,
) -> Result<Option<TeamMember>> {
    let mut stmt = db.conn().prepare_cached(
        "SELECT team_session_id, member_session_id, name, description, context_kind,
                phase, model_id, provider_id, error, created_at, updated_at
         FROM team_members
         WHERE member_session_id = ?1",
    )?;
    let mut rows = stmt.query(params![member_session_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(TeamMember {
            team_session_id: row.get(0)?,
            member_session_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            context_kind: row.get(4)?,
            phase: row.get(5)?,
            model_id: row.get(6)?,
            provider_id: row.get(7)?,
            error: row.get(8)?,
            created_at: row.get::<_, i64>(9)?.to_string(),
            updated_at: row.get::<_, i64>(10)?.to_string(),
        }))
    } else {
        Ok(None)
    }
}

pub struct CreateMemberParams<'a> {
    pub team_session_id: &'a str,
    pub caller_session_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub context_kind: Option<&'a str>, // "fresh" | "fork", defaults to "fresh"
    pub model_id: Option<&'a str>,
    pub provider_id: Option<&'a str>,
}

pub fn create_team_member(db: &Database, params: CreateMemberParams<'_>) -> Result<TeamMember> {
    create_team_member_impl(db, params, true)
}

pub(super) fn create_approved_team_member(
    db: &Database,
    params: CreateMemberParams<'_>,
) -> Result<TeamMember> {
    create_team_member_impl(db, params, false)
}

fn create_team_member_impl(
    db: &Database,
    params: CreateMemberParams<'_>,
    require_approval: bool,
) -> Result<TeamMember> {
    let CreateMemberParams {
        team_session_id,
        caller_session_id,
        name,
        description,
        context_kind,
        model_id,
        provider_id,
    } = params;

    // 1. Caller authority check: only the Host-authenticated Lead can create members.
    if caller_session_id != team_session_id {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: only the team lead can spawn teammates"
        ));
    }

    validate_team_lead(db, team_session_id)?;
    if require_approval {
        return Err(anyhow!(
            "TEAM_APPROVAL_REQUIRED: teammate creation requires a confirmed launch review"
        ));
    }

    validate_member_name(name)?;
    let context_kind = context_kind.unwrap_or("fresh");
    if context_kind != "fresh" && context_kind != "fork" {
        return Err(anyhow!(
            "INVALID_PARAMS: contextKind must be 'fresh' or 'fork'"
        ));
    }

    // 2. Lead session must exist and be team execution profile
    let lead_summary = sessions::get_session(db, team_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: lead session not found"))?
        .summary;

    // 3. Enforce member limit (<= 8)
    let current_count: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM team_members WHERE team_session_id = ?1",
        params![team_session_id],
        |row| row.get(0),
    )?;
    if current_count as usize >= MAX_TEAM_MEMBERS {
        return Err(anyhow!(
            "TEAM_MEMBER_LIMIT_EXCEEDED: team cannot exceed {MAX_TEAM_MEMBERS} members"
        ));
    }

    // 4. Name uniqueness
    let name_exists: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM team_members WHERE team_session_id = ?1 AND lower(name) = lower(?2))",
        params![team_session_id, name],
        |row| row.get(0),
    )?;
    if name_exists {
        return Err(anyhow!(
            "TEAM_MEMBER_NAME_COLLISION: member with name '{name}' already exists"
        ));
    }

    // 5. Create or fork member session
    let now = now_ms();
    let member_session_id = if context_kind == "fork" {
        let fork_res = sessions::fork_session_through(
            db,
            team_session_id,
            Some(&format!("{name} ({team_session_id})")),
            None,
        )?;
        match fork_res {
            ForkSessionResult::Created(detail) => detail.summary.id,
            ForkSessionResult::Busy => return Err(anyhow!("TEAM_BUSY: lead session is busy")),
            ForkSessionResult::NotFound => {
                return Err(anyhow!("TEAM_NOT_FOUND: lead session not found"));
            }
        }
    } else {
        let created = sessions::create_session_with_options(
            db,
            SessionCreateOptions {
                title: Some(format!("Teammate: {name}")),
                mode: Some("agent".into()),
                model_id: model_id.map(Into::into).or(lead_summary.model_id),
                provider_id: provider_id.map(Into::into).or(lead_summary.provider_id),
                project_path: lead_summary.project_path,
                project_name: None,
                thinking_level: Some(lead_summary.thinking_level),
                permission_mode: Some(lead_summary.permission_mode),
                execution_profile: Some("team".into()),
            },
        )?;
        created.id
    };

    // 6. Ensure team row exists, then insert member and increment team revision
    let roster_result = sessions::with_savepoint(db.conn(), "team_roster", |conn| {
        conn.execute(
            "INSERT INTO teams (team_session_id, revision, paused, created_at, updated_at)
             VALUES (?1, 1, 0, ?2, ?2)
             ON CONFLICT(team_session_id) DO UPDATE SET updated_at = excluded.updated_at",
            params![team_session_id, now],
        )?;
        conn.execute(
            "INSERT INTO team_members (
                team_session_id, member_session_id, name, description, context_kind,
                phase, model_id, provider_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'idle', ?6, ?7, ?8, ?8)",
            params![
                team_session_id,
                member_session_id,
                name,
                description,
                context_kind,
                model_id,
                provider_id,
                now
            ],
        )?;
        conn.execute(
            "UPDATE teams SET revision = revision + 1, updated_at = ?2 WHERE team_session_id = ?1",
            params![team_session_id, now],
        )?;
        Ok(())
    });
    if let Err(error) = roster_result {
        if let Err(rollback_error) = sessions::delete_session(db, &member_session_id) {
            return Err(anyhow!(
                "{error}; member session cleanup failed: {rollback_error}"
            ));
        }
        if let Err(rollback_error) =
            sessions::cleanup_uncommitted_team_session_files(db, &member_session_id)
        {
            return Err(anyhow!(
                "{error}; member file cleanup failed: {rollback_error}"
            ));
        }
        return Err(error);
    }

    Ok(TeamMember {
        team_session_id: team_session_id.to_string(),
        member_session_id,
        name: name.to_string(),
        description: description.map(Into::into),
        context_kind: context_kind.to_string(),
        phase: "idle".to_string(),
        model_id: model_id.map(Into::into),
        provider_id: provider_id.map(Into::into),
        error: None,
        created_at: now.to_string(),
        updated_at: now.to_string(),
    })
}

#[allow(dead_code)]
pub fn update_member_phase(
    db: &Database,
    team_session_id: &str,
    member_session_id: &str,
    phase: &str,
    error: Option<&str>,
) -> Result<bool> {
    let valid_phases = ["provisioning", "idle", "running", "failed", "completed"];
    if !valid_phases.contains(&phase) {
        return Err(anyhow!("INVALID_PARAMS: unknown member phase '{phase}'"));
    }
    let now = now_ms();
    let rows = db.conn().execute(
        "UPDATE team_members
         SET phase = ?1, error = ?2, updated_at = ?3
         WHERE team_session_id = ?4 AND member_session_id = ?5",
        params![phase, error, now, team_session_id, member_session_id],
    )?;
    if rows > 0 {
        db.conn().execute(
            "UPDATE teams SET revision = revision + 1, updated_at = ?2 WHERE team_session_id = ?1",
            params![team_session_id, now],
        )?;
        Ok(true)
    } else {
        Ok(false)
    }
}

pub fn gate_session_configure(
    db: &Database,
    session_id: &str,
    target_mode: &str,
    target_provider_id: Option<&str>,
    target_model_id: Option<&str>,
    target_thinking_level: Option<&str>,
    target_permission_mode: Option<&str>,
    target_execution_profile: Option<&str>,
) -> Result<()> {
    if let Some(member) = get_team_member_by_session_id(db, session_id)? {
        if target_mode != "agent" {
            return Err(anyhow!(
                "TEAM_MEMBER_MODEL_CHANGE_BLOCKED: cannot change mode of active team member"
            ));
        }
        if let Some(profile) = target_execution_profile {
            if profile != "team" {
                return Err(anyhow!(
                    "TEAM_MEMBER_MODEL_CHANGE_BLOCKED: cannot change execution profile of active team member"
                ));
            }
        }
        let detail = sessions::get_session(db, session_id)?
            .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: member session not found"))?;
        if target_permission_mode
            .is_some_and(|permission| permission != detail.summary.permission_mode)
        {
            return Err(anyhow!(
                "TEAM_MEMBER_MODEL_CHANGE_BLOCKED: cannot change permission mode of active team member"
            ));
        }

        if member.phase != "idle" {
            return Err(anyhow!(
                "TEAM_MEMBER_MODEL_CHANGE_BLOCKED: cannot configure team member while in '{}' phase",
                member.phase
            ));
        }

        let queued_count: i64 = db.conn().query_row(
            "SELECT COUNT(*) FROM session_collaboration_messages
             WHERE plugin_id = ?1 AND target_session_id = ?2 AND status = 'queued'",
            params![
                super::mailbox::team_plugin_origin(&member.team_session_id),
                session_id
            ],
            |row| row.get(0),
        )?;
        if queued_count > 0 {
            return Err(anyhow!(
                "TEAM_MEMBER_MODEL_CHANGE_BLOCKED: cannot configure team member with pending queued messages"
            ));
        }

        if super::review::has_pending_review_for_member(db, &member.team_session_id, &member.name)?
        {
            return Err(anyhow!(
                "TEAM_MEMBER_MODEL_CHANGE_BLOCKED: cannot configure team member under pending launch review"
            ));
        }

        let provider_id = target_provider_id
            .map(str::to_string)
            .or(detail.summary.provider_id)
            .ok_or_else(|| anyhow!("TEAM_MODEL_SELECTION_INVALID: member has no provider"))?;
        let model_id = target_model_id
            .map(str::to_string)
            .or(detail.summary.model_id)
            .ok_or_else(|| anyhow!("TEAM_MODEL_SELECTION_INVALID: member has no model"))?;
        let thinking_level = target_thinking_level.unwrap_or(&detail.summary.thinking_level);
        super::review::validate_member_route(db, &provider_id, &model_id, thinking_level)?;
    }
    Ok(())
}
