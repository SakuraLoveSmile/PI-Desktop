use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, path::Path};

use crate::transcripts;

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

/// Generates Host check observations from recorded command/check facts.
pub fn generate_check_observations(
    data_dir: &Path,
    conn: &Connection,
    session_id: &str,
    durable_seq: i64,
    draft: &Value,
) -> Vec<GoalReportCheckObservation> {
    let mut observations = Vec::new();
    let Some(checks) = draft.get("checks").and_then(Value::as_array) else {
        return observations;
    };

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

        let (result, exit_code, detail) = durable_check_result(
            data_dir,
            conn,
            session_id,
            durable_seq,
            draft,
            command.as_deref(),
            &evidence_refs,
        );

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

fn durable_check_result(
    data_dir: &Path,
    conn: &Connection,
    session_id: &str,
    durable_seq: i64,
    draft: &Value,
    command: Option<&str>,
    evidence_refs: &[String],
) -> (String, Option<i64>, Option<String>) {
    let Some(command) = command.filter(|command| !command.trim().is_empty()) else {
        return (
            "inconclusive".to_string(),
            None,
            Some(
                "Check command is missing; durable command identity cannot be verified."
                    .to_string(),
            ),
        );
    };
    let seq_by_message_id: HashMap<String, i64> = conn
        .prepare_cached(
            "SELECT id, seq FROM messages WHERE session_id = ?1 AND seq <= ?2 AND role = 'tool'",
        )
        .ok()
        .and_then(|mut stmt| {
            stmt.query_map(params![session_id, durable_seq], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .ok()
            .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .unwrap_or_default();
    let Ok(records) = transcripts::read_transcript(data_dir, session_id) else {
        return (
            "inconclusive".to_string(),
            None,
            Some("Durable tool result could not be read from the session transcript.".to_string()),
        );
    };

    for evidence in draft
        .get("evidences")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
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
        let Some((record, block)) = records.iter().find_map(|record| {
            if !seq_by_message_id.contains_key(&record.id) {
                return None;
            }
            record
                .blocks
                .as_array()
                .into_iter()
                .flatten()
                .find(|block| {
                    block.get("type").and_then(Value::as_str) == Some("tool_call")
                        && (block.get("callId").and_then(Value::as_str) == Some(ref_id)
                            || record.id == ref_id)
                })
                .map(|block| (record, block))
        }) else {
            continue;
        };
        if block.get("name").and_then(Value::as_str) != Some("Bash")
            || record.tool_name.as_deref() != Some("Bash")
            || block
                .get("args")
                .and_then(|args| args.get("command"))
                .and_then(Value::as_str)
                != Some(command)
        {
            continue;
        }
        let Some(tool_result) = block.get("result") else {
            continue;
        };
        let exit_code = tool_result.get("exitCode").and_then(Value::as_i64);
        let is_error = block
            .get("isError")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || block
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|status| matches!(status, "error" | "failed"));
        if let Some(code) = exit_code {
            return if code == 0 {
                (
                    "passed".to_string(),
                    Some(code),
                    Some("Command exit code was recorded by the durable tool result.".to_string()),
                )
            } else {
                (
                    "failed".to_string(),
                    Some(code),
                    Some(format!(
                        "Command exit code {code} was recorded by the durable tool result."
                    )),
                )
            };
        }
        if is_error {
            return (
                "failed".to_string(),
                None,
                Some("Durable tool result recorded an error.".to_string()),
            );
        }
        if block.get("status").and_then(Value::as_str) == Some("success") {
            return (
                "passed".to_string(),
                None,
                Some("Durable tool result recorded successful completion.".to_string()),
            );
        }
    }

    (
        "inconclusive".to_string(),
        None,
        Some("No durable tool result matched the check evidence.".to_string()),
    )
}
