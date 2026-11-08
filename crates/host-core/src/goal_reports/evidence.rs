use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, path::Path};

use super::tool_index::{Lookup, RecordedOutcome, ToolCall, ToolRunIndex, TranscriptUnreadable};

mod command_match;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoalReportEvidenceResolution {
    pub evidence_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoalReportCheckObservation {
    pub check_id: String,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    pub evidence_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Resolves referenced evidences to durable session records up to durable_seq.
pub fn resolve_evidence_records(
    conn: &Connection,
    session_id: &str,
    durable_seq: i64,
    draft: &Value,
) -> Vec<GoalReportEvidenceResolution> {
    let mut resolutions = Vec::new();
    let Some(evidences) = draft.get("evidences").and_then(Value::as_array) else {
        return resolutions;
    };

    for ev in evidences {
        let Some(ev_id) = ev.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(ref_id) = ev.get("refId").and_then(Value::as_str) else {
            continue;
        };
        let trimmed_ref = ref_id.trim();

        // 1. Check if ref_id matches a message id or tool call name/id with seq <= durable_seq
        let msg_match: Option<i64> = conn
            .prepare_cached(
                "SELECT seq FROM messages
                 WHERE session_id = ?1 AND seq <= ?2
                   AND id = ?3
                 LIMIT 1",
            )
            .ok()
            .and_then(|mut stmt| {
                stmt.query_row(params![session_id, durable_seq, trimmed_ref], |r| r.get(0))
                    .optional()
                    .ok()
                    .flatten()
            });

        if let Some(seq) = msg_match {
            resolutions.push(GoalReportEvidenceResolution {
                evidence_id: ev_id.to_string(),
                state: "recorded".to_string(),
                detail: Some(format!("Recorded in message seq {seq}")),
            });
            continue;
        }

        // 2. Check turn_queue or plan_approvals or turns
        let approval_match: Option<String> = conn
            .prepare_cached(
                "SELECT request_id FROM plan_approvals
                 WHERE session_id = ?1 AND (request_id = ?2 OR tool_call_id = ?2 OR execution_id = ?2)
                 LIMIT 1",
            )
            .ok()
            .and_then(|mut stmt| {
                stmt.query_row(params![session_id, trimmed_ref], |r| r.get(0))
                    .optional()
                    .ok()
                    .flatten()
            });

        if let Some(req_id) = approval_match {
            resolutions.push(GoalReportEvidenceResolution {
                evidence_id: ev_id.to_string(),
                state: "recorded".to_string(),
                detail: Some(format!("Recorded in plan approval {req_id}")),
            });
            continue;
        }

        // 3. Check turns table
        let turn_match: Option<String> = conn
            .prepare_cached("SELECT id FROM turns WHERE session_id = ?1 AND id = ?2 LIMIT 1")
            .ok()
            .and_then(|mut stmt| {
                stmt.query_row(params![session_id, trimmed_ref], |r| r.get(0))
                    .optional()
                    .ok()
                    .flatten()
            });

        if let Some(tid) = turn_match {
            resolutions.push(GoalReportEvidenceResolution {
                evidence_id: ev_id.to_string(),
                state: "recorded".to_string(),
                detail: Some(format!("Recorded in turn {tid}")),
            });
            continue;
        }

        // If not found or outside boundary:
        resolutions.push(GoalReportEvidenceResolution {
            evidence_id: ev_id.to_string(),
            state: "unresolved".to_string(),
            detail: Some(
                "Evidence reference was not found in recorded session history.".to_string(),
            ),
        });
    }

    resolutions
}

/// Native proof for approval-bound checks: only the Bash run the model cited
/// counts, and only inside this execution's current turn and retained resumed
/// segments, never merely the same session.
pub(super) fn execution_check_observations(
    db: &crate::db::Database,
    session_id: &str,
    execution_id: &str,
    durable_seq: i64,
    draft: &Value,
) -> anyhow::Result<Vec<GoalReportCheckObservation>> {
    observe(
        db,
        session_id,
        execution_id,
        durable_seq,
        draft,
        Matching::References,
    )
}

/// Observations for Goals without an approval-bound command list. The cited
/// evidence is a hint; the Host also finds the check's own command among this
/// execution's Bash runs, and the last run that ended with a verdict decides.
/// The result is recorded only and never gates completion.
pub(super) fn unbound_check_observations(
    db: &crate::db::Database,
    session_id: &str,
    execution_id: &str,
    durable_seq: i64,
    draft: &Value,
) -> anyhow::Result<Vec<GoalReportCheckObservation>> {
    observe(
        db,
        session_id,
        execution_id,
        durable_seq,
        draft,
        Matching::ReferencesThenCommand,
    )
}

/// How a check may be settled from durable Bash runs.
#[derive(Clone, Copy)]
enum Matching {
    /// Only the run that the check's evidence references point at.
    References,
    /// The cited run, then the last finished run of the check's own command.
    ReferencesThenCommand,
}

fn observe(
    db: &crate::db::Database,
    session_id: &str,
    execution_id: &str,
    durable_seq: i64,
    draft: &Value,
    matching: Matching,
) -> anyhow::Result<Vec<GoalReportCheckObservation>> {
    let turns = execution_turns(db, session_id, execution_id)?;
    Ok(generate_observations(
        db.data_dir(),
        db.conn(),
        session_id,
        durable_seq,
        draft,
        &turns,
        matching,
    ))
}

/// The turns an execution owns: the one its report is bound to and every
/// resumed segment its hold retained.
fn execution_turns(
    db: &crate::db::Database,
    session_id: &str,
    execution_id: &str,
) -> anyhow::Result<HashSet<String>> {
    let mut turns = HashSet::new();
    let current: Option<String> = db
        .conn()
        .query_row(
            "SELECT turn_id FROM goal_reports WHERE execution_id=?1 AND session_id=?2",
            params![execution_id, session_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    if let Some(turn) = current {
        turns.insert(turn);
    }
    if let Some(hold) = crate::goal_holds::get_hold(db, session_id, execution_id)? {
        turns.extend(hold.segments.into_iter().map(|segment| segment.turn_id));
    }
    Ok(turns)
}

fn generate_observations(
    data_dir: &Path,
    conn: &Connection,
    session_id: &str,
    durable_seq: i64,
    draft: &Value,
    owning_turns: &HashSet<String>,
    matching: Matching,
) -> Vec<GoalReportCheckObservation> {
    let mut observations = Vec::new();
    let Some(checks) = draft.get("checks").and_then(Value::as_array) else {
        return observations;
    };
    let evidences = draft
        .get("evidences")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    // The transcript is read once, for the first check that names a command,
    // and shared by every later check.
    let mut index: Option<Result<ToolRunIndex, TranscriptUnreadable>> = None;

    for chk in checks {
        let Some(chk_id) = chk.get("id").and_then(Value::as_str) else {
            continue;
        };
        let command = chk
            .get("command")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let evidence_refs: Vec<String> = chk
            .get("evidenceRefs")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_default();

        let verdict = match command
            .as_deref()
            .filter(|command| !command.trim().is_empty())
        {
            None => Verdict::Inconclusive(Gap::NoCommand),
            Some(command) => {
                let index = index.get_or_insert_with(|| {
                    ToolRunIndex::build(data_dir, conn, session_id, durable_seq, owning_turns)
                });
                match index {
                    Ok(index) => {
                        let cited = cited_run(index, evidences, command, &evidence_refs);
                        match matching {
                            Matching::References => cited.into_verdict(),
                            Matching::ReferencesThenCommand => {
                                command_match::settle(index, command, cited)
                            }
                        }
                    }
                    Err(TranscriptUnreadable) => Verdict::Inconclusive(Gap::Unreadable),
                }
            }
        };
        let (result, exit_code, detail) = verdict.into_parts();

        observations.push(GoalReportCheckObservation {
            check_id: chk_id.to_string(),
            result,
            command,
            exit_code,
            evidence_ids: evidence_refs,
            detail,
        });
    }

    observations
}

/// What the Host concluded about one check from durable facts.
enum Verdict {
    /// A durable Bash run of the check's command was found and judged.
    Conclusive(Judgment),
    Inconclusive(Gap),
}

/// How a Bash run ended, as far as the durable record shows.
struct Judgment {
    result: &'static str,
    exit_code: Option<i64>,
    detail: String,
}

impl Judgment {
    fn new(result: &'static str, exit_code: Option<i64>, detail: impl Into<String>) -> Self {
        Self {
            result,
            exit_code,
            detail: detail.into(),
        }
    }

    /// `None` when the record shows neither an error, an exit code nor a
    /// successful completion.
    fn of(outcome: &RecordedOutcome) -> Option<Self> {
        if outcome.is_error {
            return Some(Self::new(
                "failed",
                outcome.exit_code,
                "Durable tool result recorded an error.",
            ));
        }
        if let Some(code) = outcome.exit_code {
            return Some(if code == 0 {
                let detail = "Command exit code was recorded by the durable tool result.";
                Self::new("passed", Some(code), detail)
            } else {
                let detail =
                    format!("Command exit code {code} was recorded by the durable tool result.");
                Self::new("failed", Some(code), detail)
            });
        }
        outcome.succeeded.then(|| {
            let detail = "Durable tool result recorded successful completion.";
            Self::new("passed", None, detail)
        })
    }
}

/// A Bash run of the check's command that ended with a verdict.
struct Judged<'a> {
    call: ToolCall<'a>,
    judgment: Judgment,
}

impl<'a> Judged<'a> {
    fn of(call: ToolCall<'a>) -> Option<Self> {
        let judgment = Judgment::of(&call.outcome()?)?;
        Some(Self { call, judgment })
    }
}

/// Where the evidence references of one check led.
enum Cited<'a> {
    Run(Judged<'a>),
    /// A reference names several durable messages, so none can be trusted.
    Ambiguous,
    /// No reference led to a judged Bash run of the check's command.
    Nothing,
}

impl Cited<'_> {
    /// The verdict when only references may settle the check.
    fn into_verdict(self) -> Verdict {
        match self {
            Cited::Run(run) => Verdict::Conclusive(run.judgment),
            Cited::Ambiguous => Verdict::Inconclusive(Gap::Ambiguous),
            Cited::Nothing => Verdict::Inconclusive(Gap::NoMatch),
        }
    }
}

/// Follows the check's evidence references to a Bash run of its command. The
/// first evidence in the draft that yields a verdict decides.
fn cited_run<'a>(
    index: &'a ToolRunIndex,
    evidences: &[Value],
    command: &str,
    evidence_refs: &[String],
) -> Cited<'a> {
    for evidence in evidences {
        let Some(evidence_id) = evidence.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !evidence_refs.iter().any(|id| id == evidence_id)
            || evidence.get("kind").and_then(Value::as_str) != Some("tool_result")
        {
            continue;
        }
        let Some(ref_id) = evidence.get("refId").and_then(Value::as_str) else {
            continue;
        };
        let call = match index.lookup(ref_id) {
            Lookup::Missing => continue,
            Lookup::Ambiguous => return Cited::Ambiguous,
            Lookup::Unique(call) => call,
        };
        if !call.is_bash() || call.command() != Some(command) {
            continue;
        }
        if let Some(run) = Judged::of(call) {
            return Cited::Run(run);
        }
    }
    Cited::Nothing
}

/// Why a check stays inconclusive.
enum Gap {
    NoCommand,
    Unreadable,
    Ambiguous,
    /// Only references may settle the check and none led to a judged run.
    NoMatch,
    /// The check's command never ran in this execution.
    NoRun,
    /// The command ran this many times and no run recorded how it ended.
    NoFinishedRun(usize),
}

impl Gap {
    fn detail(&self) -> String {
        match self {
            Gap::NoCommand => {
                "Check command is missing; durable command identity cannot be verified.".to_string()
            }
            Gap::Unreadable => {
                "Durable tool result could not be read from the session transcript.".to_string()
            }
            Gap::Ambiguous => "Tool evidence identity matches multiple durable results in this execution; use a unique durable message ID.".to_string(),
            Gap::NoMatch => "No durable tool result matched the check evidence.".to_string(),
            Gap::NoRun => {
                "No durable Bash run of the check command was found in this execution.".to_string()
            }
            Gap::NoFinishedRun(1) => "The durable Bash run of the check command in this execution did not record how it ended.".to_string(),
            Gap::NoFinishedRun(runs) => format!("None of the {runs} durable Bash runs of the check command in this execution recorded how it ended."),
        }
    }
}

impl Verdict {
    fn into_parts(self) -> (String, Option<i64>, Option<String>) {
        match self {
            Verdict::Conclusive(judgment) => (
                judgment.result.to_string(),
                judgment.exit_code,
                Some(judgment.detail),
            ),
            Verdict::Inconclusive(gap) => ("inconclusive".to_string(), None, Some(gap.detail())),
        }
    }
}
