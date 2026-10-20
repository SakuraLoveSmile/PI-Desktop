//! Structured Goal report draft validation.

use anyhow::{anyhow, Result};
use serde_json::Value;

use super::{
    assets, MAX_CHECKS, MAX_CRITERIA, MAX_EVIDENCE_SUMMARY_BYTES, MAX_FILES, MAX_METRICS,
    MAX_REPORT_JSON_BYTES, MAX_STEPS,
};

fn validate_string_field<'a>(
    object: &'a serde_json::Map<String, Value>,
    field: &str,
    context: &str,
) -> Result<&'a str> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: {context}.{field} must be a non-empty string"))
}

fn validate_enum_field(
    object: &serde_json::Map<String, Value>,
    field: &str,
    allowed: &[&str],
    context: &str,
) -> Result<()> {
    let value = validate_string_field(object, field, context)?;
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(anyhow!(
            "INVALID_ARGUMENT: {context}.{field} must be one of: {}",
            allowed.join(", ")
        ))
    }
}

fn validate_array<'a>(draft: &'a Value, field: &str) -> Result<Option<&'a Vec<Value>>> {
    let Some(value) = draft.get(field) else {
        return Ok(None);
    };
    value
        .as_array()
        .map(Some)
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: {field} must be an array"))
}

pub(super) fn validate_structured_draft(draft: &Value) -> Result<()> {
    let object = draft
        .as_object()
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: draft must be an object"))?;
    if ["closure", "segments", "blocks"]
        .iter()
        .any(|key| object.contains_key(*key))
    {
        return Err(anyhow!(
            "INVALID_ARGUMENT: closure, segments, and blocks are Host-owned report fields"
        ));
    }
    let summary = validate_string_field(object, "summary", "draft")?;
    if summary.len() > MAX_REPORT_JSON_BYTES {
        return Err(anyhow!("REPORT_SIZE_EXCEEDED: summary too large"));
    }
    validate_enum_field(
        object,
        "verdict",
        &["met", "partial", "blocked", "unknown"],
        "draft",
    )?;

    for (field, limit) in [
        ("metrics", MAX_METRICS),
        ("criteria", MAX_CRITERIA),
        ("steps", MAX_STEPS),
        ("files", MAX_FILES),
        ("checks", MAX_CHECKS),
    ] {
        if let Some(items) = validate_array(draft, field)? {
            if items.len() > limit {
                return Err(anyhow!("LIMIT_EXCEEDED: too many {field}"));
            }
        }
    }

    if let Some(items) = validate_array(draft, "metrics")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: metrics[{index}] must be an object"))?;
            let context = format!("metrics[{index}]");
            validate_string_field(object, "label", &context)?;
            validate_string_field(object, "value", &context)?;
        }
    }
    if let Some(items) = validate_array(draft, "criteria")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: criteria[{index}] must be an object"))?;
            let context = format!("criteria[{index}]");
            validate_string_field(object, "id", &context)?;
            validate_string_field(object, "text", &context)?;
            validate_enum_field(
                object,
                "verdict",
                &["met", "unmet", "partial", "unknown"],
                &context,
            )?;
        }
    }
    if let Some(items) = validate_array(draft, "steps")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: steps[{index}] must be an object"))?;
            let context = format!("steps[{index}]");
            validate_string_field(object, "id", &context)?;
            validate_string_field(object, "title", &context)?;
            validate_enum_field(
                object,
                "status",
                &["completed", "failed", "skipped"],
                &context,
            )?;
        }
    }
    if let Some(items) = validate_array(draft, "files")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: files[{index}] must be an object"))?;
            let context = format!("files[{index}]");
            validate_string_field(object, "path", &context)?;
            validate_enum_field(
                object,
                "changeType",
                &["created", "modified", "deleted", "referenced"],
                &context,
            )?;
            validate_enum_field(
                object,
                "attribution",
                &["direct", "subagent", "declared"],
                &context,
            )?;
        }
    }
    if let Some(items) = validate_array(draft, "checks")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: checks[{index}] must be an object"))?;
            let context = format!("checks[{index}]");
            validate_string_field(object, "id", &context)?;
            validate_string_field(object, "command", &context)?;
            validate_enum_field(
                object,
                "result",
                &["passed", "failed", "inconclusive"],
                &context,
            )?;
        }
    }
    if let Some(items) = validate_array(draft, "evidences")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: evidences[{index}] must be an object"))?;
            let context = format!("evidences[{index}]");
            validate_string_field(object, "id", &context)?;
            validate_enum_field(
                object,
                "kind",
                &["tool_call", "tool_result", "message", "file", "subagent"],
                &context,
            )?;
            validate_string_field(object, "refId", &context)?;
            let evidence_summary = validate_string_field(object, "summary", &context)?;
            if evidence_summary.len() > MAX_EVIDENCE_SUMMARY_BYTES {
                return Err(anyhow!("LIMIT_EXCEEDED: evidence summary too large"));
            }
        }
        if let Some(items) = validate_array(draft, "screenshots")? {
            if items.len() > assets::MAX_SCREENSHOTS_PER_REPORT {
                return Err(anyhow!("LIMIT_EXCEEDED: too many screenshots"));
            }
            for (index, item) in items.iter().enumerate() {
                let object = item.as_object().ok_or_else(|| {
                    anyhow!("INVALID_ARGUMENT: screenshots[{index}] must be an object")
                })?;
                let context = format!("screenshots[{index}]");
                validate_string_field(object, "id", &context)?;
                validate_string_field(object, "evidenceRef", &context)?;
            }
        }
    }
    Ok(())
}
