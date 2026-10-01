use std::collections::HashSet;

use anyhow::{anyhow, Result};
use rusqlite::{params, Transaction};
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
    create_approved_team_member, get_team_member_by_name, get_team_member_by_session_id,
    validate_member_name, validate_team_lead, CreateMemberParams,
};
use crate::db::{now_ms, Database};
use crate::sessions;

pub const TEAM_LAUNCH_REVIEW_NS: &str = "team-launch-review-v1";
pub const TEAM_EXECUTION_DECISION_NS: &str = "team-execution-decision-v1";

fn kv_set_tx(tx: &Transaction<'_>, ns: &str, key: &str, value: &serde_json::Value) -> Result<()> {
    tx.execute(
        "INSERT INTO kv (ns, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(ns, key) DO UPDATE SET
           value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![ns, key, value.to_string(), now_ms()],
    )?;
    Ok(())
}

fn bump_team_revision_tx(tx: &Transaction<'_>, team_session_id: &str) -> Result<()> {
    tx.execute(
        "UPDATE teams SET revision=revision+1, updated_at=?2 WHERE team_session_id=?1",
        params![team_session_id, now_ms()],
    )?;
    Ok(())
}

pub(super) use super::review_selection::{
    default_member_route, has_pending_review_for_member, is_live_team_mail_turn,
    require_approved_member, validate_reused_member_for_confirmation,
};
pub(crate) use super::review_selection::{gate_team_member_turn, validate_member_route};

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
    if lead_turn_id.trim().is_empty() {
        return Err(anyhow!("INVALID_PARAMS: leadTurnId must not be empty"));
    }

    let bounded_reason: String = reason
        .chars()
        .take(MAX_TEAM_STRATEGY_REASON_CHARS)
        .collect();
    let requested_input = json!({
        "strategy": strategy,
        "reason": bounded_reason,
        "members": &members,
    });

    let decision_key = format!("{}:{}", team_session_id, lead_turn_id);
    let input_key = format!("{}:{}:input", team_session_id, lead_turn_id);
    let existing_decision_raw = db.kv_get(TEAM_EXECUTION_DECISION_NS, &decision_key)?;
    if let Some(val) = existing_decision_raw {
        let existing: TeamExecutionDecision = serde_json::from_value(val)?;
        // Check for identical retry
        if existing.strategy.as_deref() == Some(strategy)
            && existing.reason.as_deref() == Some(bounded_reason.as_str())
            && db.kv_get(TEAM_EXECUTION_DECISION_NS, &input_key)?.as_ref() == Some(&requested_input)
        {
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

    let valid_turn: bool = db.conn().query_row(
        "SELECT EXISTS(
            SELECT 1 FROM turns WHERE id = ?1 AND session_id = ?2 AND status = 'running'
         )",
        params![lead_turn_id, team_session_id],
        |row| row.get(0),
    )?;
    if !valid_turn {
        return Err(anyhow!(
            "TEAM_TURN_INVALID: leadTurnId must identify an active turn owned by the team lead"
        ));
    }

    if strategy == "lead_only" {
        let decision = TeamExecutionDecision {
            schema_version: TEAM_EXECUTION_DECISION_SCHEMA_VERSION,
            team_session_id: team_session_id.to_string(),
            lead_turn_id: lead_turn_id.to_string(),
            strategy: Some("lead_only".to_string()),
            reason: Some(bounded_reason.clone()),
            updated_at: now_iso(),
            task_ids: vec![],
            member_session_ids: vec![],
            message_ids: vec![],
            review_ids: None,
            coordination_error: None,
        };

        let tx = db.conn().unchecked_transaction()?;
        kv_set_tx(
            &tx,
            TEAM_EXECUTION_DECISION_NS,
            &decision_key,
            &serde_json::to_value(&decision)?,
        )?;
        kv_set_tx(
            &tx,
            TEAM_EXECUTION_DECISION_NS,
            &input_key,
            &requested_input,
        )?;
        kv_set_tx(
            &tx,
            TEAM_EXECUTION_DECISION_NS,
            &format!("{team_session_id}:latest"),
            &json!(lead_turn_id),
        )?;
        bump_team_revision_tx(&tx, team_session_id)?;
        tx.commit()?;

        return Ok((decision, None));
    }

    // strategy == "delegate"
    let lead_summary = sessions::get_session(db, team_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: lead session not found"))?
        .summary;
    let (default_provider_id, default_model_id) = default_member_route(db, team_session_id)?;
    let default_thinking_level = lead_summary.thinking_level;
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
        let mut canonical_name = proposed.name.clone();
        if let Some(member_sid) = proposed.member_session_id.as_deref() {
            let existing = get_team_member_by_session_id(db, member_sid)?
                .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: proposed member session id not found"))?;
            if existing.team_session_id != team_session_id {
                return Err(anyhow!(
                    "TEAM_UNAUTHORIZED: proposed member session belongs to another team"
                ));
            }
            if !existing.name.eq_ignore_ascii_case(&canonical_name) {
                return Err(anyhow!(
                    "TEAM_MEMBER_NAME_COLLISION: selected member name is immutable"
                ));
            }
            canonical_name = existing.name;
        } else if let Some(existing) =
            get_team_member_by_name(db, team_session_id, &canonical_name)?
        {
            canonical_name = existing.name;
        }
        if !seen_names.insert(canonical_name.to_lowercase()) {
            return Err(anyhow!(
                "TEAM_MEMBER_NAME_COLLISION: duplicate proposed member name '{}'",
                canonical_name
            ));
        }

        let context_kind = proposed.context_kind.unwrap_or_else(|| "fresh".to_string());
        if context_kind != "fresh" && context_kind != "fork" {
            return Err(anyhow!(
                "INVALID_PARAMS: contextKind must be 'fresh' or 'fork'"
            ));
        }

        let sel = proposed.selection.unwrap_or_default();
        if sel.provider_id.is_some() != sel.model_id.is_some() {
            return Err(anyhow!(
                "TEAM_MODEL_SELECTION_INVALID: provider and model overrides must be supplied together"
            ));
        }
        let provider_id = sel
            .provider_id
            .unwrap_or_else(|| default_provider_id.clone());
        let model_id = sel.model_id.unwrap_or_else(|| default_model_id.clone());
        let thinking_level = sel
            .thinking_level
            .unwrap_or_else(|| default_thinking_level.clone());

        validate_member_route(db, &provider_id, &model_id, &thinking_level)?;

        review_members.push(TeamLaunchReviewMember {
            name: canonical_name,
            description: proposed.description,
            context_kind,
            member_session_id: proposed.member_session_id,
            presentation: proposed
                .presentation
                .map(validate_presentation)
                .transpose()?,
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
        reason: Some(bounded_reason.clone()),
        updated_at: now_iso(),
        task_ids: vec![],
        member_session_ids: vec![],
        message_ids: vec![],
        review_ids: Some(vec![review_id.clone()]),
        coordination_error: None,
    };

    let review_val = serde_json::to_value(&review)?;
    let tx = db.conn().unchecked_transaction()?;
    kv_set_tx(
        &tx,
        TEAM_LAUNCH_REVIEW_NS,
        &format!("{}:{}", team_session_id, review_id),
        &review_val,
    )?;
    kv_set_tx(&tx, TEAM_LAUNCH_REVIEW_NS, &review_id, &review_val)?;
    kv_set_tx(
        &tx,
        TEAM_LAUNCH_REVIEW_NS,
        &format!("{}:latest", team_session_id),
        &json!(review_id),
    )?;

    kv_set_tx(
        &tx,
        TEAM_EXECUTION_DECISION_NS,
        &decision_key,
        &serde_json::to_value(&decision)?,
    )?;
    kv_set_tx(
        &tx,
        TEAM_EXECUTION_DECISION_NS,
        &input_key,
        &requested_input,
    )?;
    kv_set_tx(
        &tx,
        TEAM_EXECUTION_DECISION_NS,
        &format!("{team_session_id}:latest"),
        &json!(lead_turn_id),
    )?;
    bump_team_revision_tx(&tx, team_session_id)?;
    tx.commit()?;

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

pub fn get_latest_execution_decision(
    db: &Database,
    team_session_id: &str,
) -> Result<Option<TeamExecutionDecision>> {
    let Some(value) = db.kv_get(
        TEAM_EXECUTION_DECISION_NS,
        &format!("{team_session_id}:latest"),
    )?
    else {
        return Ok(None);
    };
    let Some(lead_turn_id) = value.as_str() else {
        return Ok(None);
    };
    let decision = get_execution_decision(db, team_session_id, lead_turn_id)?;
    Ok(decision.filter(|decision| decision.team_session_id == team_session_id))
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

    if selections.is_empty() {
        return Err(anyhow!(
            "INVALID_PARAMS: selection update must include at least one member"
        ));
    }
    let mut updated_names = HashSet::new();
    let mut update_indexes = Vec::with_capacity(selections.len());
    for update in &selections {
        if !updated_names.insert(update.name.to_lowercase()) {
            return Err(anyhow!(
                "INVALID_PARAMS: duplicate member '{}' in selection update",
                update.name
            ));
        }
        let Some(member_index) = existing
            .members
            .iter()
            .position(|member| member.name.eq_ignore_ascii_case(&update.name))
        else {
            return Err(anyhow!(
                "INVALID_PARAMS: unknown member '{}' in selection update",
                update.name
            ));
        };
        update_indexes.push(member_index);
        validate_member_route(
            db,
            &update.provider_id,
            &update.model_id,
            &update.thinking_level,
        )?;
    }

    let mut updated_members = existing.members.clone();
    for (update, member_index) in selections.into_iter().zip(update_indexes) {
        let member = &mut updated_members[member_index];
        member.selection.provider_id = update.provider_id;
        member.selection.model_id = update.model_id;
        member.selection.thinking_level = update.thinking_level;
    }

    let mut next_review = existing;
    next_review.members = updated_members;
    next_review.revision += 1;

    let review_val = serde_json::to_value(&next_review)?;
    let tx = db.conn().unchecked_transaction()?;
    kv_set_tx(
        &tx,
        TEAM_LAUNCH_REVIEW_NS,
        &format!("{}:{}", team_session_id, review_id),
        &review_val,
    )?;
    kv_set_tx(&tx, TEAM_LAUNCH_REVIEW_NS, review_id, &review_val)?;
    bump_team_revision_tx(&tx, team_session_id)?;
    tx.commit()?;

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
    let decision: TeamExecutionDecision = db
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
        if expected_revision == existing.revision
            || expected_revision == existing.revision.saturating_sub(1)
        {
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

    let mut created_member_session_ids = Vec::new();
    let confirmation = (|| -> Result<(TeamLaunchReview, TeamExecutionDecision)> {
        let tx = db.conn().unchecked_transaction()?;
        let current = get_launch_review(db, team_session_id, Some(review_id))?
            .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: launch review '{review_id}' not found"))?;
        if current.status != "pending" || current.revision != expected_revision {
            return Err(anyhow!(
                "TEAM_REVIEW_REVISION_CONFLICT: review changed before confirmation"
            ));
        }
        let decision_key = format!("{}:{}", team_session_id, current.lead_turn_id);
        let mut decision: TeamExecutionDecision = db
            .kv_get(TEAM_EXECUTION_DECISION_NS, &decision_key)?
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_else(|| TeamExecutionDecision {
                schema_version: TEAM_EXECUTION_DECISION_SCHEMA_VERSION,
                team_session_id: team_session_id.to_string(),
                lead_turn_id: current.lead_turn_id.clone(),
                strategy: Some("delegate".to_string()),
                reason: None,
                updated_at: now_iso(),
                task_ids: vec![],
                member_session_ids: vec![],
                message_ids: vec![],
                review_ids: Some(vec![review_id.to_string()]),
                coordination_error: None,
            });

        for member in &current.members {
            validate_member_route(
                db,
                &member.selection.provider_id,
                &member.selection.model_id,
                &member.selection.thinking_level,
            )?;
            let reused_member_session_id =
                if let Some(member_session_id) = member.member_session_id.as_deref() {
                    Some(member_session_id.to_string())
                } else {
                    get_team_member_by_name(db, team_session_id, &member.name)?
                        .map(|member| member.member_session_id)
                };
            if let Some(member_session_id) = reused_member_session_id {
                validate_reused_member_for_confirmation(
                    db,
                    team_session_id,
                    review_id,
                    &member.name,
                    &member_session_id,
                )?;
            }
        }

        let mut member_session_ids = Vec::new();
        let mut member_names = Vec::new();
        for member in &current.members {
            member_names.push(member.name.clone());
            let session_id = if let Some(member_session_id) = &member.member_session_id {
                member_session_id.clone()
            } else if let Some(existing_member) =
                get_team_member_by_name(db, team_session_id, &member.name)?
            {
                existing_member.member_session_id
            } else {
                let created = create_approved_team_member(
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
                created_member_session_ids.push(created.member_session_id.clone());
                created.member_session_id
            };
            sessions::configure_approved_team_member_selection(
                db,
                &session_id,
                &member.selection.provider_id,
                &member.selection.model_id,
                &member.selection.thinking_level,
            )?;
            if let Some(presentation) = &member.presentation {
                kv_set_tx(
                    &tx,
                    "team-member-presentation-v1",
                    &session_id,
                    &serde_json::to_value(presentation)?,
                )?;
            }
            member_session_ids.push(session_id);
        }

        let mut confirmed_review = current;
        confirmed_review.status = "confirmed".to_string();
        confirmed_review.revision += 1;
        decision.member_session_ids = member_session_ids;
        decision.updated_at = now_iso();
        let review_value = serde_json::to_value(&confirmed_review)?;
        kv_set_tx(
            &tx,
            TEAM_LAUNCH_REVIEW_NS,
            &format!("{}:{}", team_session_id, review_id),
            &review_value,
        )?;
        kv_set_tx(&tx, TEAM_LAUNCH_REVIEW_NS, review_id, &review_value)?;
        kv_set_tx(
            &tx,
            TEAM_EXECUTION_DECISION_NS,
            &decision_key,
            &serde_json::to_value(&decision)?,
        )?;

        let confirmation_content = format!(
            "Team review {} confirmed. Approved members: {}.",
            review_id,
            member_names.join(", ")
        );
        let confirmation_key = format!("team-review:{}:confirmed", review_id);
        let sender_session_id = decision
            .member_session_ids
            .first()
            .map(|session_id| session_id.as_str())
            .unwrap_or(team_session_id);
        let message = send_team_message(
            db,
            SendMessageParams {
                team_session_id,
                caller_session_id: sender_session_id,
                target_identifier: "Lead",
                content: &confirmation_content,
                idempotency_key: Some(&confirmation_key),
            },
        )?;

        if !decision.message_ids.contains(&message.id) {
            decision.message_ids.push(message.id);
        }
        decision.updated_at = now_iso();
        kv_set_tx(
            &tx,
            TEAM_EXECUTION_DECISION_NS,
            &decision_key,
            &serde_json::to_value(&decision)?,
        )?;
        bump_team_revision_tx(&tx, team_session_id)?;
        tx.commit()?;
        Ok((confirmed_review, decision))
    })();

    match confirmation {
        Ok(confirmed) => {
            for session_id in &created_member_session_ids {
                sessions::commit_team_fork_staging_marker(db, session_id);
            }
            Ok(confirmed)
        }
        Err(error) => {
            let mut cleanup_errors = Vec::new();
            for session_id in &created_member_session_ids {
                if let Err(cleanup_error) =
                    sessions::cleanup_uncommitted_team_session_files(db, session_id)
                {
                    cleanup_errors.push(format!("{session_id}: {cleanup_error}"));
                }
            }
            if !cleanup_errors.is_empty() {
                return Err(anyhow!(
                    "{error}; confirmation session-file cleanup failed: {}",
                    cleanup_errors.join("; ")
                ));
            }
            Err(error)
        }
    }
}

fn validate_presentation(
    presentation: super::model::TeamMemberPresentation,
) -> Result<super::model::TeamMemberPresentation> {
    const ROLES: [&str; 5] = [
        "researcher",
        "executor",
        "reviewer",
        "planner",
        "collaborator",
    ];
    let display_name = presentation.display_name.trim();
    if !ROLES.contains(&presentation.role.as_str())
        || display_name.is_empty()
        || display_name.chars().count() > 64
    {
        return Err(anyhow!("INVALID_PARAMS: invalid team member presentation"));
    }
    Ok(super::model::TeamMemberPresentation {
        role: presentation.role,
        display_name: display_name.to_string(),
    })
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
    let tx = db.conn().unchecked_transaction()?;
    kv_set_tx(
        &tx,
        TEAM_LAUNCH_REVIEW_NS,
        &format!("{}:{}", team_session_id, review_id),
        &review_val,
    )?;
    kv_set_tx(&tx, TEAM_LAUNCH_REVIEW_NS, review_id, &review_val)?;
    bump_team_revision_tx(&tx, team_session_id)?;
    tx.commit()?;

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
    let mut changed_teams = HashSet::new();
    for row in rows {
        let (key, val_json) = row?;
        let value: serde_json::Value = serde_json::from_str(&val_json)?;
        if !value.is_object() {
            continue;
        }
        let mut review: TeamLaunchReview = serde_json::from_value(value)?;
        if review.status == "pending" {
            review.status = "interrupted".to_string();
            review.revision += 1;
            changed_teams.insert(review.team_session_id.clone());
            updates.push((key, serde_json::to_value(&review)?));
        }
    }

    let tx = db.conn().unchecked_transaction()?;
    for (key, val) in updates {
        kv_set_tx(&tx, TEAM_LAUNCH_REVIEW_NS, &key, &val)?;
    }
    for team_session_id in changed_teams {
        bump_team_revision_tx(&tx, &team_session_id)?;
    }
    tx.commit()?;

    Ok(())
}
