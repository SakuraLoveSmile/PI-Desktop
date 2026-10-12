//! Advisory recognition of common literal shared-tree Git commands, not a shell sandbox.
use anyhow::Result;
use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};

use crate::{db::Database, sessions};

pub(super) const NS: &str = "team-shared-git-warning-v1";

pub(crate) struct Context {
    team: String,
    session: String,
    member_name: String,
    turn: String,
    operations: Vec<&'static str>,
    conflicts: Vec<Conflict>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Conflict {
    task_id: String,
    member_session_id: String,
    member_name: String,
}

/// A deliberately bounded lexical scan: quotes/escapes and command separators,
/// without interpreting variables, aliases, substitutions or shell programs.
/// It only recognizes Git at a command position, never in printf/echo arguments.
fn commands(command: &str) -> Vec<Vec<String>> {
    let mut result = Vec::new();
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut chars = command.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' && quote != Some('\'') {
            if let Some(next) = chars.next() {
                if next != '\n' {
                    word.push(next);
                }
            }
        } else if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else {
                word.push(ch);
            }
        } else if matches!(ch, '\'' | '"') {
            quote = Some(ch);
        } else if ch == '#' && word.is_empty() {
            for next in chars.by_ref() {
                if next == '\n' {
                    break;
                }
            }
            if !words.is_empty() {
                result.push(std::mem::take(&mut words));
            }
        } else if matches!(ch, ';' | '&' | '|' | '\n' | '(' | ')') {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
            if !words.is_empty() {
                result.push(std::mem::take(&mut words));
            }
        } else if ch.is_whitespace() {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
        } else {
            word.push(ch);
        }
    }
    if !word.is_empty() {
        words.push(word);
    }
    if !words.is_empty() && quote.is_none() {
        result.push(words);
    }
    result
}

fn short_option(arg: &str, flag: char) -> bool {
    arg.starts_with('-') && !arg.starts_with("--") && arg[1..].contains(flag)
}

fn commit_all(arg: &str) -> bool {
    if arg == "--all" {
        return true;
    }
    if !arg.starts_with('-') || arg.starts_with("--") {
        return false;
    }
    // In -amMessage the a is a flag; in -mMessage the a is message text.
    for flag in arg[1..].chars() {
        if flag == 'a' {
            return true;
        }
        if matches!(flag, 'm' | 'F' | 'C' | 'c') {
            return false;
        }
    }
    false
}

fn operation(words: &[String]) -> Option<&'static str> {
    let mut index = 0;
    // Common literal wrappers; do not guess at sudo, aliases or interpreter -c.
    while words
        .get(index)
        .is_some_and(|w| w.contains('=') && !w.starts_with('-'))
    {
        index += 1;
    }
    if words
        .get(index)
        .is_some_and(|w| w == "command" || w == "env")
    {
        index += 1;
        while words
            .get(index)
            .is_some_and(|w| w.contains('=') && !w.starts_with('-'))
        {
            index += 1;
        }
    }
    let git = words.get(index)?;
    if git != "git" && !git.ends_with("/git") && !git.ends_with("\\git.exe") {
        return None;
    }
    index += 1;
    // Git global options that consume a value. Other literal flags need no value.
    while let Some(arg) = words.get(index) {
        if !arg.starts_with('-') {
            break;
        }
        index += 1;
        if matches!(
            arg.as_str(),
            "-C" | "-c" | "--git-dir" | "--work-tree" | "--namespace" | "--config-env"
        ) {
            index += 1;
        }
    }
    let verb = words.get(index)?;
    let args = &words[index + 1..];
    let mut options = Vec::new();
    let mut args_iter = args.iter();
    while let Some(arg) = args_iter.next() {
        if arg == "--" {
            break;
        }
        options.push(arg);
        // These literal options consume a value that may itself look like -a.
        if verb == "commit"
            && matches!(
                arg.as_str(),
                "-m" | "--message"
                    | "-F"
                    | "--file"
                    | "--author"
                    | "--date"
                    | "-C"
                    | "-c"
                    | "--reuse-message"
                    | "--reedit-message"
            )
        {
            args_iter.next();
        }
    }
    match verb.as_str() {
        "add"
            if options
                .iter()
                .any(|s| s.as_str() == "--all" || short_option(s, 'A')) =>
        {
            Some("git add -A")
        }
        "stash"
            if !args
                .first()
                .is_some_and(|s| matches!(s.as_str(), "list" | "show")) =>
        {
            Some("git stash")
        }
        "reset" if options.iter().any(|s| s.as_str() == "--hard") => Some("git reset --hard"),
        "checkout" if args.iter().any(|s| matches!(s.as_str(), "." | "./")) => {
            Some("git checkout .")
        }
        "clean" => Some("git clean"),
        "commit" if options.iter().any(|s| commit_all(s)) => Some("git commit -a"),
        _ => None,
    }
}

pub(crate) fn capture(
    db: &Database,
    session: &str,
    expected_turn: Option<&str>,
    tool: &str,
    args: &Value,
) -> Result<Option<Context>> {
    if tool != "Bash" {
        return Ok(None);
    }
    let mut operations = Vec::new();
    for words in commands(
        args.get("command")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    ) {
        if let Some(op) = operation(&words) {
            if !operations.contains(&op) {
                operations.push(op);
            }
        }
    }
    if operations.is_empty() {
        return Ok(None);
    }
    let (team, member_name) =
        if let Some(member) = super::get_team_member_by_session_id(db, session)? {
            (member.team_session_id, member.name)
        } else if super::get_team(db, session)?.is_some() {
            (session.into(), "Lead".into())
        } else {
            return Ok(None);
        };
    let Some(turn) = sessions::running_turn_id(db, session)? else {
        return Ok(None);
    };
    if expected_turn.is_some_and(|expected| expected != turn) {
        return Ok(None);
    }
    let mut conflicts = Vec::new();
    for task in super::list_team_tasks(db, &team)? {
        if task.deleted || task.status != "in_progress" || task.write_scopes.is_empty() {
            continue;
        }
        let Some(owner) = task.owner_session_id.filter(|id| id != session) else {
            continue;
        };
        let name = if owner == team {
            Some("Lead".into())
        } else {
            super::get_team_member_by_session_id(db, &owner)?
                .filter(|m| m.team_session_id == team)
                .map(|m| m.name)
        };
        if let Some(name) = name {
            conflicts.push(Conflict {
                task_id: task.task_id,
                member_session_id: owner,
                member_name: name,
            });
        }
    }
    if conflicts.is_empty() {
        return Ok(None);
    }
    Ok(Some(Context {
        team,
        session: session.into(),
        member_name,
        turn,
        operations,
        conflicts,
    }))
}

fn annotate(db: &Database, context: &Context, call_id: &str, content: &mut Value) -> Result<()> {
    content["gitWarning"] = json!({
        "code":"TEAM_SHARED_GIT_WARNING", "operations":context.operations, "conflictingTasks":context.conflicts,
        "message":"This Bash command includes shared-tree Git operations while another Team member has in-progress write scopes. Execution was not blocked; coordinate ownership and inspect the actual exit code before staging, stashing, resetting, cleaning or committing shared changes. This advisory is not a shell sandbox."
    });
    let tx = db.conn().unchecked_transaction()?;
    let attached: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM teams t JOIN sessions s ON s.id=?2 WHERE t.team_session_id=?1 AND s.deleted_at IS NULL AND (?1=?2 OR EXISTS(SELECT 1 FROM team_members m WHERE m.team_session_id=?1 AND m.member_session_id=?2)))", params![context.team, context.session], |r| r.get(0))?;
    if !attached {
        content["gitTrackingSkipped"] = json!(
            "The Team owner was detached before execution settled; no advisory count was recorded."
        );
        return Ok(());
    }
    let key = serde_json::to_string(&(&context.session, &context.turn, call_id))?;
    let inserted = tx.execute("INSERT INTO kv(ns,key,value_json,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(ns,key) DO NOTHING", params![NS,key,json!({"teamSessionId":context.team,"memberSessionId":context.session,"memberName":context.member_name}).to_string(),crate::db::now_ms()])?;
    if inserted > 0 {
        tx.execute(
            "UPDATE teams SET revision=revision+1,updated_at=?2 WHERE team_session_id=?1",
            params![context.team, crate::db::now_ms()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// An execution failure remains a failure, and a diagnostic storage failure
/// remains observable without changing the runner's result or retry semantics.
pub(crate) fn annotate_observable(
    db: &Database,
    context: &Result<Option<Context>>,
    call_id: &str,
    content: &mut Value,
) {
    let tracked = match context {
        Ok(Some(context)) => annotate(db, context, call_id, content),
        Ok(None) => return,
        Err(error) => {
            tracing::error!(error = %error, "shared Git warning capture failed");
            content["gitTrackingError"] = json!("Shared Git advisory capture failed. The actual Bash execution result is unchanged.");
            return;
        }
    };
    if let Err(error) = tracked {
        tracing::error!(error = %error, "shared Git warning tracking failed");
        content["gitTrackingError"] = json!(
            "Shared Git advisory tracking failed. The actual Bash execution result is unchanged."
        );
    }
}

pub fn counts(db: &Database, team: &str) -> Result<Vec<super::write_scopes::MemberWriteCount>> {
    let mut statement = db.conn().prepare_cached("SELECT json_extract(value_json,'$.memberSessionId'),json_extract(value_json,'$.memberName'),COUNT(*) FROM kv WHERE ns=?1 AND json_extract(value_json,'$.teamSessionId')=?2 GROUP BY json_extract(value_json,'$.memberSessionId'),json_extract(value_json,'$.memberName') ORDER BY json_extract(value_json,'$.memberSessionId')")?;
    let rows = statement.query_map(params![NS, team], |r| {
        Ok(super::write_scopes::MemberWriteCount {
            member_session_id: r.get(0)?,
            member_name: r.get(1)?,
            count: r.get::<_, i64>(2)? as u64,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_and_storage_failures_are_visible_without_rewriting_the_bash_result() {
        let db = super::super::tests::test_db();
        let team = super::super::tests::create_test_lead(&db);
        super::super::ensure_team(&db, &team).unwrap();
        let context = Context {
            team: team.clone(),
            session: team,
            member_name: "Lead".into(),
            turn: "turn".into(),
            operations: vec!["git stash"],
            conflicts: vec![],
        };
        db.conn().execute_batch("DROP TABLE kv").unwrap();
        let mut result =
            json!({"ok":false,"isError":true,"content":{"exitCode":7,"stderr":"fixture failure"}});
        annotate_observable(&db, &Ok(Some(context)), "call", &mut result["content"]);
        assert_eq!(result["ok"], false);
        assert_eq!(result["isError"], true);
        assert_eq!(result["content"]["exitCode"], 7);
        assert_eq!(result["content"]["stderr"], "fixture failure");
        assert_eq!(
            result["content"]["gitWarning"]["code"],
            "TEAM_SHARED_GIT_WARNING"
        );
        assert!(result["content"]["gitTrackingError"].is_string());
        let mut captured_failure = json!({"exitCode":0});
        annotate_observable(
            &db,
            &Err(anyhow::anyhow!("fixture capture error")),
            "call",
            &mut captured_failure,
        );
        assert_eq!(captured_failure["exitCode"], 0);
        assert!(captured_failure["gitTrackingError"].is_string());
    }

    #[test]
    fn common_literal_commands_are_recognized_without_treating_output_as_commands() {
        for (command, expected) in [
            ("git add -A && git commit -m 'fixture'", vec!["git add -A"]),
            ("git -C 'directory with spaces' add '-vA'; git stash push -m 'save'", vec!["git add -A", "git stash"]),
            ("command git reset --hard; git checkout -- '.'", vec!["git reset --hard", "git checkout ."]),
            ("env GIT_PAGER=cat git clean -fd\ngit commit -am 'message'", vec!["git clean", "git commit -a"]),
            ("/usr/bin/git -c core.quotePath=false add --all", vec!["git add -A"]),
            ("git add -- -A; git commit -m '-a'; git commit -mhas-a; printf '%s' 'git stash'", vec![]),
            ("git status; git diff; git stash list; git stash show; # git reset --hard\nprintf ok", vec![]),
        ] {
            let actual: Vec<_> = commands(command).iter().filter_map(|words| operation(words)).collect();
            assert_eq!(actual, expected, "{command}");
        }
    }
}
