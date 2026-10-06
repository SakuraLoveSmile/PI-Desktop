//! Host RPC for Expert Team collaboration (`team.*`).
//!
//! The error mapping and `team.changed` helpers are shared with the session
//! and project arms that stay in the parent module.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};

use super::{rpc_err, send_notification, AppState, JsonRpcError};
use crate::sessions;

pub(super) fn team_rpc_err(e: anyhow::Error) -> JsonRpcError {
    let msg = e.to_string();
    let code_str = if msg.contains("TEAM_PLANNING_NOT_READY") {
        "TEAM_PLANNING_NOT_READY"
    } else if msg.contains("TEAM_PLANNING_STALE") {
        "TEAM_PLANNING_STALE"
    } else if msg.contains("TEAM_PLANNING_CLOSED") {
        "TEAM_PLANNING_CLOSED"
    } else if msg.contains("TEAM_RESEARCH_INVALID") {
        "TEAM_RESEARCH_INVALID"
    } else if msg.contains("TEAM_RESEARCH_READ_ONLY") {
        "TEAM_RESEARCH_READ_ONLY"
    } else if msg.contains("TEAM_DELIVERY_PENDING") {
        "TEAM_DELIVERY_PENDING"
    } else if msg.contains("TEAM_UNAUTHORIZED") {
        "TEAM_UNAUTHORIZED"
    } else if msg.contains("TEAM_NOT_FOUND") {
        "TEAM_NOT_FOUND"
    } else if msg.contains("TEAM_TARGET_NOT_FOUND") {
        "TEAM_TARGET_NOT_FOUND"
    } else if msg.contains("TEAM_MEMBER_LIMIT_EXCEEDED") {
        "TEAM_MEMBER_LIMIT_EXCEEDED"
    } else if msg.contains("TEAM_MEMBER_NAME_COLLISION") {
        "TEAM_MEMBER_NAME_COLLISION"
    } else if msg.contains("TEAM_TASK_NOT_FOUND") {
        "TEAM_TASK_NOT_FOUND"
    } else if msg.contains("TEAM_TASK_REVISION_CONFLICT") {
        "TEAM_TASK_REVISION_CONFLICT"
    } else if msg.contains("TEAM_TASK_DEPENDENCY_CYCLE") {
        "TEAM_TASK_DEPENDENCY_CYCLE"
    } else if msg.contains("TEAM_TASK_UNKNOWN_DEPENDENCY") {
        "TEAM_TASK_UNKNOWN_DEPENDENCY"
    } else if msg.contains("TEAM_TASK_LIMIT_EXCEEDED") {
        "TEAM_TASK_LIMIT_EXCEEDED"
    } else if msg.contains("TEAM_MAILBOX_FULL") {
        "TEAM_MAILBOX_FULL"
    } else if msg.contains("TEAM_MESSAGE_PAYLOAD_TOO_LARGE") {
        "TEAM_MESSAGE_PAYLOAD_TOO_LARGE"
    } else if msg.contains("TEAM_APPROVAL_REQUIRED") {
        "TEAM_APPROVAL_REQUIRED"
    } else if msg.contains("TEAM_REVIEW_REVISION_CONFLICT") {
        "TEAM_REVIEW_REVISION_CONFLICT"
    } else if msg.contains("TEAM_MODEL_SELECTION_INVALID") {
        "TEAM_MODEL_SELECTION_INVALID"
    } else if msg.contains("TEAM_MEMBER_MODEL_CHANGE_BLOCKED") {
        "TEAM_MEMBER_MODEL_CHANGE_BLOCKED"
    } else if msg.contains("TEAM_LEAD_CONFIGURATION_BLOCKED") {
        "TEAM_LEAD_CONFIGURATION_BLOCKED"
    } else if msg.contains("INVALID_PARAMS") {
        "INVALID_PARAMS"
    } else {
        "INTERNAL"
    };
    rpc_err(1002, msg, code_str)
}

pub(super) fn send_team_changed(
    db: &crate::db::Database,
    tx: &mpsc::UnboundedSender<String>,
    team_session_id: &str,
    reason: &str,
) -> Result<(), JsonRpcError> {
    let Some(team) = crate::team::get_team(db, team_session_id).map_err(team_rpc_err)? else {
        return Ok(());
    };
    send_notification(
        tx,
        "team.changed",
        json!({
            "teamSessionId": team_session_id,
            "revision": team.revision,
            "reason": reason,
        }),
    );
    Ok(())
}

fn team_revision(
    db: &crate::db::Database,
    team_session_id: &str,
) -> Result<Option<i64>, JsonRpcError> {
    Ok(crate::team::get_team(db, team_session_id)
        .map_err(team_rpc_err)?
        .map(|team| team.revision))
}

fn send_team_changed_if_revision_changed(
    db: &crate::db::Database,
    tx: &mpsc::UnboundedSender<String>,
    team_session_id: &str,
    previous_revision: Option<i64>,
    reason: &str,
) -> Result<(), JsonRpcError> {
    if team_revision(db, team_session_id)? != previous_revision {
        send_team_changed(db, tx, team_session_id, reason)?;
    }
    Ok(())
}

pub(super) fn team_id_for_participant(
    db: &crate::db::Database,
    session_id: &str,
) -> Result<Option<String>, JsonRpcError> {
    if let Some(member) =
        crate::team::get_team_member_by_session_id(db, session_id).map_err(team_rpc_err)?
    {
        return Ok(Some(member.team_session_id));
    }
    if sessions::session_execution_profile(db, session_id)
        .map_err(team_rpc_err)?
        .as_deref()
        == Some("team")
        && crate::team::get_team(db, session_id)
            .map_err(team_rpc_err)?
            .is_some()
    {
        return Ok(Some(session_id.to_string()));
    }
    Ok(None)
}

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
    tx: mpsc::UnboundedSender<String>,
) -> Result<Value, JsonRpcError> {
    let st = state.lock().await;
    match method {
        "team.getRuntimeContext" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            if sessions::session_execution_profile(&st.db, session_id)
                .map_err(team_rpc_err)?
                .as_deref()
                != Some("team")
            {
                return Ok(Value::Null);
            }
            if let Some(member) = crate::team::get_team_member_by_session_id(&st.db, session_id)
                .map_err(team_rpc_err)?
            {
                let member_name = crate::team::validate_team_participant(
                    &st.db,
                    &member.team_session_id,
                    session_id,
                )
                .map_err(team_rpc_err)?;
                let purpose =
                    crate::team::planning::purpose(&st.db, session_id).map_err(team_rpc_err)?;
                let mut context = json!({
                    "teamSessionId": member.team_session_id,
                    "callerSessionId": session_id,
                    "isLead": false,
                    "memberName": member_name,
                    "workPurpose": purpose.as_ref().map(|p|p.work_purpose.as_str()).unwrap_or("execute"),
                });
                if let Some(purpose) = purpose.filter(|p| p.work_purpose == "plan_research") {
                    context["planningId"] = json!(purpose.planning_id);
                    context["roundId"] = json!(purpose.round_id);
                }
                return Ok(context);
            }
            crate::team::validate_team_lead(&st.db, session_id).map_err(team_rpc_err)?;
            Ok(json!({
                "teamSessionId": session_id,
                "callerSessionId": session_id,
                "isLead": true,
            }))
        }
        "team.getPlanning"
        | "team.submitResearchResult"
        | "team.openPlanningQuestion"
        | "team.closePlanningQuestion" => {
            let required = |key: &str| {
                params
                    .get(key)
                    .and_then(Value::as_str)
                    .ok_or_else(|| rpc_err(1002, format!("{key} required"), "INVALID_PARAMS"))
            };
            let team = required("teamSessionId")?;
            let caller = required("callerSessionId")?;
            if method == "team.getPlanning" {
                return crate::team::planning::projection(&st.db, team, caller)
                    .map_err(team_rpc_err);
            }
            let round = required("roundId")?;
            if method == "team.submitResearchResult" {
                let result =
                    serde_json::from_value(params.get("structuredResult").cloned().ok_or_else(
                        || rpc_err(1002, "structuredResult required", "INVALID_PARAMS"),
                    )?)
                    .map_err(|e| rpc_err(1002, e.to_string(), "TEAM_RESEARCH_INVALID"))?;
                let submitted = crate::team::planning::submit(
                    &st.db,
                    crate::team::planning::SubmitResearch {
                        team,
                        caller,
                        planning_id: required("planningId")?,
                        round_id: round,
                        task_id: required("taskId")?,
                        expected_revision: params
                            .get("expectedRevision")
                            .and_then(Value::as_i64)
                            .ok_or_else(|| {
                            rpc_err(1002, "expectedRevision required", "INVALID_PARAMS")
                        })?,
                        result,
                    },
                )
                .map_err(team_rpc_err)?;
                send_team_changed(&st.db, &tx, team, "task")?;
                return Ok(json!({"result":submitted}));
            }
            crate::team::planning::question(
                &st.db,
                team,
                caller,
                round,
                required("questionId")?,
                method == "team.openPlanningQuestion",
            )
            .map_err(team_rpc_err)?;
            send_team_changed(&st.db, &tx, team, "task")?;
            Ok(json!({"ok":true}))
        }
        "team.getRoster" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            crate::team::validate_team_participant(&st.db, team_id, caller_id)
                .map_err(team_rpc_err)?;
            let members = crate::team::list_team_members(&st.db, team_id).map_err(team_rpc_err)?;
            let team = crate::team::get_team(&st.db, team_id).map_err(team_rpc_err)?;
            Ok(json!({
                "teamSessionId": team_id,
                "revision": team.as_ref().map(|t| t.revision).unwrap_or(1),
                "paused": team.as_ref().map(|t| t.paused).unwrap_or(false),
                "members": members,
            }))
        }
        "team.getSnapshot" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            crate::team::validate_team_participant(&st.db, team_id, caller_id)
                .map_err(team_rpc_err)?;
            let snapshot = crate::team::get_team_snapshot(&st.db, team_id).map_err(team_rpc_err)?;
            Ok(json!(snapshot))
        }
        "team.getBoard" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            crate::team::validate_team_participant(&st.db, team_id, caller_id)
                .map_err(team_rpc_err)?;
            let projection =
                crate::team::get_team_board_projection(&st.db, team_id).map_err(team_rpc_err)?;
            Ok(json!(projection))
        }
        "team.createMember" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            let name = params
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "name required", "INVALID_PARAMS"))?;
            let description = params.get("description").and_then(|v| v.as_str());
            let context_kind = params.get("contextKind").and_then(|v| v.as_str());
            let model_id = params.get("modelId").and_then(|v| v.as_str());
            let provider_id = params.get("providerId").and_then(|v| v.as_str());
            let member = crate::team::create_team_member(
                &st.db,
                crate::team::CreateMemberParams {
                    team_session_id: team_id,
                    caller_session_id: caller_id,
                    name,
                    description,
                    context_kind,
                    model_id,
                    provider_id,
                },
            )
            .map_err(team_rpc_err)?;
            Ok(json!({ "member": member }))
        }
        "team.createTask" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            let subject = params
                .get("subject")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "subject required", "INVALID_PARAMS"))?;
            let task_id = params.get("taskId").and_then(|v| v.as_str());
            let description = params.get("description").and_then(|v| v.as_str());
            let blocked_by = params
                .get("blockedBy")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect::<Vec<_>>()
                });
            let write_scopes = params
                .get("writeScopes")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect::<Vec<_>>()
                });
            let owner_session_id = params.get("ownerSessionId").and_then(|v| v.as_str());
            let owner_member_name = params.get("ownerMemberName").and_then(|v| v.as_str());
            let task = crate::team::create_team_task(
                &st.db,
                crate::team::CreateTaskParams {
                    team_session_id: team_id,
                    caller_session_id: caller_id,
                    task_id,
                    subject,
                    description,
                    blocked_by,
                    write_scopes,
                    owner_session_id,
                    owner_member_name,
                },
            )
            .map_err(team_rpc_err)?;
            send_team_changed(&st.db, &tx, team_id, "task")?;
            Ok(json!({ "task": task }))
        }
        "team.updateTask" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            let task_id = params
                .get("taskId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "taskId required", "INVALID_PARAMS"))?;
            let expected_revision = params
                .get("expectedRevision")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| rpc_err(1002, "expectedRevision required", "INVALID_PARAMS"))?;
            let subject = params.get("subject").and_then(|v| v.as_str());
            let description = params.get("description").and_then(|v| v.as_str());
            let status = params.get("status").and_then(|v| v.as_str());
            let owner_session_id = params.get("ownerSessionId").map(|v| v.as_str());
            let owner_member_name = params.get("ownerMemberName").map(|v| v.as_str());
            let blocked_by = params
                .get("blockedBy")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect::<Vec<_>>()
                });
            let write_scopes = params
                .get("writeScopes")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect::<Vec<_>>()
                });
            let deleted = params.get("deleted").and_then(|v| v.as_bool());
            let task = crate::team::update_team_task(
                &st.db,
                crate::team::UpdateTaskParams {
                    team_session_id: team_id,
                    caller_session_id: caller_id,
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
                },
            )
            .map_err(team_rpc_err)?;
            send_team_changed(&st.db, &tx, team_id, "task")?;
            Ok(json!({ "task": task }))
        }
        "team.sendMessage" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            let target_id = params
                .get("target")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "target required", "INVALID_PARAMS"))?;
            let content = params
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "content required", "INVALID_PARAMS"))?;
            let idempotency_key = params.get("idempotencyKey").and_then(|v| v.as_str());
            let previous_revision = team_revision(&st.db, team_id)?;
            let msg = crate::team::send_team_message(
                &st.db,
                crate::team::SendMessageParams {
                    team_session_id: team_id,
                    caller_session_id: caller_id,
                    target_identifier: target_id,
                    content,
                    idempotency_key,
                },
            )
            .map_err(team_rpc_err)?;
            send_notification(
                &tx,
                "team.messageQueued",
                json!({ "teamSessionId": team_id, "messageId": msg.id }),
            );
            send_team_changed_if_revision_changed(
                &st.db,
                &tx,
                team_id,
                previous_revision,
                "mailbox",
            )?;
            Ok(json!({ "message": msg }))
        }
        "team.listMessages" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or(caller_id);
            crate::team::validate_team_participant(&st.db, team_id, caller_id)
                .map_err(team_rpc_err)?;
            crate::team::validate_team_participant(&st.db, team_id, session_id)
                .map_err(team_rpc_err)?;
            if caller_id != team_id && session_id != caller_id {
                return Err(rpc_err(
                    1001,
                    "members can only read their own Team messages",
                    "TEAM_UNAUTHORIZED",
                ));
            }
            let msgs = crate::team::list_member_messages(&st.db, team_id, session_id)
                .map_err(team_rpc_err)?;
            Ok(json!({ "messages": msgs }))
        }
        "team.pendingMessages" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            crate::team::validate_team_lead(&st.db, team_id).map_err(team_rpc_err)?;
            if caller_id != team_id {
                return Err(rpc_err(
                    1001,
                    "only the team lead can list pending deliveries",
                    "TEAM_UNAUTHORIZED",
                ));
            }
            let messages =
                crate::team::list_pending_team_messages(&st.db, team_id).map_err(team_rpc_err)?;
            Ok(json!({ "messages": messages }))
        }
        "team.getMessage" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            let message_id = params
                .get("messageId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "messageId required", "INVALID_PARAMS"))?;
            let message = crate::team::get_team_message(&st.db, team_id, caller_id, message_id)
                .map_err(team_rpc_err)?;
            Ok(json!({ "message": message }))
        }
        "team.ackMessage" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let ack_session_id = params
                .get("ackSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "ackSessionId required", "INVALID_PARAMS"))?;
            let message_id = params
                .get("messageId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "messageId required", "INVALID_PARAMS"))?;
            let result = params.get("result").and_then(|v| v.as_str());
            let previous_revision = team_revision(&st.db, team_id)?;
            let acknowledged =
                crate::team::ack_team_message(&st.db, team_id, ack_session_id, message_id, result)
                    .map_err(team_rpc_err)?;
            send_team_changed_if_revision_changed(
                &st.db,
                &tx,
                team_id,
                previous_revision,
                "mailbox",
            )?;
            Ok(json!({ "acknowledged": acknowledged }))
        }
        "team.interruptMember" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            if caller_id != team_id {
                return Err(rpc_err(
                    1001,
                    "only the team lead can interrupt a member",
                    "TEAM_UNAUTHORIZED",
                ));
            }
            crate::team::validate_team_lead(&st.db, team_id).map_err(team_rpc_err)?;
            let member_name = params
                .get("memberName")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "memberName required", "INVALID_PARAMS"))?;
            let member = crate::team::get_team_member_by_name(&st.db, team_id, member_name)
                .map_err(team_rpc_err)?
                .ok_or_else(|| rpc_err(1002, "Team member not found", "TEAM_TARGET_NOT_FOUND"))?;
            let turn_id = sessions::running_turn_id(&st.db, &member.member_session_id)
                .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
            if let Some(turn_id) = turn_id {
                send_notification(
                    &tx,
                    "team.interruptRequested",
                    json!({ "teamSessionId": team_id, "sessionId": member.member_session_id, "turnId": turn_id }),
                );
                Ok(json!({ "interrupted": true }))
            } else {
                Ok(json!({ "interrupted": false }))
            }
        }
        "team.pause" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            if caller_id != team_id {
                return Err(rpc_err(
                    1001,
                    "only the team lead can pause the Team",
                    "TEAM_UNAUTHORIZED",
                ));
            }
            crate::team::validate_team_lead(&st.db, team_id).map_err(team_rpc_err)?;
            let team = crate::team::pause_team(&st.db, team_id).map_err(team_rpc_err)?;
            send_team_changed(&st.db, &tx, team_id, "pause")?;
            send_notification(
                &tx,
                "team.queueChanged",
                json!({ "teamSessionId": team_id }),
            );
            Ok(json!({ "team": team }))
        }
        "team.resume" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            if caller_id != team_id {
                return Err(rpc_err(
                    1001,
                    "only the team lead can resume the Team",
                    "TEAM_UNAUTHORIZED",
                ));
            }
            crate::team::validate_team_lead(&st.db, team_id).map_err(team_rpc_err)?;
            let team = crate::team::resume_team(&st.db, team_id).map_err(team_rpc_err)?;
            send_notification(
                &tx,
                "team.queueChanged",
                json!({ "teamSessionId": team_id }),
            );
            send_team_changed(&st.db, &tx, team_id, "resume")?;
            Ok(json!({ "team": team }))
        }
        "team.declareStrategy" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let caller_id = params
                .get("callerSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            let lead_turn_id = params
                .get("leadTurnId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "leadTurnId required", "INVALID_PARAMS"))?;
            let strategy = params
                .get("strategy")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "strategy required", "INVALID_PARAMS"))?;
            let reason = params.get("reason").and_then(|v| v.as_str()).unwrap_or("");
            let members: Option<Vec<crate::team::TeamProposedMember>> = params
                .get("members")
                .map(|value| serde_json::from_value(value.clone()))
                .transpose()
                .map_err(|error| rpc_err(1002, error.to_string(), "INVALID_PARAMS"))?;
            let previous_decision =
                crate::team::get_execution_decision(&st.db, team_id, lead_turn_id)
                    .map_err(team_rpc_err)?;

            let (decision, review) = crate::team::declare_team_strategy(
                &st.db,
                crate::team::DeclareStrategyParams {
                    team_session_id: team_id,
                    caller_session_id: caller_id,
                    lead_turn_id,
                    strategy,
                    reason,
                    members,
                },
            )
            .map_err(team_rpc_err)?;

            if let Some(ref r) = review {
                send_notification(
                    &tx,
                    "team.launchReviewChanged",
                    json!({ "teamSessionId": team_id, "reviewId": r.review_id }),
                );
            }
            if previous_decision.as_ref() != Some(&decision) {
                send_team_changed(&st.db, &tx, team_id, "member")?;
            }

            Ok(json!({ "decision": decision, "review": review }))
        }
        "team.getExecutionDecision" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let lead_turn_id = params.get("leadTurnId").and_then(|v| v.as_str());

            let decision = if let Some(turn_id) = lead_turn_id {
                crate::team::get_execution_decision(&st.db, team_id, turn_id)
            } else {
                crate::team::get_latest_execution_decision(&st.db, team_id)
            }
            .map_err(team_rpc_err)?;
            Ok(json!({ "decision": decision }))
        }
        "team.getLaunchReview" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let review_id = params.get("reviewId").and_then(|v| v.as_str());

            let review =
                crate::team::get_launch_review(&st.db, team_id, review_id).map_err(team_rpc_err)?;
            Ok(json!({ "review": review }))
        }
        "team.updateLaunchReview" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let review_id = params
                .get("reviewId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "reviewId required", "INVALID_PARAMS"))?;
            let expected_revision = params
                .get("expectedRevision")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| rpc_err(1002, "expectedRevision required", "INVALID_PARAMS"))?;
            let selections: Vec<crate::team::TeamLaunchReviewSelectionUpdate> =
                serde_json::from_value(
                    params
                        .get("selections")
                        .cloned()
                        .ok_or_else(|| rpc_err(1002, "selections required", "INVALID_PARAMS"))?,
                )
                .map_err(|error| rpc_err(1002, error.to_string(), "INVALID_PARAMS"))?;

            let review = crate::team::update_launch_review(
                &st.db,
                team_id,
                review_id,
                expected_revision,
                selections,
            )
            .map_err(team_rpc_err)?;

            send_notification(
                &tx,
                "team.launchReviewChanged",
                json!({ "teamSessionId": team_id, "reviewId": review_id }),
            );
            send_team_changed(&st.db, &tx, team_id, "member")?;

            Ok(json!({ "review": review }))
        }
        "team.confirmLaunchReview" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let review_id = params
                .get("reviewId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "reviewId required", "INVALID_PARAMS"))?;
            let expected_revision = params
                .get("expectedRevision")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| rpc_err(1002, "expectedRevision required", "INVALID_PARAMS"))?;

            let (review, decision) =
                crate::team::confirm_launch_review(&st.db, team_id, review_id, expected_revision)
                    .map_err(team_rpc_err)?;

            send_notification(
                &tx,
                "team.launchReviewChanged",
                json!({ "teamSessionId": team_id, "reviewId": review_id }),
            );
            send_notification(
                &tx,
                "team.rosterChanged",
                json!({ "teamSessionId": team_id }),
            );
            send_notification(
                &tx,
                "team.queueChanged",
                json!({ "teamSessionId": team_id }),
            );
            send_team_changed(&st.db, &tx, team_id, "member")?;

            Ok(json!({ "review": review, "decision": decision }))
        }
        "team.cancelLaunchReview" => {
            let team_id = params
                .get("teamSessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
            let review_id = params
                .get("reviewId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "reviewId required", "INVALID_PARAMS"))?;
            let expected_revision = params
                .get("expectedRevision")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| rpc_err(1002, "expectedRevision required", "INVALID_PARAMS"))?;

            let review =
                crate::team::cancel_launch_review(&st.db, team_id, review_id, expected_revision)
                    .map_err(team_rpc_err)?;

            send_notification(
                &tx,
                "team.launchReviewChanged",
                json!({ "teamSessionId": team_id, "reviewId": review_id }),
            );
            send_team_changed(&st.db, &tx, team_id, "member")?;

            Ok(json!({ "review": review }))
        }
        _ => Err(rpc_err(
            1004,
            format!("unknown method: {method}"),
            "METHOD_NOT_FOUND",
        )),
    }
}
