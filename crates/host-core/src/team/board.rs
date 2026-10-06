use std::collections::{HashMap, HashSet};

use anyhow::{anyhow, Result};
use rusqlite::params;
use uuid::Uuid;

use super::model::{
    TeamBoardProjection, TeamTask, TeamTaskReadiness, WriteScopeOverlap, MAX_TEAM_TASKS,
};
use super::roster::{get_team_member_by_name, validate_team_participant};
use crate::db::{now_ms, Database};

pub fn list_team_tasks(db: &Database, team_session_id: &str) -> Result<Vec<TeamTask>> {
    let mut stmt = db.conn().prepare_cached(
        "SELECT team_session_id, task_id, revision, subject, description, status,
                owner_session_id, owner_member_name, blocked_by_json, write_scopes_json,
                deleted, created_at, updated_at
         FROM team_tasks
         WHERE team_session_id = ?1 AND deleted = 0
         ORDER BY created_at ASC, task_id ASC",
    )?;
    let tasks = stmt
        .query_map(params![team_session_id], |row| {
            let blocked_by_raw: String = row.get(8)?;
            let write_scopes_raw: String = row.get(9)?;
            let blocked_by: Vec<String> = serde_json::from_str(&blocked_by_raw).unwrap_or_default();
            let write_scopes: Vec<String> =
                serde_json::from_str(&write_scopes_raw).unwrap_or_default();
            Ok(TeamTask {
                team_session_id: row.get(0)?,
                task_id: row.get(1)?,
                revision: row.get(2)?,
                subject: row.get(3)?,
                description: row.get(4)?,
                status: row.get(5)?,
                owner_session_id: row.get(6)?,
                owner_member_name: row.get(7)?,
                blocked_by,
                write_scopes,
                deleted: row.get::<_, i64>(10)? != 0,
                created_at: row.get::<_, i64>(11)?.to_string(),
                updated_at: row.get::<_, i64>(12)?.to_string(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn get_team_task(
    db: &Database,
    team_session_id: &str,
    task_id: &str,
) -> Result<Option<TeamTask>> {
    let mut stmt = db.conn().prepare_cached(
        "SELECT team_session_id, task_id, revision, subject, description, status,
                owner_session_id, owner_member_name, blocked_by_json, write_scopes_json,
                deleted, created_at, updated_at
         FROM team_tasks
         WHERE team_session_id = ?1 AND task_id = ?2",
    )?;
    let mut rows = stmt.query(params![team_session_id, task_id])?;
    if let Some(row) = rows.next()? {
        let blocked_by_raw: String = row.get(8)?;
        let write_scopes_raw: String = row.get(9)?;
        let blocked_by: Vec<String> = serde_json::from_str(&blocked_by_raw).unwrap_or_default();
        let write_scopes: Vec<String> = serde_json::from_str(&write_scopes_raw).unwrap_or_default();
        Ok(Some(TeamTask {
            team_session_id: row.get(0)?,
            task_id: row.get(1)?,
            revision: row.get(2)?,
            subject: row.get(3)?,
            description: row.get(4)?,
            status: row.get(5)?,
            owner_session_id: row.get(6)?,
            owner_member_name: row.get(7)?,
            blocked_by,
            write_scopes,
            deleted: row.get::<_, i64>(10)? != 0,
            created_at: row.get::<_, i64>(11)?.to_string(),
            updated_at: row.get::<_, i64>(12)?.to_string(),
        }))
    } else {
        Ok(None)
    }
}

pub struct CreateTaskParams<'a> {
    pub team_session_id: &'a str,
    pub caller_session_id: &'a str,
    pub task_id: Option<&'a str>,
    pub subject: &'a str,
    pub description: Option<&'a str>,
    pub blocked_by: Option<Vec<String>>,
    pub write_scopes: Option<Vec<String>>,
    pub owner_session_id: Option<&'a str>,
    pub owner_member_name: Option<&'a str>,
}

pub fn create_team_task(db: &Database, params: CreateTaskParams<'_>) -> Result<TeamTask> {
    let CreateTaskParams {
        team_session_id,
        caller_session_id,
        task_id,
        subject,
        description,
        blocked_by,
        write_scopes,
        owner_session_id,
        owner_member_name,
    } = params;

    let caller_name = validate_team_participant(db, team_session_id, caller_session_id)?;
    if super::planning::purpose(db, caller_session_id)?
        .is_some_and(|p| p.work_purpose == "plan_research")
    {
        return Err(anyhow!(
            "TEAM_RESEARCH_READ_ONLY: researchers cannot create tasks"
        ));
    }
    let is_lead = caller_session_id == team_session_id;
    if !is_lead {
        super::review::require_approved_member(db, team_session_id, caller_session_id)?;
    }
    let (owner_session_id, owner_member_name) = if let Some(owner_id) = owner_session_id {
        let owner_name = validate_team_participant(db, team_session_id, owner_id)?;
        if let Some(requested_name) = owner_member_name {
            if !requested_name.eq_ignore_ascii_case(&owner_name) {
                return Err(anyhow!(
                    "TEAM_TASK_OWNER_MISMATCH: owner name does not match session"
                ));
            }
        }
        if !is_lead && owner_id != caller_session_id {
            return Err(anyhow!(
                "TEAM_UNAUTHORIZED: members can only create their own tasks"
            ));
        }
        (Some(owner_id.to_string()), Some(owner_name))
    } else if let Some(owner_name) = owner_member_name {
        let owner = get_team_member_by_name(db, team_session_id, owner_name)?
            .ok_or_else(|| anyhow!("TEAM_TARGET_NOT_FOUND: task owner is not a team member"))?;
        if !is_lead && owner.member_session_id != caller_session_id {
            return Err(anyhow!(
                "TEAM_UNAUTHORIZED: members can only create their own tasks"
            ));
        }
        (Some(owner.member_session_id), Some(owner.name))
    } else if is_lead {
        (None, None)
    } else {
        (Some(caller_session_id.to_string()), Some(caller_name))
    };
    if let Some(owner_id) = owner_session_id.as_deref() {
        super::review::require_approved_member(db, team_session_id, owner_id)?;
    }

    let subject = subject.trim();
    if subject.is_empty() {
        return Err(anyhow!("INVALID_PARAMS: subject cannot be empty"));
    }
    if subject.len() > 256 {
        return Err(anyhow!(
            "INVALID_PARAMS: subject exceeds maximum length of 256 characters"
        ));
    }

    let live_count: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM team_tasks WHERE team_session_id = ?1 AND deleted = 0",
        params![team_session_id],
        |row| row.get(0),
    )?;
    if live_count as usize >= MAX_TEAM_TASKS {
        return Err(anyhow!(
            "TEAM_TASK_LIMIT_EXCEEDED: team task board cannot exceed {MAX_TEAM_TASKS} live tasks"
        ));
    }

    let generated_id = Uuid::new_v4().to_string();
    let task_id = task_id.unwrap_or(&generated_id);
    let blocked_by = blocked_by.unwrap_or_default();
    let write_scopes = write_scopes.unwrap_or_default();

    // Check self-dependency
    if blocked_by.iter().any(|b| b == task_id) {
        return Err(anyhow!(
            "TEAM_TASK_DEPENDENCY_CYCLE: task cannot depend on itself"
        ));
    }

    // Validate DAG cycle and existence of dependencies
    let existing_tasks = list_team_tasks(db, team_session_id)?;
    let mut task_map: HashMap<String, Vec<String>> = existing_tasks
        .iter()
        .map(|t| (t.task_id.clone(), t.blocked_by.clone()))
        .collect();

    // Ensure all blocked_by tasks exist
    for dep in &blocked_by {
        if !task_map.contains_key(dep) {
            return Err(anyhow!(
                "TEAM_TASK_UNKNOWN_DEPENDENCY: dependency task '{dep}' does not exist"
            ));
        }
    }

    task_map.insert(task_id.to_string(), blocked_by.clone());
    validate_dag(&task_map)?;

    let now = now_ms();
    let blocked_by_json = serde_json::to_string(&blocked_by)?;
    let write_scopes_json = serde_json::to_string(&write_scopes)?;

    crate::sessions::with_savepoint(db.conn(), "team_create_task", |_| {
        db.conn().execute(
            "INSERT INTO team_tasks (
            team_session_id, task_id, revision, subject, description, status,
            owner_session_id, owner_member_name, blocked_by_json, write_scopes_json,
            deleted, created_at, updated_at
         ) VALUES (?1, ?2, 1, ?3, ?4, 'pending', ?5, ?6, ?7, ?8, 0, ?9, ?9)",
            params![
                team_session_id,
                task_id,
                subject,
                description,
                owner_session_id,
                owner_member_name,
                blocked_by_json,
                write_scopes_json,
                now
            ],
        )?;

        db.conn().execute(
            "UPDATE teams SET revision = revision + 1, updated_at = ?2 WHERE team_session_id = ?1",
            params![team_session_id, now],
        )?;

        super::planning::enrol(
            db,
            team_session_id,
            task_id,
            owner_session_id.as_deref(),
            false,
            "pending",
        )?;
        Ok(())
    })?;

    Ok(TeamTask {
        team_session_id: team_session_id.to_string(),
        task_id: task_id.to_string(),
        revision: 1,
        subject: subject.to_string(),
        description: description.map(Into::into),
        status: "pending".to_string(),
        owner_session_id,
        owner_member_name,
        blocked_by,
        write_scopes,
        deleted: false,
        created_at: now.to_string(),
        updated_at: now.to_string(),
    })
}

pub struct UpdateTaskParams<'a> {
    pub team_session_id: &'a str,
    pub caller_session_id: &'a str,
    pub task_id: &'a str,
    pub expected_revision: i64,
    pub subject: Option<&'a str>,
    pub description: Option<&'a str>,
    pub status: Option<&'a str>,
    pub owner_session_id: Option<Option<&'a str>>,
    pub owner_member_name: Option<Option<&'a str>>,
    pub blocked_by: Option<Vec<String>>,
    pub write_scopes: Option<Vec<String>>,
    pub deleted: Option<bool>,
}

pub fn update_team_task(db: &Database, params: UpdateTaskParams<'_>) -> Result<TeamTask> {
    let UpdateTaskParams {
        team_session_id,
        caller_session_id,
        task_id,
        expected_revision,
        subject,
        description,
        status,
        owner_session_id,
        owner_member_name,
        blocked_by,
        write_scopes,
        deleted,
    } = params;

    let current = get_team_task(db, team_session_id, task_id)?
        .ok_or_else(|| anyhow!("TEAM_TASK_NOT_FOUND: task '{task_id}' not found"))?;
    let caller_name = validate_team_participant(db, team_session_id, caller_session_id)?;
    let is_lead = caller_session_id == team_session_id;
    if !is_lead {
        super::review::require_approved_member(db, team_session_id, caller_session_id)?;
    }
    if !is_lead && current.owner_session_id.as_deref() != Some(caller_session_id) {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: members can only update their own tasks"
        ));
    }

    // CAS check
    if current.revision != expected_revision {
        return Err(anyhow!(
            "TEAM_TASK_REVISION_CONFLICT: task has been modified (expected revision {expected_revision}, got {})",
            current.revision
        ));
    }

    let final_status = status.unwrap_or(&current.status);
    let valid_statuses = ["pending", "in_progress", "completed", "failed", "cancelled"];
    if !valid_statuses.contains(&final_status) {
        return Err(anyhow!(
            "INVALID_PARAMS: unknown task status '{final_status}'"
        ));
    }

    let final_subject = match subject {
        Some(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return Err(anyhow!("INVALID_PARAMS: subject cannot be empty"));
            }
            if trimmed.len() > 256 {
                return Err(anyhow!(
                    "INVALID_PARAMS: subject exceeds maximum length of 256 characters"
                ));
            }
            trimmed
        }
        None => current.subject.as_str(),
    };

    let final_description = match description {
        Some(d) => Some(d.to_string()),
        None => current.description.clone(),
    };

    let (requested_owner_id, requested_owner_name) = match (owner_session_id, owner_member_name) {
        (Some(Some(id)), Some(Some(name))) => (Some(id.to_string()), Some(name.to_string())),
        (Some(Some(id)), Some(None) | None) => (Some(id.to_string()), None),
        (Some(None), Some(Some(_))) => {
            return Err(anyhow!(
                "TEAM_TASK_OWNER_MISMATCH: owner name requires a member session"
            ));
        }
        (Some(None), Some(None) | None) => (None, None),
        (None, Some(Some(name))) => {
            let owner = get_team_member_by_name(db, team_session_id, name)?
                .ok_or_else(|| anyhow!("TEAM_TARGET_NOT_FOUND: task owner is not a team member"))?;
            (Some(owner.member_session_id), Some(owner.name))
        }
        (None, Some(None)) => (None, None),
        (None, None) => (
            current.owner_session_id.clone(),
            current.owner_member_name.clone(),
        ),
    };
    if !is_lead
        && (requested_owner_id.as_deref() != Some(caller_session_id)
            || requested_owner_name.as_deref() != Some(caller_name.as_str()))
    {
        return Err(anyhow!("TEAM_UNAUTHORIZED: members cannot reassign tasks"));
    }
    let (final_owner_session_id, final_owner_member_name) =
        if let Some(owner_id) = requested_owner_id {
            let owner_name = validate_team_participant(db, team_session_id, &owner_id)?;
            if let Some(name) = requested_owner_name.as_deref() {
                if !name.eq_ignore_ascii_case(&owner_name) {
                    return Err(anyhow!(
                        "TEAM_TASK_OWNER_MISMATCH: owner name does not match session"
                    ));
                }
            }
            (Some(owner_id), Some(owner_name))
        } else if let Some(owner_name) = requested_owner_name {
            let owner = get_team_member_by_name(db, team_session_id, &owner_name)?
                .ok_or_else(|| anyhow!("TEAM_TARGET_NOT_FOUND: task owner is not a team member"))?;
            (Some(owner.member_session_id), Some(owner.name))
        } else {
            (None, None)
        };
    if let Some(owner_id) = final_owner_session_id.as_deref() {
        super::review::require_approved_member(db, team_session_id, owner_id)?;
    }

    let final_blocked_by = blocked_by.unwrap_or(current.blocked_by.clone());
    let final_write_scopes = write_scopes.unwrap_or(current.write_scopes.clone());
    let final_deleted = deleted.unwrap_or(current.deleted);

    // Validate DAG if blocked_by changed
    if final_blocked_by.iter().any(|b| b == task_id) {
        return Err(anyhow!(
            "TEAM_TASK_DEPENDENCY_CYCLE: task cannot depend on itself"
        ));
    }

    let existing_tasks = list_team_tasks(db, team_session_id)?;
    let mut task_map: HashMap<String, Vec<String>> = existing_tasks
        .iter()
        .filter(|t| t.task_id != task_id)
        .map(|t| (t.task_id.clone(), t.blocked_by.clone()))
        .collect();

    if !final_deleted {
        for dep in &final_blocked_by {
            if !task_map.contains_key(dep) && dep != task_id {
                return Err(anyhow!(
                    "TEAM_TASK_UNKNOWN_DEPENDENCY: dependency task '{dep}' does not exist"
                ));
            }
        }
        task_map.insert(task_id.to_string(), final_blocked_by.clone());
        validate_dag(&task_map)?;
    }

    let now = now_ms();
    let next_revision = current.revision + 1;
    let blocked_by_json = serde_json::to_string(&final_blocked_by)?;
    let write_scopes_json = serde_json::to_string(&final_write_scopes)?;

    crate::sessions::with_savepoint(db.conn(), "team_update_task", |_| {
        super::planning::enrol(
            db,
            team_session_id,
            task_id,
            final_owner_session_id.as_deref(),
            final_deleted,
            final_status,
        )?;
        db.conn().execute(
            "UPDATE team_tasks
         SET revision = ?1, subject = ?2, description = ?3, status = ?4,
             owner_session_id = ?5, owner_member_name = ?6, blocked_by_json = ?7,
             write_scopes_json = ?8, deleted = ?9, updated_at = ?10
         WHERE team_session_id = ?11 AND task_id = ?12 AND revision = ?13",
            params![
                next_revision,
                final_subject,
                final_description,
                final_status,
                final_owner_session_id,
                final_owner_member_name,
                blocked_by_json,
                write_scopes_json,
                if final_deleted { 1 } else { 0 },
                now,
                team_session_id,
                task_id,
                expected_revision
            ],
        )?;

        db.conn().execute(
            "UPDATE teams SET revision = revision + 1, updated_at = ?2 WHERE team_session_id = ?1",
            params![team_session_id, now],
        )?;

        Ok(())
    })?;

    Ok(TeamTask {
        team_session_id: team_session_id.to_string(),
        task_id: task_id.to_string(),
        revision: next_revision,
        subject: final_subject.to_string(),
        description: final_description,
        status: final_status.to_string(),
        owner_session_id: final_owner_session_id,
        owner_member_name: final_owner_member_name,
        blocked_by: final_blocked_by,
        write_scopes: final_write_scopes,
        deleted: final_deleted,
        created_at: current.created_at,
        updated_at: now.to_string(),
    })
}

pub fn get_team_board_projection(
    db: &Database,
    team_session_id: &str,
) -> Result<TeamBoardProjection> {
    let team_revision: i64 = db
        .conn()
        .query_row(
            "SELECT revision FROM teams WHERE team_session_id = ?1",
            params![team_session_id],
            |row| row.get(0),
        )
        .unwrap_or(1);

    let tasks = list_team_tasks(db, team_session_id)?;

    // Compute readiness
    let status_map: HashMap<String, String> = tasks
        .iter()
        .map(|t| (t.task_id.clone(), t.status.clone()))
        .collect();

    let readiness: Vec<TeamTaskReadiness> = tasks
        .iter()
        .map(|t| {
            let unresolved: Vec<String> = t
                .blocked_by
                .iter()
                .filter(|dep| status_map.get(*dep).map(|s| s.as_str()) != Some("completed"))
                .cloned()
                .collect();
            let is_ready = t.status == "pending" && unresolved.is_empty();
            TeamTaskReadiness {
                task_id: t.task_id.clone(),
                is_ready,
                unresolved_blocked_by: unresolved,
            }
        })
        .collect();

    // Compute write scope overlaps
    let scope_overlaps = compute_scope_overlaps(&tasks);

    Ok(TeamBoardProjection {
        team_session_id: team_session_id.to_string(),
        revision: team_revision,
        tasks,
        readiness,
        scope_overlaps,
    })
}

/// Cycle detection via DFS
fn validate_dag(graph: &HashMap<String, Vec<String>>) -> Result<()> {
    let mut visited: HashSet<&str> = HashSet::new();
    let mut in_stack: HashSet<&str> = HashSet::new();

    fn dfs<'a>(
        node: &'a str,
        graph: &'a HashMap<String, Vec<String>>,
        visited: &mut HashSet<&'a str>,
        in_stack: &mut HashSet<&'a str>,
    ) -> Result<()> {
        visited.insert(node);
        in_stack.insert(node);

        if let Some(neighbors) = graph.get(node) {
            for neighbor in neighbors {
                if in_stack.contains(neighbor.as_str()) {
                    return Err(anyhow!(
                        "TEAM_TASK_DEPENDENCY_CYCLE: dependency cycle detected containing '{node}' -> '{neighbor}'"
                    ));
                }
                if !visited.contains(neighbor.as_str()) {
                    dfs(neighbor.as_str(), graph, visited, in_stack)?;
                }
            }
        }

        in_stack.remove(node);
        Ok(())
    }

    for node in graph.keys() {
        if !visited.contains(node.as_str()) {
            dfs(node.as_str(), graph, &mut visited, &mut in_stack)?;
        }
    }
    Ok(())
}

fn normalize_scope(scope: &str) -> String {
    let mut s = scope.trim().replace('\\', "/");
    while s.starts_with("./") {
        s = s[2..].to_string();
    }
    s = s.trim_matches('/').to_string();
    s
}

fn scopes_overlap(a: &str, b: &str) -> bool {
    let a = normalize_scope(a);
    let b = normalize_scope(b);
    if a.is_empty() || b.is_empty() {
        return true;
    }
    if a == b {
        return true;
    }
    if a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/")) {
        return true;
    }
    false
}

fn compute_scope_overlaps(tasks: &[TeamTask]) -> Vec<WriteScopeOverlap> {
    let active_tasks: Vec<&TeamTask> = tasks
        .iter()
        .filter(|t| !t.deleted && t.status != "completed" && t.status != "cancelled")
        .collect();

    let mut overlaps_map: HashMap<String, HashSet<String>> = HashMap::new();

    for i in 0..active_tasks.len() {
        for j in (i + 1)..active_tasks.len() {
            let t1 = active_tasks[i];
            let t2 = active_tasks[j];
            for s1 in &t1.write_scopes {
                for s2 in &t2.write_scopes {
                    if scopes_overlap(s1, s2) {
                        let key = if s1 <= s2 { s1.clone() } else { s2.clone() };
                        let set = overlaps_map.entry(key).or_default();
                        set.insert(t1.task_id.clone());
                        set.insert(t2.task_id.clone());
                    }
                }
            }
        }
    }

    overlaps_map
        .into_iter()
        .map(|(scope, task_set)| {
            let mut task_ids: Vec<String> = task_set.into_iter().collect();
            task_ids.sort();
            WriteScopeOverlap { scope, task_ids }
        })
        .collect()
}
