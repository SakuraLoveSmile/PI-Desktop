//! One successor per approved failed slot; reviews and member identities remain immutable.
use super::{CreateMemberParams, TeamMember, TeamMemberSelection};
use crate::{db::Database, sessions};
use anyhow::{anyhow, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};

pub const NS: &str = "team-member-replacement-v1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Replacement {
    team_session_id: String,
    scope_turn_id: String,
    review_id: String,
    original_session_id: String,
    replacement_session_id: String,
    selection: TeamMemberSelection,
    permission_mode: String,
}

fn slot_key(team: &str, original: &str) -> String {
    format!("{team}:{original}")
}

pub fn replaced(db: &Database, team: &str, member: &str) -> Result<bool> {
    Ok(db.kv_get(NS, &slot_key(team, member))?.is_some())
}

fn link_for_member(db: &Database, member: &str) -> Result<Option<Replacement>> {
    Ok(db
        .kv_get(NS, &format!("successor:{member}"))?
        .map(serde_json::from_value)
        .transpose()?)
}

/// Additive authority is derived from a Host link, never a model-provided role.
pub(super) fn require_approved(db: &Database, team: &str, member: &str) -> Result<bool> {
    let Some(link) = link_for_member(db, member)? else {
        return Ok(false);
    };
    if link.team_session_id != team || link.replacement_session_id != member {
        return Ok(false);
    }
    let Some(review) = super::get_launch_review(db, team, Some(&link.review_id))? else {
        return Ok(false);
    };
    let Some(decision) = super::get_execution_decision(db, team, &link.scope_turn_id)? else {
        return Ok(false);
    };
    let Some(index) = decision
        .member_session_ids
        .iter()
        .position(|id| id == &link.original_session_id)
    else {
        return Ok(false);
    };
    if review.status != "confirmed"
        || review.launch_policy.as_deref().unwrap_or("user_confirmed") != "user_confirmed"
        || review.lead_turn_id != link.scope_turn_id
        || review
            .members
            .get(index)
            .is_none_or(|m| m.selection != link.selection)
        || !decision.member_session_ids.iter().any(|id| id == member)
    {
        return Ok(false);
    }
    let Some(session) = sessions::get_session(db, member)? else {
        return Ok(false);
    };
    if session.summary.provider_id.as_deref() != Some(&link.selection.provider_id)
        || session.summary.model_id.as_deref() != Some(&link.selection.model_id)
        || session.summary.thinking_level != link.selection.thinking_level
        || session.summary.permission_mode != link.permission_mode
    {
        return Err(anyhow!("TEAM_APPROVAL_REQUIRED: replacement route or permission changed; nextStep: request trusted roster review"));
    }
    Ok(true)
}

pub fn create(db: &Database, params: CreateMemberParams<'_>, replaces: &str) -> Result<TeamMember> {
    if params.caller_session_id != params.team_session_id {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: only the Lead may replace experts; nextStep: contact the Lead"
        ));
    }
    let mut decision = super::authority::current_confirmed_decision(db, params.team_session_id)?;
    let original=super::get_team_member_by_name(db,params.team_session_id,replaces)?.ok_or_else(||anyhow!("TEAM_APPROVAL_REQUIRED: replacement source is not in this roster; nextStep: declare_team_strategy for trusted review"))?;
    let Some(index) = decision
        .member_session_ids
        .iter()
        .position(|id| id == &original.member_session_id)
    else {
        return Err(anyhow!("TEAM_APPROVAL_REQUIRED: failed slot is outside this approved scope; nextStep: declare_team_strategy for trusted review"));
    };
    if let Some(raw) = db.kv_get(
        NS,
        &slot_key(params.team_session_id, &original.member_session_id),
    )? {
        let link: Replacement = serde_json::from_value(raw)?;
        let existing = super::get_team_member_by_session_id(db, &link.replacement_session_id)?;
        if link.scope_turn_id == decision.lead_turn_id
            && existing.as_ref().is_some_and(|m| m.name == params.name)
            && params.provider_id.is_none()
            && params.model_id.is_none()
            && params.context_kind.is_none_or(|v| v == "fresh")
        {
            return existing.ok_or_else(|| anyhow!("TEAM_NOT_FOUND: successor missing"));
        }
        return Err(anyhow!("TEAM_REPLACEMENT_ALREADY_USED: this approved slot already has one successor; nextStep: declare_team_strategy for trusted review"));
    }
    if link_for_member(db, &original.member_session_id)?.is_some() {
        return Err(anyhow!("TEAM_REPLACEMENT_ALREADY_USED: successor cannot replace itself recursively; nextStep: declare_team_strategy for trusted review"));
    }
    if original.phase != "failed"
        || sessions::session_has_running_turn(db, &original.member_session_id)?
    {
        return Err(anyhow!("TEAM_REPLACEMENT_NOT_FAILED: source expert is not an idle failed member; nextStep: inspect team_status and wait for healthy work"));
    }
    let queued:bool=db.conn().query_row("SELECT EXISTS(SELECT 1 FROM turn_queue WHERE session_id=?1 UNION ALL SELECT 1 FROM session_collaboration_messages WHERE target_session_id=?1 AND status IN ('queued','running'))",[&original.member_session_id],|r|r.get(0))?;
    if queued {
        return Err(anyhow!("TEAM_MEMBER_MODEL_CHANGE_BLOCKED: source has queued work; nextStep: cancel or settle that work before replacing the failed expert"));
    }
    if params.provider_id.is_some()
        || params.model_id.is_some()
        || params.context_kind.is_some_and(|v| v != "fresh")
        || params.description.is_some()
    {
        return Err(anyhow!("TEAM_APPROVAL_REQUIRED: replacement inherits the approved route and role; nextStep: omit route/context/description overrides or request trusted review"));
    }
    let review_id = decision
        .review_ids
        .as_ref()
        .and_then(|v| v.last())
        .ok_or_else(|| {
            anyhow!("TEAM_APPROVAL_REQUIRED: no confirmed review; nextStep: declare_team_strategy")
        })?
        .clone();
    let review = super::get_launch_review(db, params.team_session_id, Some(&review_id))?
        .ok_or_else(|| {
            anyhow!("TEAM_APPROVAL_REQUIRED: review missing; nextStep: declare_team_strategy")
        })?;
    if review.launch_policy.as_deref().unwrap_or("user_confirmed") != "user_confirmed" {
        return Err(anyhow!("TEAM_APPROVAL_REQUIRED: automatic research roster is not execution consent; nextStep: request trusted execution review"));
    }
    let slot = review.members.get(index).ok_or_else(|| {
        anyhow!("TEAM_APPROVAL_REQUIRED: original slot missing; nextStep: request trusted review")
    })?;
    let source = sessions::get_session(db, &original.member_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: failed session missing"))?;
    super::review_selection::validate_member_route(
        db,
        &slot.selection.provider_id,
        &slot.selection.model_id,
        &slot.selection.thinking_level,
    )?;
    let mut created_id = None;
    let result = sessions::with_savepoint(db.conn(), "team_replacement", |_| {
        let member=super::roster::create_approved_team_member(db,CreateMemberParams {
            team_session_id:params.team_session_id,caller_session_id:params.caller_session_id,name:params.name,
            description:slot.description.as_deref(),context_kind:Some("fresh"),provider_id:Some(&slot.selection.provider_id),model_id:Some(&slot.selection.model_id),
        },None).map_err(|e| {
            if e.to_string().starts_with("TEAM_MEMBER_LIMIT_EXCEEDED") {anyhow!("{e}; failed members remain counted; nextStep: request a new trusted roster instead of deleting history")}
            else {e}
        })?;
        created_id = Some(member.member_session_id.clone());
        sessions::configure_approved_team_member_selection(
            db,
            &member.member_session_id,
            &slot.selection.provider_id,
            &slot.selection.model_id,
            &slot.selection.thinking_level,
        )?;
        db.conn().execute(
            "UPDATE sessions SET permission_mode=?2 WHERE id=?1",
            params![member.member_session_id, source.summary.permission_mode],
        )?;
        for ns in [
            super::expert_config::MEMBER_CONFIG_NS,
            "team-member-presentation-v1",
        ] {
            if let Some(value) = db.kv_get(ns, &original.member_session_id)? {
                db.kv_set(ns, &member.member_session_id, &value)?;
            }
        }
        let link = Replacement {
            team_session_id: params.team_session_id.into(),
            scope_turn_id: decision.lead_turn_id.clone(),
            review_id,
            original_session_id: original.member_session_id.clone(),
            replacement_session_id: member.member_session_id.clone(),
            selection: slot.selection.clone(),
            permission_mode: source.summary.permission_mode.clone(),
        };
        let value = serde_json::to_value(&link)?;
        db.kv_set(
            NS,
            &slot_key(params.team_session_id, &original.member_session_id),
            &value,
        )?;
        db.kv_set(
            NS,
            &format!("successor:{}", member.member_session_id),
            &value,
        )?;
        decision
            .member_session_ids
            .push(member.member_session_id.clone());
        db.kv_set(
            super::TEAM_EXECUTION_DECISION_NS,
            &format!("{}:{}", params.team_session_id, decision.lead_turn_id),
            &serde_json::to_value(&decision)?,
        )?;
        Ok(member)
    });
    if result.is_err() {
        if let Some(id) = created_id {
            sessions::cleanup_uncommitted_team_session_files(db, &id)?;
        }
    }
    result
}
