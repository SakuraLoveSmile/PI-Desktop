use std::collections::HashSet;

use anyhow::{anyhow, Result};
use rusqlite::params;
use serde_json::json;
use uuid::Uuid;

use super::mailbox::{send_team_message, SendMessageParams};
use super::model::{
    TeamCoordinationError, TeamExecutionDecision, TeamLaunchReview, TeamLaunchReviewMember,
    TeamLaunchReviewSelectionUpdate, TeamMemberSelection, TeamProposedMember, MAX_TEAM_MEMBERS,
    MAX_TEAM_STRATEGY_REASON_CHARS, TEAM_EXECUTION_DECISION_SCHEMA_VERSION,
    TEAM_LAUNCH_REVIEW_SCHEMA_VERSION,
};
use super::roster::{
    create_team_member, get_team_member_by_name, get_team_member_by_session_id,
    validate_member_name, validate_team_lead, CreateMemberParams,
};
use crate::db::{now_ms, Database};
use crate::sessions;

pub const TEAM_LAUNCH_REVIEW_NS: &str = "team-launch-review-v1";
pub const TEAM_EXECUTION_DECISION_NS: &str = "team-execution-decision-v1";

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub struct DeclareStrategyParams<'a> {
    pub team_session_id: &'a str,
    pub caller_session_id: &'a str,
    pub lead_turn_id: &'a str,
    pub strategy: &'a str, // "lead_only" | "delegate"
    pub reason: &'a str,
    pub members: Option<Vec<TeamProposedMember>>,
}

pub fn declare_team_strategy(
    db: &Database,
    params: DeclareStrategyParams<'_>,
) -> Result<(TeamExecutionDecision, Option<TeamLaunchReview>)> {
    let DeclareStrategyParams {
        team_session_id,
        caller_session_id,
        lead_turn_id,
        strategy,
        reason,
        members,
    } = params;

    if caller_session_id != team_session_id {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: only the team lead may declare team strategy"
        ));
    }

    validate_team_lead(db, team_session_id)?;

    if strategy != "lead_only" && strategy != "delegate" {
        return Err(anyhow!(
            "INVALID_PARAMS: strategy must be 'lead_only' or 'delegate'"
        ));
    }

    let bounded_reason = if reason.len() > MAX_TEAM_STRATEGY_REASON_CHARS {
        &reason[..MAX_TEAM_STRATEGY_REASON_CHARS]
    } else {
        reason
    };

    let decision_key = format!("{}:{}", team_session_id, lead_turn_id);
    let existing_decision_raw = db.kv_get(TEAM_EXECUTION_DECISION_NS, &decision_key)?;
    if let Some(val) = existing_decision_raw {
        let existing: TeamExecutionDecision = serde_json::from_value(val)?;
        // Check for identical retry
        if existing.strategy.as_deref() == Some(strategy) {
            let existing_review = if let Some(review_ids) = &existing.review_ids {
                if let Some(last_id) = review_ids.last() {
                    get_launch_review(db, team_session_id, Some(last_id))?
                } else {
                    None
                }
            } else {
                None
            };
            return Ok((existing, existing_review));
        } else {
            return Err(anyhow!(
                "TEAM_REVIEW_REVISION_CONFLICT: strategy declaration already exists for turn {} with different strategy",
                lead_turn_id
            ));
        }
    }

    let lead_detail = sessions::get_session(db, team_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: lead session not found"))?;
    let lead_summary = lead_detail.summary;

    let default_provider_id = lead_summary
        .provider_id
        .unwrap_or_else(|| "default".to_string());
    let default_model_id = lead_summary
        .model_id
        .unwrap_or_else(|| "default".to_string());
    let default_thinking_level = lead_summary.thinking_level;

    if strategy == "lead_only" {
        let decision = TeamExecutionDecision {
            schema_version: TEAM_EXECUTION_DECISION_SCHEMA_VERSION,
            team_session_id: team_session_id.to_string(),
            lead_turn_id: lead_turn_id.to_string(),
            strategy: Some("lead_only".to_string()),
            reason: Some(bounded_reason.to_string()),
            updated_at: now_iso(),
            task_ids: vec![],
            member_session_ids: vec![],
            message_ids: vec![],
            review_ids: None,
            coordination_error: None,
        };

        db.kv_set(
            TEAM_EXECUTION_DECISION_NS,
            &decision_key,
            &serde_json::to_value(&decision)?,
        )?;

        return Ok((decision, None));
    }

    // strategy == "delegate"
    let proposed_members = members.unwrap_or_default();
    if proposed_members.is_empty() {
        return Err(anyhow!(
            "INVALID_PARAMS: delegate strategy requires at least one proposed member"
        ));
    }
    if proposed_members.len() > MAX_TEAM_MEMBERS {
        return Err(anyhow!(
            "TEAM_MEMBER_LIMIT_EXCEEDED: cannot propose more than {MAX_TEAM_MEMBERS} members"
        ));
    }

    let mut seen_names = HashSet::new();
    let mut review_members = Vec::new();

    for proposed in proposed_members {
        validate_member_name(&proposed.name)?;
        let lower_name = proposed.name.to_lowercase();
        if !seen_names.insert(lower_name) {
            return Err(anyhow!(
                "TEAM_MEMBER_NAME_COLLISION: duplicate proposed member name '{}'",
                proposed.name
            ));
        }

        if let Some(ref member_sid) = proposed.member_session_id {
            if let Some(existing_m) = get_team_member_by_session_id(db, member_sid)? {
                if existing_m.team_session_id != team_session_id {
                    return Err(anyhow!(
                        "TEAM_UNAUTHORIZED: proposed member session belongs to another team"
                    ));
                }
            } else {
                return Err(anyhow!(
                    "TEAM_NOT_FOUND: proposed member session id not found"
                ));
            }
        }

        let context_kind = proposed.context_kind.unwrap_or_else(|| "fresh".to_string());
        if context_kind != "fresh" && context_kind != "fork" {
            return Err(anyhow!(
                "INVALID_PARAMS: contextKind must be 'fresh' or 'fork'"
            ));
        }

        let sel = proposed.selection.unwrap_or_default();
        let provider_id = sel
            .provider_id
            .unwrap_or_else(|| default_provider_id.clone());
        let model_id = sel.model_id.unwrap_or_else(|| default_model_id.clone());
        let thinking_level = sel
            .thinking_level
            .unwrap_or_else(|| default_thinking_level.clone());

        if let Err(e) = sessions::validate_thinking_level(&thinking_level) {
            return Err(anyhow!(
                "TEAM_MODEL_SELECTION_INVALID: invalid thinking level: {e}"
            ));
        }

        review_members.push(TeamLaunchReviewMember {
            name: proposed.name,
            description: proposed.description,
            context_kind,
            member_session_id: proposed.member_session_id,
            selection: TeamMemberSelection {
                provider_id,
                model_id,
                thinking_level,
            },
        });
    }

    let review_id = format!("tlr_{}", Uuid::new_v4().simple());
    let review = TeamLaunchReview {
        schema_version: TEAM_LAUNCH_REVIEW_SCHEMA_VERSION,
        review_id: review_id.clone(),
        team_session_id: team_session_id.to_string(),
        lead_turn_id: lead_turn_id.to_string(),
        revision: 1,
        status: "pending".to_string(),
        members: review_members,
    };

    let decision = TeamExecutionDecision {
        schema_version: TEAM_EXECUTION_DECISION_SCHEMA_VERSION,
        team_session_id: team_session_id.to_string(),
        lead_turn_id: lead_turn_id.to_string(),
        strategy: Some("delegate".to_string()),
        reason: Some(bounded_reason.to_string()),
        updated_at: now_iso(),
        task_ids: vec![],
        member_session_ids: vec![],
        message_ids: vec![],
        review_ids: Some(vec![review_id.clone()]),
        coordination_error: None,
    };

    let review_val = serde_json::to_value(&review)?;
    db.kv_set(
        TEAM_LAUNCH_REVIEW_NS,
        &format!("{}:{}", team_session_id, review_id),
        &review_val,
    )?;
    db.kv_set(TEAM_LAUNCH_REVIEW_NS, &review_id, &review_val)?;
    db.kv_set(
        TEAM_LAUNCH_REVIEW_NS,
        &format!("{}:latest", team_session_id),
        &json!(review_id),
    )?;

    db.kv_set(
        TEAM_EXECUTION_DECISION_NS,
        &decision_key,
        &serde_json::to_value(&decision)?,
    )?;

    Ok((decision, Some(review)))
}

pub fn get_execution_decision(
    db: &Database,
    team_session_id: &str,
    lead_turn_id: &str,
) -> Result<Option<TeamExecutionDecision>> {
    let key = format!("{}:{}", team_session_id, lead_turn_id);
    if let Some(val) = db.kv_get(TEAM_EXECUTION_DECISION_NS, &key)? {
        let dec: TeamExecutionDecision = serde_json::from_value(val)?;
        Ok(Some(dec))
    } else {
        Ok(None)
    }
}

pub fn get_launch_review(
    db: &Database,
    team_session_id: &str,
    review_id: Option<&str>,
) -> Result<Option<TeamLaunchReview>> {
    let target_review_id = if let Some(id) = review_id {
        id.to_string()
    } else {
        let latest_key = format!("{}:latest", team_session_id);
        if let Some(val) = db.kv_get(TEAM_LAUNCH_REVIEW_NS, &latest_key)? {
            val.as_str().unwrap_or_default().to_string()
        } else {
            return Ok(None);
        }
    };

    if target_review_id.is_empty() {
        return Ok(None);
    }

    let scoped_key = format!("{}:{}", team_session_id, target_review_id);
    let val = if let Some(v) = db.kv_get(TEAM_LAUNCH_REVIEW_NS, &scoped_key)? {
        Some(v)
    } else {
        db.kv_get(TEAM_LAUNCH_REVIEW_NS, &target_review_id)?
    };

    if let Some(raw) = val {
        let review: TeamLaunchReview = serde_json::from_value(raw)?;
        if review.team_session_id != team_session_id {
            // wrong-team ids reveal no body
            return Ok(None);
        }
        Ok(Some(review))
    } else {
        Ok(None)
    }
}

pub fn update_launch_review(
    db: &Database,
    team_session_id: &str,
    review_id: &str,
    expected_revision: i64,
    selections: Vec<TeamLaunchReviewSelectionUpdate>,
) -> Result<TeamLaunchReview> {
    let existing = get_launch_review(db, team_session_id, Some(review_id))?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: launch review '{review_id}' not found"))?;

    if existing.status != "pending" {
        return Err(anyhow!(
            "TEAM_REVIEW_REVISION_CONFLICT: cannot update review in '{}' status",
            existing.status
        ));
    }

    if existing.revision != expected_revision {
        return Err(anyhow!(
            "TEAM_REVIEW_REVISION_CONFLICT: expected revision {} but review is at {}",
            expected_revision,
            existing.revision
        ));
    }

    let mut updated_members = existing.members.clone();
    for update in selections {
        if let Err(e) = sessions::validate_thinking_level(&update.thinking_level) {
            return Err(anyhow!(
                "TEAM_MODEL_SELECTION_INVALID: invalid thinking level: {e}"
            ));
        }
        if let Some(member) = updated_members.iter_mut().find(|m| m.name == update.name) {
            member.selection.provider_id = update.provider_id;
            member.selection.model_id = update.model_id;
            member.selection.thinking_level = update.thinking_level;
        } else {
            return Err(anyhow!(
                "INVALID_PARAMS: unknown member '{}' in selection update",
                update.name
            ));
        }
    }

    let mut next_review = existing;
    next_review.members = updated_members;
    next_review.revision += 1;

    let review_val = serde_json::to_value(&next_review)?;
    db.kv_set(
        TEAM_LAUNCH_REVIEW_NS,
        &format!("{}:{}", team_session_id, review_id),
        &review_val,
    )?;
    db.kv_set(TEAM_LAUNCH_REVIEW_NS, review_id, &review_val)?;

    Ok(next_review)
}

pub fn confirm_launch_review(
    db: &Database,
    team_session_id: &str,
    review_id: &str,
    expected_revision: i64,
) -> Result<(TeamLaunchReview, TeamExecutionDecision)> {
    let existing = get_launch_review(db, team_session_id, Some(review_id))?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: launch review '{review_id}' not found"))?;

    let decision_key = format!("{}:{}", team_session_id, existing.lead_turn_id);
    let mut decision: TeamExecutionDecision = db
        .kv_get(TEAM_EXECUTION_DECISION_NS, &decision_key)?
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_else(|| TeamExecutionDecision {
            schema_version: TEAM_EXECUTION_DECISION_SCHEMA_VERSION,
            team_session_id: team_session_id.to_string(),
            lead_turn_id: existing.lead_turn_id.clone(),
            strategy: Some("delegate".to_string()),
            reason: None,
            updated_at: now_iso(),
            task_ids: vec![],
            member_session_ids: vec![],
            message_ids: vec![],
            review_ids: Some(vec![review_id.to_string()]),
            coordination_error: None,
        });

    // Idempotent duplicate confirm
    if existing.status == "confirmed" {
        if existing.revision == expected_revision {
            return Ok((existing, decision));
        } else {
            return Err(anyhow!(
                "TEAM_REVIEW_REVISION_CONFLICT: review already confirmed at revision {}",
                existing.revision
            ));
        }
    }

    if existing.status != "pending" {
        return Err(anyhow!(
            "TEAM_REVIEW_REVISION_CONFLICT: cannot confirm review in '{}' status",
            existing.status
        ));
    }

    if existing.revision != expected_revision {
        return Err(anyhow!(
            "TEAM_REVIEW_REVISION_CONFLICT: expected revision {} but review is at {}",
            expected_revision,
            existing.revision
        ));
    }

    // Materialize members and send confirmation message
    let mut materialized_member_session_ids = Vec::new();
    let mut member_names = Vec::new();

    for member in &existing.members {
        member_names.push(member.name.clone());
        let session_id = if let Some(ref msid) = member.member_session_id {
            msid.clone()
        } else if let Some(existing_member) =
            get_team_member_by_name(db, team_session_id, &member.name)?
        {
            existing_member.member_session_id
        } else {
            let created = create_team_member(
                db,
                CreateMemberParams {
                    team_session_id,
                    caller_session_id: team_session_id,
                    name: &member.name,
                    description: member.description.as_deref(),
                    context_kind: Some(&member.context_kind),
                    model_id: Some(&member.selection.model_id),
                    provider_id: Some(&member.selection.provider_id),
                },
            )?;
            // If thinking level is specified, configure it on the member session
            let _ = sessions::configure_session_with_thinking(
                db,
                &created.member_session_id,
                "agent",
                Some(&member.selection.provider_id),
                Some(&member.selection.model_id),
                Some(&member.selection.thinking_level),
                None,
            );
            created.member_session_id
        };
        materialized_member_session_ids.push(session_id);
    }

    // Persist continuation message to Lead in mailbox
    let confirmation_content = format!(
        "Team review {} confirmed. Approved members: {}.",
        review_id,
        member_names.join(", ")
    );
    let confirmation_key = format!("team-review:{}:confirmed", review_id);

    let sender_session_id = materialized_member_session_ids
        .first()
        .map(|s| s.as_str())
        .unwrap_or(team_session_id);

    let msg = send_team_message(
        db,
        SendMessageParams {
            team_session_id,
            caller_session_id: sender_session_id,
            target_identifier: "Lead",
            content: &confirmation_content,
            idempotency_key: Some(&confirmation_key),
        },
    )?;

    let mut confirmed_review = existing;
    confirmed_review.status = "confirmed".to_string();
    confirmed_review.revision += 1;

    decision.member_session_ids = materialized_member_session_ids;
    if !decision.message_ids.contains(&msg.id) {
        decision.message_ids.push(msg.id);
    }
    decision.updated_at = now_iso();

    let review_val = serde_json::to_value(&confirmed_review)?;
    db.kv_set(
        TEAM_LAUNCH_REVIEW_NS,
        &format!("{}:{}", team_session_id, review_id),
        &review_val,
    )?;
    db.kv_set(TEAM_LAUNCH_REVIEW_NS, review_id, &review_val)?;

    db.kv_set(
        TEAM_EXECUTION_DECISION_NS,
        &decision_key,
        &serde_json::to_value(&decision)?,
    )?;

    Ok((confirmed_review, decision))
}

pub fn cancel_launch_review(
    db: &Database,
    team_session_id: &str,
    review_id: &str,
    expected_revision: i64,
) -> Result<TeamLaunchReview> {
    let existing = get_launch_review(db, team_session_id, Some(review_id))?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: launch review '{review_id}' not found"))?;

    if existing.status == "cancelled" {
        return Ok(existing);
    }

    if existing.status == "confirmed" {
        return Err(anyhow!(
            "INVALID_PARAMS: cannot cancel a confirmed launch review"
        ));
    }

    if existing.revision != expected_revision {
        return Err(anyhow!(
            "TEAM_REVIEW_REVISION_CONFLICT: expected revision {} but review is at {}",
            expected_revision,
            existing.revision
        ));
    }

    let mut cancelled_review = existing;
    cancelled_review.status = "cancelled".to_string();
    cancelled_review.revision += 1;

    let review_val = serde_json::to_value(&cancelled_review)?;
    db.kv_set(
        TEAM_LAUNCH_REVIEW_NS,
        &format!("{}:{}", team_session_id, review_id),
        &review_val,
    )?;
    db.kv_set(TEAM_LAUNCH_REVIEW_NS, review_id, &review_val)?;

    Ok(cancelled_review)
}

pub fn interrupt_pending_reviews_on_boot(db: &Database) -> Result<()> {
    let mut stmt = db
        .conn()
        .prepare("SELECT key, value_json FROM kv WHERE ns = ?1")?;
    let rows = stmt.query_map(params![TEAM_LAUNCH_REVIEW_NS], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut updates = Vec::new();
    for row in rows {
        let (key, val_json) = row?;
        if let Ok(mut review) = serde_json::from_str::<TeamLaunchReview>(&val_json) {
            if review.status == "pending" {
                review.status = "interrupted".to_string();
                review.revision += 1;
                updates.push((key, serde_json::to_value(&review)?));
            }
        }
    }

    for (key, val) in updates {
        db.kv_set(TEAM_LAUNCH_REVIEW_NS, &key, &val)?;
    }

    Ok(())
}
