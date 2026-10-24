//! Immutable verification requirements bound to an approved Goal execution.

use std::collections::HashSet;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

const MAX_COMMAND_BYTES: usize = 4096;
const MAX_TOTAL_BYTES: usize = 65536;

pub(crate) fn parse_commands(value: Option<&Value>) -> Result<Option<Vec<String>>> {
    let Some(value) = value else { return Ok(None) };
    let values = value.as_array().ok_or_else(|| {
        anyhow!("INVALID_ARGUMENT: requiredVerificationCommands must be a non-empty string array")
    })?;
    if values.is_empty() || values.len() > crate::goal_reports::MAX_CHECKS {
        return Err(anyhow!(
            "INVALID_ARGUMENT: requiredVerificationCommands must contain 1..=200 commands"
        ));
    }
    let mut commands = Vec::with_capacity(values.len());
    let mut seen = HashSet::new();
    let mut total_bytes = 0;
    for (index, value) in values.iter().enumerate() {
        let command = value.as_str().ok_or_else(|| {
            anyhow!("INVALID_ARGUMENT: requiredVerificationCommands[{index}] must be a string")
        })?;
        total_bytes += command.len();
        if command.trim().is_empty()
            || command.len() > MAX_COMMAND_BYTES
            || command.contains(['\0', '\r', '\n'])
            || total_bytes > MAX_TOTAL_BYTES
        {
            return Err(anyhow!("INVALID_ARGUMENT: requiredVerificationCommands[{index}] must be a non-empty single-line command (no NUL; <=4096 UTF-8 bytes each, <=65536 total)"));
        }
        if !seen.insert(command) {
            return Err(anyhow!("INVALID_ARGUMENT: requiredVerificationCommands contains duplicate command: {command}"));
        }
        commands.push(command.to_owned());
    }
    Ok(Some(commands))
}

fn correction(command: &str, problem: &str) -> anyhow::Error {
    // Show a truthful non-success example; never suggest fabricating a pass.
    let example = json!({
        "verdict": "blocked", "checks": [{"id": "required-check", "command": command,
            "result": "inconclusive", "exitCode": null, "disposition": "not_run",
            "detail": "Explain why this command could not run; otherwise supply its actual integer exit code."}]
    });
    anyhow!("INVALID_ARGUMENT: required verification command {command:?}: {problem}. Resubmit SubmitGoalReport with exactly one check for each required command and actual results. Example (include all required commands): {example}")
}

pub(crate) fn validate_checks(commands: Option<&[String]>, draft: &Value) -> Result<()> {
    let Some(commands) = commands else {
        return Ok(());
    };
    let checks = draft.get("checks").and_then(Value::as_array);
    let met = draft.get("verdict").and_then(Value::as_str) == Some("met");
    for command in commands {
        let matching: Vec<&Value> = checks
            .into_iter()
            .flatten()
            .filter(|check| {
                check
                    .get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|c| c == command)
            })
            .collect();
        let check = match matching.as_slice() {
            [] => return Err(correction(command, "missing from checks")),
            [check] => *check,
            _ => return Err(correction(command, "appears more than once in checks")),
        };
        let result = check.get("result").and_then(Value::as_str);
        let disposition = check.get("disposition").and_then(Value::as_str);
        let exit_code = check.get("exitCode").filter(|value| !value.is_null());
        if disposition.is_some_and(|value| !matches!(value, "executed" | "not_run" | "blocked")) {
            return Err(correction(command, "invalid disposition"));
        }
        if let Some(value) = exit_code {
            let Some(code) = value.as_i64() else {
                return Err(correction(
                    command,
                    "exitCode must be an actual integer, or null for an inconclusive check",
                ));
            };
            if disposition.is_some_and(|value| matches!(value, "not_run" | "blocked"))
                || (code == 0 && result != Some("passed"))
                || (code != 0 && result != Some("failed"))
                || (met && code != 0)
            {
                return Err(correction(command, "result/verdict/disposition is inconsistent with the actual exitCode (0 requires passed; nonzero requires failed and a non-met verdict)"));
            }
        } else if met
            || result != Some("inconclusive")
            || disposition == Some("executed")
            || check
                .get("detail")
                .and_then(Value::as_str)
                .is_none_or(|detail| detail.trim().is_empty())
        {
            return Err(correction(command, "unknown exitCode requires a non-met verdict, inconclusive result, and a non-empty explanation"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_verification_commands_are_bounded_exact_and_ordered() {
        assert_eq!(parse_commands(None).unwrap(), None);
        let commands = json!([" pnpm test ", "cargo test --locked"]);
        assert_eq!(
            parse_commands(Some(&commands)).unwrap(),
            Some(vec![" pnpm test ".into(), "cargo test --locked".into()])
        );
        let per_command_boundary = format!("{}x", "界".repeat(1365));
        assert_eq!(per_command_boundary.len(), 4096);
        assert!(parse_commands(Some(&json!([per_command_boundary]))).is_ok());
        let total_boundary = (0..16)
            .map(|i| format!("{i:02}{}", "x".repeat(4094)))
            .collect::<Vec<_>>();
        assert!(parse_commands(Some(&json!(total_boundary))).is_ok());
        for invalid in [
            json!(null),
            json!([]),
            json!("cargo test"),
            json!([2]),
            json!([""]),
            json!([" \t "]),
            json!(["cargo test", "cargo test"]),
            json!(["a\nb"]),
            json!(["a\rb"]),
            json!(["a\0b"]),
            json!(["界".repeat(1366)]),
            json!((0..201).map(|i| format!("command {i}")).collect::<Vec<_>>()),
            json!((0..17)
                .map(|i| format!("{i:02}{}", "x".repeat(4094)))
                .collect::<Vec<_>>()),
        ] {
            assert!(parse_commands(Some(&invalid))
                .unwrap_err()
                .to_string()
                .starts_with("INVALID_ARGUMENT:"));
        }
        assert!(parse_commands(Some(&json!((0..200)
            .map(|i| format!("command {i}"))
            .collect::<Vec<_>>())))
        .is_ok());
    }

    #[test]
    fn required_verification_rejects_missing_duplicate_changed_commands_and_false_results() {
        let commands = vec!["cargo test --locked".into()];
        let check = json!({"id": "verify", "command": "cargo test --locked", "result": "passed", "exitCode": 0});
        for checks in [
            json!([]),
            json!([check.clone(), check.clone()]),
            json!([{ "command": "cargo test" }]),
            json!([{ "command": " cargo test --locked " }]),
            json!([{ "command": "cargo test --locked --no-default-features" }]),
        ] {
            assert!(
                validate_checks(Some(&commands), &json!({"verdict":"met", "checks":checks}))
                    .is_err()
            );
        }
        for (verdict, result, exit_code) in [
            ("met", "passed", json!(null)),
            ("met", "passed", json!(1)),
            ("partial", "passed", json!(1)),
            ("partial", "failed", json!(0)),
            ("partial", "failed", json!(0.5)),
            ("partial", "inconclusive", json!("unknown")),
            ("met", "failed", json!(1)),
        ] {
            let draft = json!({"verdict":verdict, "checks":[{
                "command":"cargo test --locked", "result":result, "exitCode":exit_code, "detail":"Observed outcome"
            }]});
            assert!(validate_checks(Some(&commands), &draft).is_err(), "{draft}");
        }
        assert!(
            validate_checks(Some(&commands), &json!({"verdict":"met", "checks":[check]})).is_ok()
        );
        assert!(validate_checks(None, &json!({"verdict":"met", "checks":[]})).is_ok());
    }

    #[test]
    fn required_verification_allows_honest_failures_and_unrun_checks_without_claiming_success() {
        let commands = vec!["cargo test --locked".into()];
        for verdict in ["partial", "blocked", "unknown"] {
            assert!(validate_checks(Some(&commands), &json!({"verdict":verdict,"checks":[{
                "command":"cargo test --locked", "result":"failed", "exitCode":1, "disposition":"executed"
            }]})).is_ok());
            for disposition in ["not_run", "blocked"] {
                let mut draft = json!({"verdict":verdict,"checks":[{
                    "command":"cargo test --locked", "result":"inconclusive", "exitCode":null,
                    "disposition":disposition, "detail":"Required service is unavailable"
                }]});
                assert!(validate_checks(Some(&commands), &draft).is_ok());
                draft["checks"][0]["detail"] = json!("  ");
                assert!(validate_checks(Some(&commands), &draft).is_err());
            }
        }
    }
}
