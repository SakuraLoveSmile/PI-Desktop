//! Advisory attribution of successful file mutations to the member's active tasks.
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};

use crate::{db::Database, sessions, tools::ToolsExecuteResult, workspace};

const NS: &str = "team-write-scope-warning-v1";

pub(crate) struct Context {
    team: String,
    member: String,
    member_name: String,
    turn: String,
    tasks: Vec<(String, Vec<String>)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberWriteCount {
    pub member_session_id: String,
    pub member_name: String,
    pub count: u64,
}

pub(crate) fn capture(
    db: &Database,
    session: &str,
    expected_turn: Option<&str>,
    tool: &str,
) -> Result<Option<Context>> {
    if !matches!(tool, "Write" | "Edit") {
        return Ok(None);
    }
    let Some(member) = super::get_team_member_by_session_id(db, session)? else {
        return Ok(None);
    };
    let Some(turn) = sessions::running_turn_id(db, session)? else {
        return Ok(None);
    };
    if expected_turn.is_some_and(|expected| expected != turn) {
        return Ok(None);
    }
    let mut tasks = Vec::new();
    for task_id in
        super::task_attempts::active_task_ids(db.conn(), &member.team_session_id, session, &turn)?
    {
        if let Some(task) = super::get_team_task(db, &member.team_session_id, &task_id)? {
            if !task.write_scopes.is_empty() {
                tasks.push((task_id, task.write_scopes));
            }
        }
    }
    if tasks.is_empty() {
        return Ok(None);
    }
    Ok(Some(Context {
        team: member.team_session_id,
        member: session.into(),
        member_name: member.name,
        turn,
        tasks,
    }))
}

fn resolved_scope(workspace: &Path, scope: &str) -> Result<PathBuf> {
    workspace::resolve_external_path(workspace, scope.trim()).map_err(anyhow::Error::msg)
}

/// Directory component boundaries and symlinks match the tool's authoritative resolver.
pub(super) fn is_in_scope(workspace: &Path, path: &Path, scopes: &[String]) -> Result<bool> {
    for scope in scopes {
        let scope = resolved_scope(workspace, scope)?;
        if workspace::lexically_inside(&scope, &path.to_string_lossy()) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn annotate(
    db: &Database,
    context: Option<&Context>,
    workspace: Option<&Path>,
    call_id: &str,
    result: &mut ToolsExecuteResult,
) -> Result<()> {
    let (Some(context), Some(workspace)) = (context, workspace) else {
        return Ok(());
    };
    if !result.ok {
        return Ok(());
    }
    let Some(object) = result.content.as_object_mut() else {
        return Ok(());
    };
    let root = object.get("root").and_then(|v| v.as_str());
    // Scratch is temporary session data, not a shared project task mutation.
    if !matches!(root, Some("workspace" | "external")) {
        return Ok(());
    }
    let Some(path) = object.get("path").and_then(|v| v.as_str()) else {
        return Ok(());
    };
    let resolved = workspace::resolve_external_path(workspace, path).map_err(anyhow::Error::msg)?;
    for (_, scopes) in &context.tasks {
        if is_in_scope(workspace, &resolved, scopes)? {
            return Ok(());
        }
    }
    let task_ids: Vec<_> = context.tasks.iter().map(|(id, _)| id).collect();
    object.insert("scopeWarning".into(), json!({"code":"TEAM_WRITE_SCOPE_WARNING", "taskIds":task_ids,
      "message":"The file mutation succeeded outside this turn's declared task writeScopes. Coordinate with the Lead and update task scopes before further shared-tree edits. Bash writes are not tracked."}));
    // One warning per successful tool-call identity, even when a delivery is replayed.
    let key = serde_json::to_string(&(&context.member, &context.turn, call_id))?;
    let transaction = db.conn().unchecked_transaction()?;
    let attached: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM team_members m JOIN teams t ON t.team_session_id=m.team_session_id JOIN sessions s ON s.id=m.member_session_id WHERE m.team_session_id=?1 AND m.member_session_id=?2 AND s.deleted_at IS NULL)",params![context.team,context.member],|r|r.get(0))?;
    if !attached {
        object.insert("scopeTrackingSkipped".into(),json!("File mutation succeeded after its Team owner was detached; no advisory count was recorded."));
        return Ok(());
    }
    let inserted = transaction.execute("INSERT INTO kv(ns,key,value_json,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(ns,key) DO NOTHING",
      params![NS,key,json!({"teamSessionId":context.team,"memberSessionId":context.member,"memberName":context.member_name}).to_string(),crate::db::now_ms()])?;
    if inserted > 0 {
        transaction.execute(
            "UPDATE teams SET revision=revision+1,updated_at=?2 WHERE team_session_id=?1",
            params![context.team, crate::db::now_ms()],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

pub fn counts(db: &Database, team: &str) -> Result<Vec<MemberWriteCount>> {
    let mut statement = db.conn().prepare_cached("SELECT json_extract(value_json,'$.memberSessionId'),json_extract(value_json,'$.memberName'),COUNT(*) FROM kv WHERE ns=?1 AND json_extract(value_json,'$.teamSessionId')=?2 GROUP BY json_extract(value_json,'$.memberSessionId'),json_extract(value_json,'$.memberName') ORDER BY json_extract(value_json,'$.memberSessionId')")?;
    let rows = statement.query_map(params![NS, team], |r| {
        Ok(MemberWriteCount {
            member_session_id: r.get(0)?,
            member_name: r.get(1)?,
            count: r.get::<_, i64>(2)? as u64,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn cleanup_session(conn: &rusqlite::Connection, session: &str) -> Result<()> {
    conn.execute("DELETE FROM kv WHERE ns IN (?1,?3) AND (json_extract(value_json,'$.teamSessionId')=?2 OR json_extract(value_json,'$.memberSessionId')=?2)",params![NS,session,super::git_warnings::NS])?;
    Ok(())
}

/// Tracking is advisory: an error must remain observable without falsifying a
/// successful filesystem mutation or triggering the mutation retry budget.
pub(crate) fn annotate_observable(
    db: &Database,
    context: Option<&Context>,
    workspace: Option<&Path>,
    call_id: &str,
    result: &mut ToolsExecuteResult,
) {
    if let Err(error) = annotate(db, context, workspace, call_id, result) {
        tracing::error!(error = %error, "write scope warning tracking failed after mutation");
        if let Some(content) = result.content.as_object_mut() {
            content.insert("scopeTrackingError".into(), json!("File mutation succeeded, but advisory write-scope tracking failed. Inspect team_status before further shared-tree edits."));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scopes_use_canonical_paths_and_directory_component_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("owned")).unwrap();
        let scopes = vec!["./owned".into()];
        let path = |name| workspace::resolve_external_path(dir.path(), name).unwrap();
        assert!(is_in_scope(dir.path(), &path("owned/new.txt"), &scopes).unwrap());
        assert!(!is_in_scope(dir.path(), &path("owned-other/new.txt"), &scopes).unwrap());
        assert!(!is_in_scope(dir.path(), &path("owned/../other.txt"), &scopes).unwrap());
        assert!(is_in_scope(
            dir.path(),
            &path("owned/new.txt"),
            &[path("owned").to_string_lossy().into_owned()]
        )
        .unwrap());
        assert!(!is_in_scope(
            dir.path(),
            &path("owned/new.txt"),
            &["owned/file.txt".into()]
        )
        .unwrap());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("owned"), dir.path().join("alias")).unwrap();
            assert!(is_in_scope(dir.path(), &path("alias/new.txt"), &scopes).unwrap());
            std::os::unix::fs::symlink(
                dir.path().join("owned-other"),
                dir.path().join("owned/link"),
            )
            .unwrap();
            assert!(!is_in_scope(dir.path(), &path("owned/link/new.txt"), &scopes).unwrap());
        }
    }
    #[test]
    fn advisory_tracking_failure_never_turns_a_committed_write_into_a_mutation_error() {
        let db = super::super::tests::test_db();
        let dir = tempfile::tempdir().unwrap();
        let team = super::super::tests::create_test_lead(&db);
        super::super::ensure_team(&db, &team).unwrap();
        let member = sessions::create_session(&db, None, Some("agent".into()), None, None, None)
            .unwrap()
            .id;
        db.conn().execute("INSERT INTO team_members(team_session_id,member_session_id,name,context_kind,phase,created_at,updated_at) VALUES(?1,?2,'Builder','fresh','idle',0,0)",params![team,member]).unwrap();
        let context = Context {
            team: team.clone(),
            member,
            member_name: "Builder".into(),
            turn: "turn".into(),
            tasks: vec![("task".into(), vec!["owned".into()])],
        };
        let mut result = ToolsExecuteResult {
            tool_call_id: "call".into(),
            ok: true,
            is_error: Some(false),
            content: json!({"root":"workspace","path":"other.txt"}),
            duration_ms: 1,
            denied: Some(false),
            error_code: None,
            command_shell_id: None,
        };
        db.conn().execute_batch("CREATE TRIGGER reject_scope_tracking BEFORE INSERT ON kv BEGIN SELECT RAISE(ABORT,'fixture tracking I/O failed'); END;").unwrap();
        annotate_observable(&db, Some(&context), Some(dir.path()), "call", &mut result);
        assert!(result.ok);
        assert!(result.error_code.is_none());
        assert_eq!(
            result.content["scopeWarning"]["code"],
            "TEAM_WRITE_SCOPE_WARNING"
        );
        assert!(result.content["scopeTrackingError"]
            .as_str()
            .unwrap()
            .contains("succeeded"));
        assert!(counts(&db, &team).unwrap().is_empty());
    }
}
