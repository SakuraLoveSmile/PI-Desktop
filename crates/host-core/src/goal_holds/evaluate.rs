use super::*;

/// Only a verified structured met claim and a settled decision may finish automatically.
pub(crate) fn evaluate(db: &Database, execution_id: &str) -> Result<Vec<Value>> {
    let session: String = db.conn().query_row(
        "SELECT session_id FROM plan_approvals WHERE execution_id=?1",
        [execution_id],
        |row| row.get(0),
    )?;
    let mut reasons = match crate::goal_reports::current_draft(db, execution_id) {
        Ok(Some(draft)) => match draft.get("verdict").and_then(Value::as_str) {
            Some("met") => vec![],
            Some(verdict) => vec![json!({"code":format!("verdict_{verdict}")})],
            None => vec![json!({"code":"report_invalid"})],
        },
        Ok(None) => vec![json!({"code":"report_missing"})],
        Err(error) => vec![json!({"code":"report_invalid","detail":error.to_string()})],
    };
    let turn: Option<String> = db
        .conn()
        .query_row(
            "SELECT turn_id FROM goal_reports WHERE execution_id=?1",
            [execution_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    // Use this execution's first turn after resume. Never borrow a newer goal's decision.
    let first = get_hold(db, &session, execution_id)?
        .and_then(|hold| hold.first_turn_id)
        .or(turn);
    if let Some(turn) = first {
        if let Some(decision) = crate::team::get_execution_decision(db, &session, &turn)? {
            if let Err(error) = crate::team::execution_inbox::require_settled(db, &decision) {
                if !error.to_string().starts_with("TEAM_APPROVAL_REQUIRED:") {
                    return Err(error);
                }
                let tasks = crate::team::execution_inbox::open_decision_tasks(db, &decision)?
                    .into_iter()
                    .map(|task| {
                        let mut value =
                            json!({"id":task.task_id,"title":task.subject,"status":task.status});
                        if let Some(owner) = task.owner_session_id {
                            value["assigneeId"] = json!(owner);
                        }
                        value
                    })
                    .collect::<Vec<_>>();
                reasons.push(
                    json!({"code":"team_unsettled","detail":error.to_string(),"tasks":tasks}),
                );
            }
        }
    }
    Ok(reasons)
}
