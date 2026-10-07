//! Host-owned planning rounds. Researchers remain read-only until an execution
//! review explicitly reassigns their purpose; resolving a plan never elevates them.
use super::{board::get_team_task, roster::validate_team_participant};
use crate::{
    db::{now_ms, Database},
    sessions,
};
use anyhow::{anyhow, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const NS: &str = "team-planning-v1";
const PURPOSE_NS: &str = "team-member-purpose-v1";
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StructuredResearchResult {
    pub summary: String,
    #[serde(default)]
    pub findings: Vec<String>,
    #[serde(default)]
    pub risks: Vec<String>,
    #[serde(default)]
    pub recommendations: Vec<String>,
    #[serde(default)]
    pub verified_sources: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchResult {
    pub task_id: String,
    pub member_session_id: String,
    pub member_name: String,
    pub task_revision: i64,
    pub structured_result: StructuredResearchResult,
    pub submitted_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningState {
    pub schema_version: u32,
    pub planning_id: String,
    pub team_session_id: String,
    pub round_id: String,
    pub phase: String,
    pub strategy: String,
    pub review_id: Option<String>,
    pub approved_member_ids: Vec<String>,
    pub expected_task_ids: Vec<String>,
    pub results: BTreeMap<String, ResearchResult>,
    pub open_questions: Vec<String>,
    pub proposal_id: Option<String>,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberPurpose {
    pub work_purpose: String,
    pub planning_id: String,
    pub round_id: String,
}
fn save(db: &Database, state: &PlanningState) -> Result<()> {
    db.kv_set(NS, &state.team_session_id, &serde_json::to_value(state)?)?;
    db.conn().execute(
        "UPDATE teams SET revision=revision+1, updated_at=?2 WHERE team_session_id=?1",
        params![state.team_session_id, now_ms()],
    )?;
    Ok(())
}
pub fn get(db: &Database, team: &str) -> Result<Option<PlanningState>> {
    db.kv_get(NS, team)?
        .map(serde_json::from_value)
        .transpose()
        .map_err(Into::into)
}
pub fn purpose(db: &Database, member: &str) -> Result<Option<MemberPurpose>> {
    db.kv_get(PURPOSE_NS, member)?
        .map(serde_json::from_value)
        .transpose()
        .map_err(Into::into)
}
/// Called inside strategy/review transaction, never exposed as arbitrary RPC.
pub fn start(
    db: &Database,
    team: &str,
    strategy: &str,
    review: Option<&str>,
    members: Vec<String>,
) -> Result<()> {
    if sessions::session_mode(db, team)?.as_deref() != Some("plan") {
        for member in members {
            db.conn().execute(
                "UPDATE sessions SET mode='agent',updated_at=?2 WHERE id=?1",
                params![member, now_ms()],
            )?;
            db.kv_set(
                PURPOSE_NS,
                &member,
                &serde_json::json!({"workPurpose":"execute","planningId":"","roundId":""}),
            )?;
        }
        return Ok(());
    }
    let state = PlanningState {
        schema_version: 1,
        planning_id: uuid::Uuid::new_v4().to_string(),
        team_session_id: team.into(),
        round_id: uuid::Uuid::new_v4().to_string(),
        phase: if strategy == "lead_only" {
            "aggregating"
        } else {
            "researching"
        }
        .into(),
        strategy: strategy.into(),
        review_id: review.map(Into::into),
        approved_member_ids: members,
        expected_task_ids: vec![],
        results: BTreeMap::new(),
        open_questions: vec![],
        proposal_id: None,
        updated_at: now_ms().to_string(),
    };
    for member in &state.approved_member_ids {
        db.conn().execute(
            "UPDATE sessions SET mode='plan',updated_at=?2 WHERE id=?1",
            params![member, now_ms()],
        )?;
        db.kv_set(
            PURPOSE_NS,
            member,
            &serde_json::to_value(MemberPurpose {
                work_purpose: "plan_research".into(),
                planning_id: state.planning_id.clone(),
                round_id: state.round_id.clone(),
            })?,
        )?;
    }
    save(db, &state)
}
fn ready(state: &PlanningState) -> bool {
    state.open_questions.is_empty()
        && (state.strategy == "lead_only"
            || (!state.expected_task_ids.is_empty()
                && state
                    .expected_task_ids
                    .iter()
                    .all(|id| state.results.contains_key(id))))
}
fn researchers_settled(db: &Database, state: &PlanningState) -> Result<bool> {
    for member in &state.approved_member_ids {
        let running: bool = db.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM turns WHERE session_id=?1 AND status='running')",
            [member],
            |row| row.get(0),
        )?;
        if running {
            return Ok(false);
        }
    }
    Ok(true)
}
fn refresh(state: &mut PlanningState) {
    state.phase = if !state.open_questions.is_empty() {
        "clarifying"
    } else if ready(state) {
        "aggregating"
    } else {
        "researching"
    }
    .into();
    state.updated_at = now_ms().to_string();
}
/// Enrol before any result can arrive, in the same task transaction.
pub fn enrol(
    db: &Database,
    team: &str,
    task: &str,
    owner: Option<&str>,
    deleted: bool,
    status: &str,
) -> Result<()> {
    let Some(mut state) = get(db, team)? else {
        return Ok(());
    };
    if sessions::session_mode(db, team)?.as_deref() != Some("plan") {
        return Ok(());
    }
    if !matches!(
        state.phase.as_str(),
        "researching" | "aggregating" | "clarifying"
    ) {
        return Err(anyhow!("TEAM_PLANNING_CLOSED: round cannot change tasks"));
    }
    if state.expected_task_ids.iter().any(|id| id == task)
        && (deleted || !owner.is_some_and(|id| state.approved_member_ids.iter().any(|m| m == id)))
    {
        return Err(anyhow!(
            "TEAM_RESEARCH_INVALID: expected research task cannot be deleted or unassigned"
        ));
    }
    if let Some(owner) = owner {
        if owner != team {
            if !state.approved_member_ids.iter().any(|id| id == owner) {
                return Err(anyhow!(
                    "TEAM_APPROVAL_REQUIRED: researcher must belong to current review"
                ));
            }
            if status == "completed" {
                return Err(anyhow!(
                    "TEAM_RESEARCH_INVALID: complete research with submit_research_result"
                ));
            }
            if !state.expected_task_ids.iter().any(|id| id == task) {
                state.expected_task_ids.push(task.into());
            }
            // Editing an enrolled task invalidates its previous findings.
            state.results.remove(task);
            refresh(&mut state);
            save(db, &state)?;
        }
    }
    Ok(())
}
pub fn validate_tool(db: &Database, session: &str, tool: &str) -> Result<()> {
    super::authority::validate_lead_tool(db, session, tool)?;
    if purpose(db, session)?.is_some_and(|p| p.work_purpose == "plan_research")
        && !matches!(tool, "Read" | "Glob" | "Grep")
    {
        return Err(anyhow!(
            "TEAM_RESEARCH_READ_ONLY: research members can only inspect files"
        ));
    }
    Ok(())
}
/// Only an actual Lead mailbox turn consumes semantic Team input. A queue
/// receipt or acknowledgement does not make queued content available to Lead.
pub fn pending_messages_count(db: &Database, team: &str) -> Result<i64> {
    Ok(db.conn().query_row(
        "SELECT COUNT(*) FROM session_collaboration_messages
         WHERE plugin_id=?1 AND target_session_id=?2 AND kind='message'
           AND status='queued' AND turn_id IS NULL",
        params![super::mailbox::team_plugin_origin(team), team],
        |row| row.get(0),
    )?)
}
pub fn projection(db: &Database, team: &str, caller: &str) -> Result<serde_json::Value> {
    validate_team_participant(db, team, caller)?;
    Ok(match get(db, team)? {
        None => serde_json::Value::Null,
        Some(s) => {
            let pending = pending_messages_count(db, team)?;
            serde_json::json!({"planningId":s.planning_id,"teamSessionId":s.team_session_id,"roundId":s.round_id,"phase":s.phase,"workPurpose":"plan_research","reviewId":s.review_id,"totalExpectedTasks":s.expected_task_ids.len(),"completedResearchTasks":s.results.len(),"openQuestionsCount":s.open_questions.len(),"pendingMessagesCount":pending,"isReadyForPlanSubmission":ready(&s)&&s.phase=="aggregating"&&researchers_settled(db,&s)?&&pending==0,"proposalId":s.proposal_id,"results":s.results.values().collect::<Vec<_>>(),"updatedAt":s.updated_at})
        }
    })
}
pub struct SubmitResearch<'a> {
    pub team: &'a str,
    pub caller: &'a str,
    pub planning_id: &'a str,
    pub round_id: &'a str,
    pub task_id: &'a str,
    pub expected_revision: i64,
    pub result: StructuredResearchResult,
}
pub fn submit(db: &Database, p: SubmitResearch<'_>) -> Result<ResearchResult> {
    let name = validate_team_participant(db, p.team, p.caller)?;
    let mut state =
        get(db, p.team)?.ok_or_else(|| anyhow!("TEAM_PLANNING_NOT_READY: no active round"))?;
    if state.planning_id != p.planning_id || state.round_id != p.round_id {
        return Err(anyhow!("TEAM_PLANNING_STALE: research round changed"));
    }
    if !state.approved_member_ids.iter().any(|id| id == p.caller)
        || !purpose(db, p.caller)?
            .is_some_and(|v| v.work_purpose == "plan_research" && v.round_id == p.round_id)
    {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: caller is not an approved researcher"
        ));
    }
    let task = get_team_task(db, p.team, p.task_id)?
        .ok_or_else(|| anyhow!("TEAM_TASK_NOT_FOUND: research task not found"))?;
    if task.deleted
        || task.owner_session_id.as_deref() != Some(p.caller)
        || !state.expected_task_ids.iter().any(|id| id == p.task_id)
    {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: task is not assigned to researcher"
        ));
    }
    if p.result.summary.trim().is_empty()
        || p.result.summary.len() > 4000
        || [
            &p.result.findings,
            &p.result.risks,
            &p.result.recommendations,
            &p.result.verified_sources,
        ]
        .iter()
        .any(|v| v.len() > 32 || v.iter().any(|s| s.len() > 2000))
        || serde_json::to_vec(&p.result)?.len() > 32768
    {
        return Err(anyhow!(
            "TEAM_RESEARCH_INVALID: result exceeds bounded structured payload"
        ));
    }
    if let Some(existing) = state.results.get(p.task_id) {
        if existing.member_session_id == p.caller
            && existing.task_revision == p.expected_revision
            && existing.structured_result == p.result
        {
            return Ok(existing.clone());
        }
        return Err(anyhow!(
            "TEAM_TASK_REVISION_CONFLICT: result already submitted"
        ));
    }
    if !matches!(
        state.phase.as_str(),
        "researching" | "clarifying" | "aggregating"
    ) {
        return Err(anyhow!("TEAM_PLANNING_CLOSED: round already submitted"));
    }
    if task.revision != p.expected_revision {
        return Err(anyhow!("TEAM_TASK_REVISION_CONFLICT: task changed"));
    }
    if !matches!(task.status.as_str(), "pending" | "in_progress") {
        return Err(anyhow!("TEAM_RESEARCH_INVALID: task is not active"));
    }
    for dependency in &task.blocked_by {
        if !get_team_task(db, p.team, dependency)?
            .is_some_and(|t| !t.deleted && t.status == "completed")
        {
            return Err(anyhow!(
                "TEAM_RESEARCH_INVALID: task dependency is not completed"
            ));
        }
    }
    let result = ResearchResult {
        task_id: p.task_id.into(),
        member_session_id: p.caller.into(),
        member_name: name,
        task_revision: p.expected_revision,
        structured_result: p.result,
        submitted_at: now_ms().to_string(),
    };
    if serde_json::to_vec(&state.results)?.len() + serde_json::to_vec(&result)?.len() > 131072 {
        return Err(anyhow!(
            "TEAM_RESEARCH_INVALID: round research exceeds 128 KiB"
        ));
    }
    state.results.insert(p.task_id.into(), result.clone());
    refresh(&mut state);
    sessions::with_savepoint(db.conn(), "team_research_result", |conn| {
        let changed=conn.execute("UPDATE team_tasks SET status='completed',revision=revision+1,updated_at=?4 WHERE team_session_id=?1 AND task_id=?2 AND revision=?3",params![p.team,p.task_id,p.expected_revision,now_ms()])?;
        if changed != 1 {
            return Err(anyhow!("TEAM_TASK_REVISION_CONFLICT: task changed"));
        }
        save(db, &state)
    })?;
    Ok(result)
}
pub fn question(
    db: &Database,
    team: &str,
    caller: &str,
    round: &str,
    id: &str,
    open: bool,
) -> Result<()> {
    if caller != team {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: only Lead can ask planning questions"
        ));
    }
    validate_team_participant(db, team, caller)?;
    let Some(mut state) = get(db, team)? else {
        return Err(anyhow!("TEAM_PLANNING_NOT_READY: no round"));
    };
    if state.round_id != round {
        return Err(anyhow!("TEAM_PLANNING_STALE: round changed"));
    }
    if id.is_empty() || id.len() > 256 {
        return Err(anyhow!("INVALID_PARAMS: bounded questionId required"));
    }
    if !matches!(
        state.phase.as_str(),
        "researching" | "clarifying" | "aggregating"
    ) {
        return Err(anyhow!(
            "TEAM_PLANNING_CLOSED: round cannot accept questions"
        ));
    }
    if open {
        if state.open_questions.len() >= 32 {
            return Err(anyhow!("TEAM_RESEARCH_INVALID: too many questions"));
        }
        if !state.open_questions.iter().any(|q| q == id) {
            state.open_questions.push(id.into())
        }
    } else {
        state.open_questions.retain(|q| q != id)
    }
    refresh(&mut state);
    save(db, &state)
}
#[allow(dead_code)] // Strict guard retained for callers without a yield contract.
pub fn validate_submission(db: &Database, team: &str) -> Result<()> {
    if submission_pending_messages(db, team)? != 0 {
        return Err(anyhow!(
            "TEAM_PLANNING_NOT_READY: queued Team input remains"
        ));
    }
    Ok(())
}
/// Validate all existing submission invariants before permitting normal inbox
/// deferral. Callers must hold the submission transaction through publication.
pub fn submission_pending_messages(db: &Database, team: &str) -> Result<i64> {
    if sessions::session_execution_profile(db, team)?.as_deref() != Some("team")
        || sessions::session_mode(db, team)?.as_deref() != Some("plan")
    {
        return Ok(0);
    }
    super::authority::validate_lead_tool(db, team, "SubmitPlan")?;
    let state = get(db, team)?
        .ok_or_else(|| anyhow!("TEAM_PLANNING_NOT_READY: declare planning strategy first"))?;
    if state.phase != "aggregating" || !ready(&state) || !researchers_settled(db, &state)? {
        return Err(anyhow!(
            "TEAM_PLANNING_NOT_READY: expected research or questions remain"
        ));
    }
    pending_messages_count(db, team)
}
pub fn submitted(db: &Database, team: &str, proposal: &str) -> Result<()> {
    if let Some(mut state) = get(db, team)? {
        state.phase = "submitted".into();
        state.proposal_id = Some(proposal.into());
        state.updated_at = now_ms().to_string();
        save(db, &state)?
    }
    Ok(())
}
pub fn resolved(db: &Database, team: &str, proposal: &str, action: &str) -> Result<()> {
    if let Some(mut state) = get(db, team)? {
        if state.proposal_id.as_deref() == Some(proposal) {
            state.proposal_id = None;
            state.open_questions.clear();
            if matches!(action, "approve" | "schedule") {
                state.phase = "closed".into()
            } else {
                refresh(&mut state)
            }
            save(db, &state)?
        }
    }
    Ok(())
}

/// Cancelled UI waits must not become permanent submission blockers after a
/// stop/restart. Durable research remains available for a subsequent Lead turn.
pub fn cancel_questions(db: &Database, team: &str) -> Result<()> {
    if let Some(mut state) = get(db, team)? {
        if !state.open_questions.is_empty() {
            state.open_questions.clear();
            refresh(&mut state);
            save(db, &state)?;
        }
    }
    Ok(())
}
pub fn recover(db: &Database) -> Result<()> {
    let mut stmt = db.conn().prepare("SELECT key FROM kv WHERE ns=?1")?;
    let teams = stmt
        .query_map([NS], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for team in teams {
        if let Some(state) = get(db, &team)? {
            if let Some(proposal_id) = state.proposal_id {
                if let Some(proposal) = crate::plans::get_proposal(db, &proposal_id)? {
                    if matches!(
                        proposal.status.as_str(),
                        "interrupted" | "expired" | "rejected" | "changes_requested"
                    ) {
                        resolved(db, &team, &proposal_id, "recover")?;
                    }
                }
            }
        }
        cancel_questions(db, &team)?;
    }
    Ok(())
}
