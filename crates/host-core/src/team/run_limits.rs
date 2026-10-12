//! Durable wall-clock budget for one Team lifetime. The Host owns the clock.
use crate::db::Database;
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const STATE_NS: &str = "team-run-limits-v1";
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunLimitSettings {
    pub enabled: bool,
    pub soft_ms: i64,
    pub hard_ms: i64,
}
impl Default for RunLimitSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            soft_ms: 6 * 60 * 60 * 1000,
            hard_ms: 10 * 60 * 60 * 1000,
        }
    }
}
impl RunLimitSettings {
    pub fn validate(&self) -> Result<()> {
        if self.soft_ms <= 0 || self.hard_ms <= self.soft_ms || self.hard_ms > 9_007_199_254_740_991
        {
            return Err(anyhow!("INVALID_PARAMS: Team limits require 0 < softMs < hardMs, safe integer milliseconds"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunLimitState {
    pub run_id: String,
    pub started_at: i64,
    pub elapsed_ms: i64,
    pub soft_message_id: Option<String>,
    pub hard_reached_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLimitProjection {
    #[serde(flatten)]
    pub state: RunLimitState,
    #[serde(flatten)]
    pub settings: RunLimitSettings,
}
#[derive(Debug)]
pub struct LimitEvent {
    pub team: String,
    pub kind: &'static str,
    pub message_id: Option<String>,
}

pub fn state(db: &Database, team: &str) -> Result<Option<RunLimitState>> {
    db.kv_get(STATE_NS, team)?
        .map(serde_json::from_value)
        .transpose()
        .map_err(Into::into)
}
pub fn settings(db: &Database) -> Result<RunLimitSettings> {
    let policy: RunLimitSettings = db
        .get_setting("app")?
        .and_then(|app| {
            app.get("expertTeam")
                .and_then(|team| team.get("runLimits"))
                .cloned()
        })
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    policy.validate()?;
    Ok(policy)
}
/// Each trusted non-mail Lead user turn is the existing Team authority scope.
/// Mail continuations and restart retain this run identity and clock.
pub(crate) fn start_user_run(db: &Database, team: &str, turn: &str, now: i64) -> Result<()> {
    if state(db, team)?.is_some_and(|state| state.hard_reached_at.is_some()) {
        return Err(anyhow!(
            "TEAM_RUN_LIMIT_REACHED: extend or disable the Team run limit in Settings, then resume"
        ));
    }
    if super::get_team(db, team)?.is_some_and(|team| team.paused) {
        return Ok(());
    }
    db.kv_set(
        STATE_NS,
        team,
        &serde_json::to_value(RunLimitState {
            run_id: turn.into(),
            started_at: now,
            elapsed_ms: 0,
            soft_message_id: None,
            hard_reached_at: None,
        })?,
    )?;
    crate::background_services::request_team(db, team, "run_replaced", now)?;
    Ok(())
}
pub fn projection(db: &Database, team: &str, now: i64) -> Result<Option<RunLimitProjection>> {
    let Some(mut state) = state(db, team)? else {
        return Ok(None);
    };
    state.elapsed_ms = state
        .elapsed_ms
        .max(now.saturating_sub(state.started_at).max(0));
    Ok(Some(RunLimitProjection {
        state,
        settings: settings(db)?,
    }))
}
/// Called inside the turn-start savepoint, so a failed start cannot consume a budget.
pub(crate) fn start_conn(conn: &Connection, session: &str, now: i64) -> Result<()> {
    let team: Option<String> = conn
        .query_row(
            "SELECT team_session_id FROM teams WHERE team_session_id=?1 UNION ALL
         SELECT team_session_id FROM team_members WHERE member_session_id=?1 LIMIT 1",
            [session],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(team) = team {
        conn.execute(
            "INSERT INTO kv(ns,key,value_json,updated_at) VALUES(?1,?2,?3,?4)
            ON CONFLICT(ns,key) DO NOTHING",
            params![
                STATE_NS,
                team,
                serde_json::to_string(&RunLimitState {
                    run_id: "legacy".into(),
                    started_at: now,
                    elapsed_ms: 0,
                    soft_message_id: None,
                    hard_reached_at: None
                })?,
                now
            ],
        )?;
        let hard_paused: bool = conn.query_row("SELECT paused AND EXISTS(SELECT 1 FROM kv WHERE ns=?2 AND key=?1 AND json_extract(value_json,'$.hardReachedAt') IS NOT NULL) FROM teams WHERE team_session_id=?1", params![team, STATE_NS], |r|r.get(0))?;
        if hard_paused {
            return Err(anyhow!("TEAM_RUN_LIMIT_REACHED: extend or disable the Team run limit in Settings, then resume"));
        }
    }
    Ok(())
}
/// A changed policy permits explicit resume; it never resets elapsed time or unpauses automatically.
pub fn authorize_resume(db: &Database, team: &str, now: i64) -> Result<()> {
    if let Some(mut budget) = state(db, team)? {
        let policy = settings(db)?;
        budget.elapsed_ms = budget
            .elapsed_ms
            .max(now.saturating_sub(budget.started_at).max(0));
        if policy.enabled && budget.elapsed_ms >= policy.hard_ms {
            return Err(anyhow!("TEAM_RUN_LIMIT_REACHED: extend or disable the Team run limit in Settings, then resume"));
        }
        budget.hard_reached_at = None;
        db.kv_set(STATE_NS, team, &serde_json::to_value(budget)?)?;
    }
    Ok(())
}
/// Isolated clock seam; callers serialize the database with the Host state lock.
pub fn evaluate_at(db: &Database, team: &str, now: i64) -> Result<Vec<LimitEvent>> {
    let Some(mut budget) = state(db, team)? else {
        return Ok(vec![]);
    };
    let Some(roster) = super::get_team(db, team)? else {
        return Ok(vec![]);
    };
    let policy = settings(db)?;
    budget.elapsed_ms = budget
        .elapsed_ms
        .max(now.saturating_sub(budget.started_at).max(0));
    let tx = db.conn().unchecked_transaction()?;
    let mut events = vec![];
    let active: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM turns t WHERE status='running' AND
        (t.session_id=?1 OR t.session_id IN (SELECT member_session_id FROM team_members WHERE team_session_id=?1)))
        OR EXISTS(SELECT 1 FROM session_collaboration_messages WHERE plugin_id=?2 AND kind='message' AND status='queued')
        OR EXISTS(SELECT 1 FROM turn_queue WHERE session_id=?1 OR session_id IN (SELECT member_session_id FROM team_members WHERE team_session_id=?1))",
        params![team,super::team_plugin_origin(team)], |r|r.get(0))?;
    if !active || (roster.paused && budget.hard_reached_at.is_some()) {
        return Ok(vec![]);
    }
    if policy.enabled && budget.hard_reached_at.is_none() && budget.elapsed_ms >= policy.hard_ms {
        budget.hard_reached_at = Some(now);
        // Foreground/ordinary Bash keeps safe finishing; explicit services stop.
        super::pause_team(db, team)?;
        events.push(LimitEvent {
            team: team.into(),
            kind: "hard",
            message_id: None,
        });
    } else if policy.enabled
        && !roster.paused
        && budget.elapsed_ms >= policy.soft_ms
        && budget.soft_message_id.is_none()
    {
        let id = uuid::Uuid::new_v4().to_string();
        let content = "Host Team run limit: the soft wall-clock limit has been reached. Stop expanding scope, collect expert results, and conclude with verified work and remaining gaps. The hard limit pauses this Team, stops explicitly managed services, and preserves ordinary background commands and admitted foreground tools.";
        let ceiling = crate::session_collaboration::permissions::effective_mode(db, team)?;
        tx.execute("INSERT INTO session_collaboration_messages(id,plugin_id,source_session_id,source_title,target_session_id,target_title,kind,content,status,notify_on_completion,idempotency_key,remaining_hops,permission_ceiling,created_at,updated_at)
          VALUES(?1,?2,?3,'Host run limit',?3,'Lead','message',?4,'queued',0,?5,1,?6,?7,?7)", params![id, super::team_plugin_origin(team), team, content, format!("team-run-limit-soft:{}", budget.run_id), ceiling,now])?;
        budget.soft_message_id = Some(id.clone());
        super::lifecycle::bump_team_revision_conn(&tx, team)?;
        events.push(LimitEvent {
            team: team.into(),
            kind: "soft",
            message_id: Some(id),
        });
    }
    tx.execute("INSERT INTO kv(ns,key,value_json,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(ns,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", params![STATE_NS, team,serde_json::to_string(&budget)?,now])?;
    tx.commit()?;
    Ok(events)
}
pub fn is_soft_notice(db: &Database, team: &str, id: &str) -> Result<bool> {
    Ok(state(db, team)?.is_some_and(|state| state.soft_message_id.as_deref() == Some(id)))
}
pub fn teams(db: &Database) -> Result<Vec<String>> {
    let mut statement = db.conn().prepare_cached(
        "SELECT t.team_session_id FROM teams t JOIN kv k ON k.ns=?1 AND k.key=t.team_session_id",
    )?;
    let rows = statement.query_map([STATE_NS], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}
