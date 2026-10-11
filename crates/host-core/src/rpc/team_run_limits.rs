//! Host-owned budget scheduler; shuts down with the RPC server.
use super::{send_notification, team_rpc, AppState};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub(super) fn start(
    state: Arc<Mutex<AppState>>,
    tx: mpsc::UnboundedSender<String>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let st = state.lock().await;
            if let Err(error) = sweep(&st, &tx, crate::db::now_ms()) {
                tracing::warn!(error = %error, "Team run-limit sweep failed");
            }
        }
    })
}

pub(super) fn sweep(
    st: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    now: i64,
) -> anyhow::Result<()> {
    for team in crate::team::run_limits::teams(&st.db)? {
        let events = crate::team::run_limits::evaluate_at(&st.db, &team, now)?;
        // Retry interrupted Goal settlement independently of the one-shot limit
        // event so a failed write cannot leave a paused Goal marked running.
        if crate::team::run_limits::state(&st.db, &team)?
            .is_some_and(|state| state.hard_reached_at.is_some())
        {
            let executions = {
                let mut statement = st.db.conn().prepare_cached("SELECT execution_id FROM plan_approvals WHERE session_id=?1 AND COALESCE(execution_kind,kind)='goal' AND execution_state='running'")?;
                let rows = statement.query_map([&team], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            for execution in executions {
                let result = st.plans.finish_execution(
                    &st.db,
                    &execution,
                    crate::plans::EXECUTION_INTERRUPTED,
                    Some("TEAM_RUN_LIMIT_REACHED"),
                )?;
                send_notification(
                    tx,
                    "plans.changed",
                    json!({"sessionId":team,"proposalId":result.proposal_id,"executionId":execution,"executionState":"interrupted"}),
                );
            }
            // Repeat the idempotent safe-stop request while any original turn is
            // running. Paused queues do not start replacements after settlement.
            let running: bool = st.db.conn().query_row("SELECT EXISTS(SELECT 1 FROM turns WHERE status='running' AND (session_id=?1 OR session_id IN (SELECT member_session_id FROM team_members WHERE team_session_id=?1)))", [&team], |r|r.get(0))?;
            if running {
                send_notification(
                    tx,
                    "team.runLimitPauseRequested",
                    json!({"teamSessionId":team}),
                );
            }
        }
        for event in events {
            team_rpc::send_team_changed(
                &st.db,
                tx,
                &event.team,
                if event.kind == "soft" {
                    "run-limit-soft"
                } else {
                    "run-limit-hard"
                },
            )
            .map_err(|error| anyhow::anyhow!(error.message))?;
            if let Some(id) = event.message_id {
                send_notification(
                    tx,
                    "team.messageQueued",
                    json!({"teamSessionId":team,"messageId":id}),
                );
            } else {
                send_notification(tx, "team.queueChanged", json!({"teamSessionId":team}));
            }
        }
    }
    Ok(())
}
