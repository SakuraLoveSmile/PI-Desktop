//! Capture Git metadata outside the Host state lock, then recheck caller scope.
use super::{rpc_err, team_rpc_err, AppState, JsonRpcError};
use serde_json::Value;
use std::{path::Path, sync::Arc};
use tokio::sync::Mutex;

pub(super) struct Snapshot {
    caller: String,
    is_lead: bool,
    turn: Option<String>,
    lead_scope: Option<Value>,
    project: Option<String>,
    pub head: Option<String>,
}

pub(super) async fn capture(
    state: &Arc<Mutex<AppState>>,
    method: &str,
    params: &Value,
) -> Result<Option<Snapshot>, JsonRpcError> {
    if method != "team.sendMessage" {
        return Ok(None);
    }
    let team = params
        .get("teamSessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
    let caller = params
        .get("callerSessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
    let mut snapshot = {
        let st = state.lock().await;
        crate::team::validate_team_participant(&st.db, team, caller).map_err(team_rpc_err)?;
        super::team_rpc::authorize_lead_mutation(&st.db, team, caller)?;
        if let Some(target) = params.get("target").and_then(Value::as_str) {
            super::team_rpc::authorize_lead_expert(&st.db, team, caller, target)?;
        }
        identity(&st.db, team, caller)?
    };
    snapshot.head = if let Some(project) = &snapshot.project {
        match crate::git_workspaces::dispatch_head(Path::new(project)).await {
            Ok(head) => head,
            Err(_) => {
                tracing::warn!(
                    session_id = caller,
                    "Team send-time HEAD unavailable: bounded Git metadata probe failed"
                );
                None
            }
        }
    } else {
        None
    };
    Ok(Some(snapshot))
}

fn identity(db: &crate::db::Database, team: &str, caller: &str) -> Result<Snapshot, JsonRpcError> {
    let project = crate::sessions::get_session(db, caller)
        .map_err(team_rpc_err)?
        .ok_or_else(|| rpc_err(1007, "sender not found", "NOT_FOUND"))?
        .summary
        .project_path;
    let turn = crate::sessions::running_turn_id(db, caller).map_err(team_rpc_err)?;
    let is_lead = caller == team;
    let lead_scope = if is_lead {
        db.kv_get(crate::team::authority::SCOPE_NS, team)
            .map_err(team_rpc_err)?
    } else {
        None
    };
    Ok(Snapshot {
        caller: caller.into(),
        is_lead,
        project,
        turn,
        lead_scope,
        head: None,
    })
}

pub(super) fn validate(
    db: &crate::db::Database,
    snapshot: Option<&Snapshot>,
) -> Result<(), JsonRpcError> {
    if let Some(snapshot) = snapshot {
        let current = crate::sessions::get_session(db, &snapshot.caller)
            .map_err(team_rpc_err)?
            .ok_or_else(|| rpc_err(1007, "sender no longer exists", "NOT_FOUND"))?;
        if current.summary.project_path != snapshot.project {
            return Err(rpc_err(
                1002,
                "sender project changed during HEAD capture; retry dispatch",
                "TEAM_TURN_INVALID",
            ));
        }
        let turn = crate::sessions::running_turn_id(db, &snapshot.caller).map_err(team_rpc_err)?;
        let scope = if snapshot.is_lead {
            db.kv_get(crate::team::authority::SCOPE_NS, &snapshot.caller)
                .map_err(team_rpc_err)?
        } else {
            None
        };
        if turn != snapshot.turn || scope != snapshot.lead_scope {
            return Err(rpc_err(
                1002,
                "sender turn or Team authority changed during HEAD capture; retry dispatch",
                "TEAM_TURN_INVALID",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::{self, SessionCreateOptions};
    use serde_json::json;

    #[tokio::test]
    async fn delayed_head_probe_cannot_bind_an_old_dispatch_to_a_new_retry() {
        let data = tempfile::tempdir().unwrap();
        let app = AppState::open(data.path()).unwrap();
        let caller = sessions::create_session_with_options(
            &app.db,
            SessionCreateOptions {
                mode: Some("agent".into()),
                execution_profile: Some("team".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        let old = sessions::begin_turn(&app.db, &caller, None, None).unwrap();
        let snapshot = identity(&app.db, &caller, &caller).unwrap();
        let state = Arc::new(Mutex::new(app));
        let (entered_tx, entered) = tokio::sync::oneshot::channel();
        let (release_tx, release) = tokio::sync::oneshot::channel();
        let delayed = {
            let state = state.clone();
            tokio::spawn(async move {
                entered_tx.send(()).unwrap();
                release.await.unwrap();
                // This is the same post-probe validation used before any mailbox write.
                validate(&state.lock().await.db, Some(&snapshot))
            })
        };
        entered.await.unwrap();
        {
            let st = state.lock().await;
            sessions::end_turn(&st.db, &old, "completed", None, None, false).unwrap();
            sessions::begin_turn(&st.db, &caller, None, None).unwrap();
        }
        release_tx.send(()).unwrap();
        let denied = delayed.await.unwrap().unwrap_err();
        assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_TURN_INVALID");
        let st = state.lock().await;
        assert_eq!(
            st.db
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM session_collaboration_messages",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            st.db
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM kv WHERE ns='team-dispatch-head-v1'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }
    #[test]
    fn unchanged_running_turn_does_not_allow_a_new_lead_authority_scope() {
        let data = tempfile::tempdir().unwrap();
        let app = AppState::open(data.path()).unwrap();
        let caller = sessions::create_session_with_options(
            &app.db,
            SessionCreateOptions {
                mode: Some("agent".into()),
                execution_profile: Some("team".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        sessions::begin_turn(&app.db, &caller, None, None).unwrap();
        let snapshot = identity(&app.db, &caller, &caller).unwrap();
        app.db
            .kv_set(
                crate::team::authority::SCOPE_NS,
                &caller,
                &json!("new-scope"),
            )
            .unwrap();
        assert_eq!(
            validate(&app.db, Some(&snapshot))
                .unwrap_err()
                .data
                .unwrap()["errorCode"],
            "TEAM_TURN_INVALID"
        );
    }
}
