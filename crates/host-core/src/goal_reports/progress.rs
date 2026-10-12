//! Reconcile report claims with the persisted, execution-scoped Goal progress.

use super::*;
use crate::goal_progress::{self, GoalProgressSnapshot};

const MAX_FALLBACK_STRING_BYTES: usize = 1024;
const MAX_FALLBACK_STEPS_BYTES: usize = MAX_REPORT_JSON_BYTES / 4;

pub(super) fn load_matching_progress(
    db: &Database,
    execution_id: &str,
    facts: &ProposalFacts,
) -> Result<Option<GoalProgressSnapshot>> {
    Ok(
        goal_progress::get_progress(db, None, execution_id)?.filter(|snapshot| {
            snapshot.schema_version == goal_progress::GOAL_PROGRESS_SCHEMA_VERSION
                && snapshot.execution_id == execution_id
                && snapshot.session_id == facts.session_id
                && snapshot.proposal_id == facts.request_id
        }),
    )
}

pub(super) fn validate_met_progress(
    draft: &Value,
    progress: Option<&GoalProgressSnapshot>,
) -> Result<()> {
    if draft.get("verdict").and_then(Value::as_str) != Some("met") {
        return Ok(());
    }
    if let Some(snapshot) = progress {
        let unfinished = snapshot
            .items
            .iter()
            .filter(|item| item.status != "completed")
            .count();
        if unfinished > 0 {
            return Err(anyhow!(
                "INVALID_ARGUMENT: Goal progress revision {} has {} items that are not completed. Call UpdateGoalProgress to reconcile pending, in_progress, or failed items before submitting verdict met, or submit an honest partial/blocked report.",
                snapshot.revision,
                unfinished,
            ));
        }
    }
    Ok(())
}

pub(super) fn fallback_progress(
    progress: Option<&GoalProgressSnapshot>,
) -> Result<(String, Vec<Value>, Vec<Value>)> {
    let Some(snapshot) = progress else {
        return Ok(("unknown".into(), vec![], vec![]));
    };
    // Progress is an agent claim, not independently verified Goal acceptance.
    let verdict = if snapshot.items.iter().any(|item| item.status == "completed") {
        "partial"
    } else if snapshot.items.iter().any(|item| item.status == "failed") {
        "blocked"
    } else {
        "unknown"
    };
    let mut steps = Vec::new();
    let mut steps_bytes = 2;
    let mut strings_truncated = false;
    for item in snapshot.items.iter().take(MAX_STEPS) {
        let status = match item.status.as_str() {
            "completed" => "completed",
            "failed" => "failed",
            "pending" | "in_progress" => "skipped",
            _ => {
                return Err(anyhow!(
                    "INVALID_ARGUMENT: stored Goal progress has an invalid status"
                ))
            }
        };
        let detail = format!(
            "Last agent-reported progress status: {} (revision {}). {}",
            item.status,
            snapshot.revision,
            if status == "skipped" {
                "Completion was not reported; retained as skipped in this fallback report."
            } else {
                "Retained from the progress snapshot; Goal acceptance was not independently verified."
            },
        );
        let (mut id, id_truncated) = bounded_string(&item.id);
        if id_truncated {
            // Preserve distinct step identities when oversized IDs share a prefix.
            id = format!("progress-{}", sha256_hex(item.id.as_bytes()));
        }
        let (title, title_truncated) = bounded_string(&item.label);
        strings_truncated |= id_truncated || title_truncated;
        let step = json!({
                "id": id,
                "title": title,
                "status": status,
                "detail": detail,
        });
        // Charge serialized bytes, including escaped characters, with space
        // for the additional indentation when nested in the pretty report.
        let step_bytes = serde_json::to_vec_pretty(&step)?.len() + 64;
        if steps_bytes + step_bytes > MAX_FALLBACK_STEPS_BYTES {
            break;
        }
        steps_bytes += step_bytes;
        steps.push(step);
    }
    let mut limitations = vec![json!(format!(
        "Steps reflect the last agent-reported Goal progress snapshot (revision {}), not independently verified execution evidence or Goal acceptance.",
        snapshot.revision,
    ))];
    if strings_truncated {
        limitations.push(json!(format!(
            "Progress titles were truncated to {} UTF-8 bytes or oversized IDs replaced with content hashes in this fallback report; the persisted progress snapshot is unchanged.",
            MAX_FALLBACK_STRING_BYTES,
        )));
    }
    if snapshot.items.len() > steps.len() {
        limitations.push(json!(format!(
            "{} progress items omitted because the fallback report is limited to {} steps and {} serialized progress bytes.",
            snapshot.items.len() - steps.len(),
            MAX_STEPS,
            MAX_FALLBACK_STEPS_BYTES,
        )));
    }
    Ok((verdict.into(), steps, limitations))
}

fn bounded_string(value: &str) -> (String, bool) {
    if value.len() <= MAX_FALLBACK_STRING_BYTES {
        return (value.into(), false);
    }
    let mut end = MAX_FALLBACK_STRING_BYTES - "…".len();
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (format!("{}…", &value[..end]), true)
}
