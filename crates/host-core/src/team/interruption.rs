//! Explicit Lead interruption. No inactivity watchdog or capability elevation.
use crate::state::AppState;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

pub(crate) struct InterruptRequest {
    pub session_id: String,
    pub turn_id: String,
}

pub(crate) fn request(
    st: &AppState,
    team: &str,
    caller: &str,
    name: &str,
    force: bool,
    reason: Option<&str>,
) -> Result<Option<InterruptRequest>> {
    if caller != team {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: only the team lead can interrupt a member"
        ));
    }
    super::validate_team_lead(&st.db, team)?;
    let member = super::get_team_member_by_name(&st.db, team, name)?
        .ok_or_else(|| anyhow!("TEAM_TARGET_NOT_FOUND: Team member not found"))?;
    // Strategy authority is intentionally unchanged: this operation is a
    // stop-only safety action and never authorizes dispatch or substantive work.
    let reason = reason.map(str::trim).filter(|reason| !reason.is_empty());
    if force && reason.is_none() {
        return Err(anyhow!(
            "TEAM_INTERRUPT_REASON_REQUIRED: force requires a nonempty reason"
        ));
    }
    if reason.is_some_and(|reason| reason.chars().count() > 1000) {
        return Err(anyhow!(
            "INVALID_PARAMS: interrupt reason must not exceed 1000 characters"
        ));
    }
    let Some(turn) = crate::sessions::running_turn_id(&st.db, &member.member_session_id)? else {
        return Ok(None);
    };
    let evidence = super::member_activity::member(
        st,
        team,
        &member.member_session_id,
        name,
        crate::db::now_ms(),
    )?;
    let active = evidence
        .get("requiresForce")
        .and_then(Value::as_bool)
        .ok_or_else(|| anyhow!("invalid Host activity evidence"))?;
    if !force && active {
        return Err(anyhow!("TEAM_MEMBER_ACTIVE: Host activity or an active Bash process exists; inspect team_status and provide force:true with reason only when interruption is justified"));
    }
    crate::audit::append(
        &st.db,
        "team_member_interrupt",
        Some(caller),
        json!({
            "teamSessionId":team,"callerSessionId":caller,"memberSessionId":member.member_session_id,
            "memberName":name,"turnId":turn,"force":force,"reason":reason,"activity":evidence,
        }),
    )?;
    Ok(Some(InterruptRequest {
        session_id: member.member_session_id,
        turn_id: turn,
    }))
}
