use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use super::mailbox::team_plugin_origin;
use super::model::{TeamExecutionDecision, TeamLaunchReview};
use super::review::{get_launch_review, TEAM_EXECUTION_DECISION_NS, TEAM_LAUNCH_REVIEW_NS};
use super::roster::get_team_member_by_session_id;
use crate::db::Database;
use crate::sessions;

pub(super) fn require_approved_member(
    db: &Database,
    team_session_id: &str,
    member_session_id: &str,
) -> Result<()> {
    if member_session_id == team_session_id {
        return Ok(());
    }
    let mut stmt = db.conn().prepare_cached(
        "SELECT value_json FROM kv
         WHERE ns = ?1 AND key LIKE ?2 AND key != ?3 AND key NOT LIKE ?4",
    )?;
    let prefix = format!("{team_session_id}:%");
    let latest_key = format!("{team_session_id}:latest");
    let input_pattern = format!("{team_session_id}:%:input");
    let decisions = stmt.query_map(
        params![
            TEAM_EXECUTION_DECISION_NS,
            prefix,
            latest_key,
            input_pattern
        ],
        |row| row.get::<_, String>(0),
    )?;
    for raw in decisions {
        let decision: TeamExecutionDecision = serde_json::from_str(&raw?)?;
        if decision.team_session_id != team_session_id {
            continue;
        }
        let Some(review_ids) = decision.review_ids.as_deref() else {
            continue;
        };
        for review_id in review_ids {
            let Some(review) = get_launch_review(db, team_session_id, Some(review_id))? else {
                continue;
            };
            if review.status != "confirmed" {
                continue;
            }
            if review.launch_policy.as_deref() == Some("automatic_plan") {
                let Some(purpose) = super::planning::purpose(db, member_session_id)? else {
                    continue;
                };
                let Some(planning) = super::planning::get(db, team_session_id)? else {
                    continue;
                };
                if purpose.work_purpose != "plan_research"
                    || purpose.planning_id != planning.planning_id
                    || purpose.round_id != planning.round_id
                    || !planning
                        .approved_member_ids
                        .iter()
                        .any(|id| id == member_session_id)
                    || sessions::session_mode(db, member_session_id)?.as_deref() != Some("plan")
                {
                    continue;
                }
            } else if review.launch_policy.as_deref().unwrap_or("user_confirmed")
                != "user_confirmed"
            {
                continue;
            }
            for (index, member) in review.members.iter().enumerate() {
                if decision.member_session_ids.get(index).map(String::as_str)
                    != Some(member_session_id)
                {
                    continue;
                }
                let Some(session) = sessions::get_session(db, member_session_id)? else {
                    continue;
                };
                if session.summary.provider_id.as_deref()
                    == Some(member.selection.provider_id.as_str())
                    && session.summary.model_id.as_deref()
                        == Some(member.selection.model_id.as_str())
                    && session.summary.thinking_level == member.selection.thinking_level
                {
                    return Ok(());
                }
            }
        }
    }
    Err(anyhow!(
        "TEAM_APPROVAL_REQUIRED: member execution requires a confirmed launch review"
    ))
}

pub(super) fn is_live_team_mail_turn(
    db: &Database,
    team_session_id: &str,
    member_session_id: &str,
) -> Result<bool> {
    Ok(db.conn().query_row(
        "SELECT EXISTS(
            SELECT 1 FROM turns t
            JOIN session_collaboration_messages m ON m.turn_id = t.id
            WHERE t.session_id = ?1 AND t.status = 'running'
              AND m.plugin_id = ?2 AND m.kind = 'message'
              AND m.target_session_id = ?1 AND m.status = 'running'
         )",
        params![member_session_id, team_plugin_origin(team_session_id)],
        |row| row.get(0),
    )?)
}

pub(crate) fn gate_team_member_turn(
    db: &Database,
    session_id: &str,
    provider_id: Option<&str>,
    model_id: Option<&str>,
) -> Result<()> {
    let Some(member) = get_team_member_by_session_id(db, session_id)? else {
        return Ok(());
    };
    require_approved_member(db, &member.team_session_id, session_id)?;
    let session = sessions::get_session(db, session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: member session not found"))?;
    if provider_id.is_some_and(|provider| session.summary.provider_id.as_deref() != Some(provider))
        || model_id.is_some_and(|model| session.summary.model_id.as_deref() != Some(model))
    {
        return Err(anyhow!(
            "TEAM_APPROVAL_REQUIRED: turn route must match the confirmed member selection"
        ));
    }
    Ok(())
}

pub(super) fn has_pending_review_for_member(
    db: &Database,
    team_session_id: &str,
    member_name: &str,
) -> Result<bool> {
    has_conflicting_pending_review(db, team_session_id, member_name, None, None)
}

fn has_conflicting_pending_review(
    db: &Database,
    team_session_id: &str,
    member_name: &str,
    member_session_id: Option<&str>,
    except_review_id: Option<&str>,
) -> Result<bool> {
    let mut stmt = db
        .conn()
        .prepare_cached("SELECT value_json FROM kv WHERE ns = ?1")?;
    let rows = stmt.query_map(params![TEAM_LAUNCH_REVIEW_NS], |row| {
        row.get::<_, String>(0)
    })?;
    for row in rows {
        let value: Value = serde_json::from_str(&row?)?;
        if !value.is_object() {
            continue;
        }
        let review: TeamLaunchReview = serde_json::from_value(value)?;
        if review.team_session_id == team_session_id
            && review.status == "pending"
            && except_review_id != Some(review.review_id.as_str())
            && review.members.iter().any(|member| {
                member.name.eq_ignore_ascii_case(member_name)
                    || member_session_id.is_some_and(|session_id| {
                        member.member_session_id.as_deref() == Some(session_id)
                    })
            })
        {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(super) fn validate_reused_member_for_confirmation(
    db: &Database,
    team_session_id: &str,
    review_id: &str,
    member_name: &str,
    member_session_id: &str,
) -> Result<()> {
    let member = super::roster::get_team_member_by_session_id(db, member_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: selected member session not found"))?;
    if member.team_session_id != team_session_id || !member.name.eq_ignore_ascii_case(member_name) {
        return Err(anyhow!(
            "TEAM_MODEL_SELECTION_INVALID: selected member is not in the proposed team slot"
        ));
    }
    if matches!(member.phase.as_str(), "running" | "provisioning")
        || sessions::session_has_running_turn(db, member_session_id)?
    {
        return Err(anyhow!(
            "TEAM_MEMBER_MODEL_CHANGE_BLOCKED: selected member is not available"
        ));
    }

    let team_queued: bool = db.conn().query_row(
        "SELECT EXISTS(
            SELECT 1 FROM session_collaboration_messages
            WHERE plugin_id = ?1 AND kind = 'message'
              AND target_session_id = ?2 AND status = 'queued'
         )",
        params![team_plugin_origin(team_session_id), member_session_id],
        |row| row.get(0),
    )?;
    let queued_turns: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM turn_queue WHERE session_id = ?1)",
        params![member_session_id],
        |row| row.get(0),
    )?;
    if team_queued || queued_turns {
        return Err(anyhow!(
            "TEAM_MEMBER_MODEL_CHANGE_BLOCKED: selected member has queued work"
        ));
    }
    if has_conflicting_pending_review(
        db,
        team_session_id,
        member_name,
        Some(member_session_id),
        Some(review_id),
    )? {
        return Err(anyhow!(
            "TEAM_MEMBER_MODEL_CHANGE_BLOCKED: selected member has another pending launch review"
        ));
    }
    Ok(())
}

pub(crate) fn validate_member_route(
    db: &Database,
    provider_id: &str,
    model_id: &str,
    thinking_level: &str,
) -> Result<()> {
    sessions::validate_thinking_level(thinking_level).map_err(|error| {
        anyhow!("TEAM_MODEL_SELECTION_INVALID: invalid thinking level: {error}")
    })?;
    let provider = db
        .conn()
        .query_row(
            "SELECT enabled, default_model_id, config_json FROM providers WHERE id = ?1",
            params![provider_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? != 0,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((enabled, legacy_model_id, config_json)) = provider else {
        return Err(anyhow!(
            "TEAM_MODEL_SELECTION_INVALID: provider/model route is unavailable"
        ));
    };
    let models =
        crate::providers::config_model_bindings(&config_json, legacy_model_id, provider_id);
    let model = models.iter().find(|model| model.id == model_id);
    let catalog_model = db
        .conn()
        .query_row(
            "SELECT capabilities_json FROM models
             WHERE provider_id = ?1 AND model_id = ?2 AND deprecated = 0",
            params![provider_id, model_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if !enabled || (model.is_none() && catalog_model.is_none()) {
        return Err(anyhow!(
            "TEAM_MODEL_SELECTION_INVALID: provider/model route is unavailable"
        ));
    }
    let provider_levels = crate::providers::config_thinking_levels_override(&config_json);
    let model_levels = model
        .map(|model| model.thinking_levels.as_slice())
        .unwrap_or(&[]);
    let allowed_levels = provider_levels.as_deref().unwrap_or(model_levels);
    let reasoning_disabled =
        crate::providers::config_reasoning_override(&config_json) == Some(false);
    let thinking_supported = if thinking_level == "off" {
        true
    } else if reasoning_disabled {
        false
    } else if thinking_level == "omit" {
        allowed_levels.iter().any(|level| level != "off")
    } else {
        allowed_levels.iter().any(|level| level == thinking_level)
    };
    if !thinking_supported {
        return Err(anyhow!(
            "TEAM_MODEL_SELECTION_INVALID: thinking level is unsupported by the selected model"
        ));
    }
    Ok(())
}

pub(super) fn default_member_route(
    db: &Database,
    team_session_id: &str,
) -> Result<(String, String)> {
    let summary = sessions::get_session(db, team_session_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: lead session not found"))?
        .summary;
    let settings = db
        .get_setting("app")?
        .unwrap_or_else(|| serde_json::json!({}));
    let default_provider_id = settings.get("defaultProviderId").and_then(Value::as_str);
    let default_model_id = settings.get("defaultModelId").and_then(Value::as_str);
    let pinned_provider = if let Some(provider_id) = summary.provider_id.as_deref() {
        let enabled = db
            .conn()
            .query_row(
                "SELECT enabled FROM providers WHERE id = ?1",
                params![provider_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some_and(|enabled| enabled != 0);
        enabled.then_some(provider_id)
    } else {
        None
    };
    let provider_id = pinned_provider
        .or(default_provider_id)
        .ok_or_else(|| anyhow!("TEAM_MODEL_SELECTION_INVALID: Lead has no effective provider"))?;
    let (enabled, legacy_model_id, config_json): (bool, Option<String>, String) = db
        .conn()
        .query_row(
            "SELECT enabled, default_model_id, config_json FROM providers WHERE id = ?1",
            params![provider_id],
            |row| Ok((row.get::<_, i64>(0)? != 0, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| anyhow!("TEAM_MODEL_SELECTION_INVALID: Lead provider is unavailable"))?;
    if !enabled {
        return Err(anyhow!(
            "TEAM_MODEL_SELECTION_INVALID: Lead provider is unavailable"
        ));
    }
    let provider_models =
        crate::providers::config_model_bindings(&config_json, legacy_model_id, provider_id);
    let bound_model_id = (pinned_provider == Some(provider_id))
        .then(|| summary.model_id.clone())
        .flatten();
    let inherited_model_id = (default_provider_id == Some(provider_id))
        .then(|| default_model_id.map(str::to_string))
        .flatten();
    let model_id = bound_model_id
        .or(inherited_model_id)
        .or_else(|| provider_models.first().map(|model| model.id.clone()))
        .ok_or_else(|| anyhow!("TEAM_MODEL_SELECTION_INVALID: Lead has no effective model"))?;
    Ok((provider_id.to_string(), model_id))
}
