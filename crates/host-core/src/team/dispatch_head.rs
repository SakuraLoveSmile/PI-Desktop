//! A Host-only send-time Git stamp. It never changes the immutable message body.
use crate::db::Database;
use anyhow::Result;
use rusqlite::{params, Connection};
use serde_json::json;

pub(crate) const NS: &str = "team-dispatch-head-v1";

pub(crate) fn record(db: &Database, message_id: &str, head: Option<&str>) -> Result<()> {
    if let Some(head) = head {
        db.conn().execute("INSERT INTO kv(ns,key,value_json,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(ns,key) DO NOTHING",
            params![NS,message_id,json!({"sha":head}).to_string(),crate::db::now_ms()])?;
    }
    Ok(())
}

pub(crate) fn cleanup_session(conn: &Connection, session: &str) -> Result<()> {
    conn.execute("DELETE FROM kv WHERE ns=?1 AND key IN (SELECT id FROM session_collaboration_messages WHERE source_session_id=?2 OR target_session_id=?2)",params![NS,session])?;
    Ok(())
}
