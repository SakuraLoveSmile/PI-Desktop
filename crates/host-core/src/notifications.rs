use anyhow::Result;
use rusqlite::{params, OptionalExtension, Transaction};
use serde::Serialize;
use uuid::Uuid;

use crate::db::{ms_to_ts, now_ms, Database, NOTIFICATION_KEEP};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: String,
    pub kind: String,
    pub session_id: String,
    pub session_title: String,
    pub turn_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_at: Option<String>,
}

fn notification_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Notification> {
    Ok(Notification {
        id: row.get(0)?,
        kind: row.get(1)?,
        session_id: row.get(2)?,
        session_title: row.get(3)?,
        turn_id: row.get(4)?,
        error_code: row.get(5)?,
        created_at: ms_to_ts(row.get(6)?),
        read_at: row.get::<_, Option<i64>>(7)?.map(ms_to_ts),
    })
}

const NOTIFICATION_SELECT: &str =
    "SELECT n.id, n.kind, n.session_id, n.session_title, n.turn_id, n.error_code,
            n.created_at, n.read_at
     FROM notifications n";

/// Insert a durable user notification for a newly terminal turn. The caller owns the
/// transaction so the turn update and notification cannot diverge.
pub fn insert_for_terminal_turn(
    tx: &Transaction<'_>,
    turn_id: &str,
    status: &str,
    error_code: Option<&str>,
) -> Result<Option<Notification>> {
    let kind = match status {
        "completed" => "task.completed",
        "error" => "task.failed",
        _ => return Ok(None),
    };
    let Some((session_id, session_title, is_team_member)) = tx
        .query_row(
            "SELECT t.session_id, s.title,
                    EXISTS(SELECT 1 FROM team_members m WHERE m.member_session_id = s.id)
             FROM turns t JOIN sessions s ON s.id = t.session_id
             WHERE t.id = ?1",
            params![turn_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            },
        )
        .optional()?
    else {
        return Ok(None);
    };
    // Experts report through the Team mailbox. Their successful turns keep
    // durable turn/transcript facts without a separate completion alert.
    if status == "completed" && is_team_member {
        return Ok(None);
    }

    let id = Uuid::new_v4().to_string();
    let created_at = now_ms();
    let inserted = tx
        .prepare_cached(
            "INSERT INTO notifications
                (id, kind, session_id, session_title, turn_id, error_code, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(turn_id) DO NOTHING",
        )?
        .execute(params![
            id,
            kind,
            session_id,
            session_title,
            turn_id,
            error_code,
            created_at
        ])?;
    if inserted == 0 {
        return Ok(None);
    }

    tx.execute(
        "DELETE FROM notifications
         WHERE id IN (
           SELECT id FROM notifications
           ORDER BY created_at DESC, id DESC
           LIMIT -1 OFFSET ?1
         )",
        params![NOTIFICATION_KEEP],
    )?;

    Ok(Some(Notification {
        id,
        kind: kind.to_string(),
        session_id,
        session_title,
        turn_id: turn_id.to_string(),
        error_code: error_code.map(str::to_string),
        created_at: ms_to_ts(created_at),
        read_at: None,
    }))
}

pub fn list(db: &Database, unread_only: bool, limit: i64) -> Result<(Vec<Notification>, i64)> {
    let limit = limit.clamp(1, NOTIFICATION_KEEP);
    let sql = if unread_only {
        format!(
            "{NOTIFICATION_SELECT}
             WHERE n.read_at IS NULL
             ORDER BY n.created_at DESC, n.id DESC LIMIT ?1"
        )
    } else {
        format!(
            "{NOTIFICATION_SELECT}
             ORDER BY n.created_at DESC, n.id DESC LIMIT ?1"
        )
    };
    let mut stmt = db.conn().prepare_cached(&sql)?;
    let rows = stmt.query_map(params![limit], notification_from_row)?;
    let notifications = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    let unread_count = db.conn().query_row(
        "SELECT COUNT(*) FROM notifications WHERE read_at IS NULL",
        [],
        |row| row.get(0),
    )?;
    Ok((notifications, unread_count))
}

pub fn mark_read(db: &Database, id: &str) -> Result<bool> {
    let updated = db
        .conn()
        .prepare_cached("UPDATE notifications SET read_at = COALESCE(read_at, ?1) WHERE id = ?2")?
        .execute(params![now_ms(), id])?;
    Ok(updated > 0)
}

pub fn mark_all_read(db: &Database) -> Result<()> {
    db.conn()
        .prepare_cached("UPDATE notifications SET read_at = ?1 WHERE read_at IS NULL")?
        .execute(params![now_ms()])?;
    Ok(())
}

pub fn clear(db: &Database) -> Result<()> {
    db.conn().execute("DELETE FROM notifications", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions;

    fn test_db() -> Database {
        let dir = std::env::temp_dir().join(format!("pi-desktop-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Database::open(&dir.join("test.sqlite")).unwrap()
    }

    #[test]
    fn expert_success_keeps_turn_and_report_facts_without_a_separate_notification() {
        use crate::team;
        use serde_json::json;

        let data = tempfile::tempdir().unwrap();
        let path = data.path().join("test.sqlite");
        let db = Database::open(&path).unwrap();
        db.conn().execute(
            "INSERT INTO providers (id, name, config_json, created_at, updated_at) VALUES ('fixture', 'Fixture', ?1, 0, 0)",
            [json!({"models":[{"id":"fixture-model","thinkingLevels":[]}]}).to_string()],
        ).unwrap();
        let lead = sessions::create_session_with_options(
            &db,
            sessions::SessionCreateOptions {
                title: Some("Team Lead".into()),
                mode: Some("agent".into()),
                execution_profile: Some("team".into()),
                provider_id: Some("fixture".into()),
                model_id: Some("fixture-model".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let lead_turn = sessions::begin_turn(&db, &lead.id, None, None).unwrap();
        let proposal = serde_json::from_value(json!({"name":"expert"})).unwrap();
        let (_, review) = team::declare_team_strategy(
            &db,
            team::DeclareStrategyParams {
                team_session_id: &lead.id,
                caller_session_id: &lead.id,
                lead_turn_id: &lead_turn,
                strategy: "delegate",
                reason: "Run one approved expert",
                members: Some(vec![proposal]),
            },
        )
        .unwrap();
        let review = review.unwrap();
        let (_, decision) =
            team::confirm_launch_review(&db, &lead.id, &review.review_id, review.revision).unwrap();
        let expert = &decision.member_session_ids[0];
        let turn = sessions::begin_turn(&db, expert, None, None).unwrap();
        let reply = serde_json::from_value(json!({"id":"expert-reply","role":"assistant","content":"Completed the assigned work","createdAt":"2026-10-11T00:00:00Z","status":"complete"})).unwrap();
        sessions::append_message(&db, expert, &reply, Some(&turn)).unwrap();
        let report = team::send_team_message(
            &db,
            team::SendMessageParams {
                team_session_id: &lead.id,
                caller_session_id: expert,
                target_identifier: &lead.id,
                content: "The expert completed the assigned work",
                idempotency_key: Some("expert-report"),
            },
        )
        .unwrap();
        let result = sessions::end_turn(&db, &turn, "completed", None, None, true).unwrap();
        assert!(result.updated);
        assert!(result.notification.is_none());
        assert!(list(&db, false, 50).unwrap().0.is_empty());
        assert_eq!(list(&db, true, 50).unwrap().1, 0);
        let stored_status: String = db
            .conn()
            .query_row("SELECT status FROM turns WHERE id=?1", [&turn], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored_status, "completed");
        let transcript = sessions::get_session(&db, expert).unwrap().unwrap();
        assert_eq!(transcript.messages.len(), 1);
        assert_eq!(transcript.messages[0].content, reply.content);
        assert_eq!(
            team::get_team_member_by_session_id(&db, expert)
                .unwrap()
                .unwrap()
                .phase,
            "completed"
        );
        assert_eq!(
            team::get_team_message(&db, &lead.id, &lead.id, &report.id)
                .unwrap()
                .unwrap()
                .content,
            report.content
        );
        let duplicate = sessions::end_turn(&db, &turn, "completed", None, None, true).unwrap();
        assert!(!duplicate.updated);
        assert!(duplicate.notification.is_none());

        let failed = sessions::begin_turn(&db, expert, None, None).unwrap();
        let failure =
            sessions::end_turn(&db, &failed, "error", Some("MODEL_ERROR"), None, true).unwrap();
        let notification = failure.notification.unwrap();
        assert_eq!(notification.kind, "task.failed");
        assert_eq!(notification.error_code.as_deref(), Some("MODEL_ERROR"));
        assert_eq!(list(&db, true, 50).unwrap().1, 1);
        let completed = sessions::end_turn(&db, &lead_turn, "completed", None, None, true).unwrap();
        assert_eq!(completed.notification.unwrap().kind, "task.completed");
        assert_eq!(list(&db, true, 50).unwrap().1, 2);
        drop(db);
        let reopened = Database::open(&path).unwrap();
        let (items, unread) = list(&reopened, false, 50).unwrap();
        assert_eq!(unread, 2);
        assert!(!items.iter().any(|item| item.turn_id == turn));
        assert_eq!(
            sessions::get_session(&reopened, expert)
                .unwrap()
                .unwrap()
                .messages[0]
                .content,
            reply.content
        );
    }

    #[test]
    fn lead_goal_and_standard_success_notifications_are_preserved() {
        let data = tempfile::tempdir().unwrap();
        let db = Database::open(&data.path().join("test.sqlite")).unwrap();
        for (mode, profile) in [("agent", "team"), ("goal", "team"), ("agent", "standard")] {
            let session = sessions::create_session_with_options(
                &db,
                sessions::SessionCreateOptions {
                    title: Some("Expert-looking title".into()),
                    mode: Some(mode.into()),
                    execution_profile: Some(profile.into()),
                    ..Default::default()
                },
            )
            .unwrap();
            let turn = sessions::begin_turn(&db, &session.id, None, None).unwrap();
            let result = sessions::end_turn(&db, &turn, "completed", None, None, true).unwrap();
            assert_eq!(result.notification.unwrap().kind, "task.completed");
        }
        assert_eq!(list(&db, true, 50).unwrap().1, 3);
    }

    #[test]
    fn list_read_and_clear_lifecycle() {
        let db = test_db();
        let session =
            sessions::create_session(&db, Some("Build release".into()), None, None, None, None)
                .unwrap();
        let completed = sessions::begin_turn(&db, &session.id, None, None).unwrap();
        let completed_result =
            sessions::end_turn(&db, &completed, "completed", None, None, true).unwrap();
        assert_eq!(
            completed_result.notification.unwrap().kind,
            "task.completed"
        );
        let failed = sessions::begin_turn(&db, &session.id, None, None).unwrap();
        let failed_result =
            sessions::end_turn(&db, &failed, "error", Some("MODEL_ERROR"), None, true).unwrap();
        assert_eq!(failed_result.notification.unwrap().kind, "task.failed");
        assert!(sessions::rename_session(&db, &session.id, "Renamed session").unwrap());

        let (all, unread) = list(&db, false, 50).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(unread, 2);
        let failed_notification = all
            .iter()
            .find(|notification| notification.kind == "task.failed")
            .unwrap();
        assert_eq!(failed_notification.session_title, "Build release");
        assert_eq!(
            failed_notification.error_code.as_deref(),
            Some("MODEL_ERROR")
        );

        assert!(mark_read(&db, &failed_notification.id).unwrap());
        assert!(!mark_read(&db, "missing").unwrap());
        let (unread_items, unread) = list(&db, true, 50).unwrap();
        assert_eq!(unread_items.len(), 1);
        assert_eq!(unread, 1);

        mark_all_read(&db).unwrap();
        assert_eq!(list(&db, true, 50).unwrap().1, 0);
        clear(&db).unwrap();
        assert!(list(&db, false, 50).unwrap().0.is_empty());
    }

    #[test]
    fn terminal_turns_keep_only_the_latest_two_hundred_notifications() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite");
        let db = Database::open(&path).unwrap();
        let session =
            sessions::create_session(&db, Some("Long task".into()), None, None, None, None)
                .unwrap();

        for _ in 0..201 {
            let turn = sessions::begin_turn(&db, &session.id, None, None).unwrap();
            let result = sessions::end_turn(&db, &turn, "completed", None, None, true).unwrap();
            assert!(result.notification.is_some());
        }

        let stored: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM notifications", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, NOTIFICATION_KEEP);
        assert_eq!(list(&db, false, 500).unwrap().0.len(), 200);

        drop(db);
        let reopened = Database::open(&path).unwrap();
        let stored_after_restart: i64 = reopened
            .conn()
            .query_row("SELECT COUNT(*) FROM notifications", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored_after_restart, NOTIFICATION_KEEP);
    }
}
