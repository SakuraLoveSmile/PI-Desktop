use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
                   AND (id = ?3 OR tool_name = ?3 OR text LIKE '%' || ?3 || '%')
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
pub fn generate_check_observations(draft: &Value) -> Vec<GoalReportCheckObservation> {
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
        let exit_code = chk.get("exitCode").and_then(Value::as_i64);
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

        let (result, detail) = match exit_code {
            Some(0) => (
                "passed".to_string(),
                Some("Command exited with code 0.".to_string()),
            ),
            Some(code) => (
                "failed".to_string(),
                Some(format!("Command exited with non-zero exit code {code}.")),
            ),
            None => {
                let disposition = chk.get("disposition").and_then(Value::as_str);
                match disposition {
                    Some("not_run") => (
                        "inconclusive".to_string(),
                        Some("Check was not executed.".to_string()),
                    ),
                    Some("blocked") => (
                        "inconclusive".to_string(),
                        Some("Check was blocked before execution.".to_string()),
                    ),
                    _ => (
                        "inconclusive".to_string(),
                        Some("Exit code was not recorded by host.".to_string()),
                    ),
                }
            }
        };

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
