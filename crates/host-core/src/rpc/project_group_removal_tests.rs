//! A refusal by one of the fork's own project-removal guards must leave a
//! multi-folder project group exactly as it was.
//!
//! Upstream's group handling (#1358) detaches a root from a multi-folder group
//! or deletes a single-folder group record. The fork's guards (a running turn,
//! a live scratch Goal, a team member whose lead stays) run in the per-session
//! loop in front of that code, so a refused removal never reaches the group.
//! Upstream's own test pins this for a running turn; the team-member guard
//! stands for the rest of the loop here.

use super::*;
use std::fs;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

async fn call(
    state: &Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
) -> Result<Value, JsonRpcError> {
    handle_request(state.clone(), method, params, mpsc::unbounded_channel().0).await
}

/// The explicit group of the test. The listing also carries a synthesized
/// legacy group for every ungrouped project, so the index is not stable.
fn team_group(groups: &Value) -> &Value {
    groups["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["name"] == "Team group")
        .expect("the explicit group is listed")
}

#[tokio::test]
async fn team_member_refusal_leaves_the_project_group_untouched() {
    let data_dir = tempfile::tempdir().unwrap();
    let removed_dir = data_dir.path().join("removed-project");
    let remaining_dir = data_dir.path().join("remaining-project");
    let lead_dir = data_dir.path().join("lead-project");
    for dir in [&removed_dir, &remaining_dir, &lead_dir] {
        fs::create_dir_all(dir).unwrap();
    }
    let mut app_state = AppState::open(data_dir.path()).unwrap();
    app_state.handshook = true;
    let removed_path = removed_dir.to_string_lossy().to_string();
    let remaining_path = remaining_dir.to_string_lossy().to_string();
    app_state
        .db
        .create_project_group("Team group", &[removed_path.clone(), remaining_path])
        .unwrap();
    let lead = sessions::create_session_with_options(
        &app_state.db,
        sessions::SessionCreateOptions {
            title: Some("Lead".into()),
            project_path: Some(lead_dir.to_string_lossy().to_string()),
            execution_profile: Some("team".into()),
            ..Default::default()
        },
    )
    .unwrap();
    crate::team::ensure_team(&app_state.db, &lead.id).unwrap();
    let member = sessions::create_session_with_options(
        &app_state.db,
        sessions::SessionCreateOptions {
            title: Some("Member".into()),
            project_path: Some(removed_path.clone()),
            execution_profile: Some("team".into()),
            ..Default::default()
        },
    )
    .unwrap();
    app_state
        .db
        .conn()
        .execute(
            "INSERT INTO team_members (
                team_session_id, member_session_id, name, context_kind, phase,
                created_at, updated_at
             ) VALUES (?1, ?2, 'worker', 'fresh', 'idle', 1, 1)",
            rusqlite::params![lead.id, member.id],
        )
        .unwrap();
    let state = Arc::new(Mutex::new(app_state));
    let groups_before = call(&state, "project.groups.list", json!({}))
        .await
        .unwrap();
    assert_eq!(
        team_group(&groups_before)["roots"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let error = call(&state, "projects.remove", json!({ "path": removed_path }))
        .await
        .expect_err("a team member whose lead stays blocks the removal");
    assert_eq!(
        error.data.as_ref().unwrap()["errorCode"],
        "TEAM_MEMBER_DELETION_BLOCKED"
    );

    // Nothing moved: not the group, not its primary root, not the project.
    let groups_after = call(&state, "project.groups.list", json!({}))
        .await
        .unwrap();
    assert_eq!(team_group(&groups_after), team_group(&groups_before));
    let canonical = crate::db::canonical_project_path(&removed_path).expect("canonical path");
    let projects = call(&state, "projects.list", json!({})).await.unwrap();
    assert!(projects["projects"]
        .as_array()
        .unwrap()
        .iter()
        .any(|project| project["path"].as_str() == Some(canonical.as_str())));
    let state = state.lock().await;
    for id in [&lead.id, &member.id] {
        assert!(sessions::get_session(&state.db, id).unwrap().is_some());
    }
    assert!(
        crate::team::get_team_member_by_session_id(&state.db, &member.id)
            .unwrap()
            .is_some()
    );
}
