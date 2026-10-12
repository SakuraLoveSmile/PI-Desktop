use super::host_notices::send_pending;
use crate::sessions;
use crate::team::member_silence_tests::fixture;
use serde_json::Value;
use tokio::sync::mpsc;

#[test]
fn silent_completion_wakes_once_and_terminal_replay_keeps_the_same_notice() {
    let (db, lead, _, _, turn) = fixture();
    let (tx, mut rx) = mpsc::unbounded_channel();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    send_pending(&db, &tx, &turn).unwrap();
    let event: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
    assert_eq!(event["method"], "team.messageQueued");
    assert_eq!(event["params"]["teamSessionId"], lead);
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    send_pending(&db, &tx, &turn).unwrap();
    assert!(rx.try_recv().is_err());
    let notices: Vec<_> = crate::team::list_member_messages(&db, &lead, &lead)
        .unwrap()
        .into_iter()
        .filter(|message| {
            serde_json::from_str::<Value>(&message.content)
                .ok()
                .is_some_and(|body| body["kind"] == "member_ended_without_report")
        })
        .collect();
    assert_eq!(notices.len(), 1);
    assert_eq!(event["params"]["messageId"], notices[0].id);
}

#[test]
fn closed_transport_retains_silent_notice_for_retry() {
    let (db, _, _, _, turn) = fixture();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    let (closed, rx) = mpsc::unbounded_channel();
    drop(rx);
    assert!(send_pending(&db, &closed, &turn).is_err());
    let (tx, mut rx) = mpsc::unbounded_channel();
    send_pending(&db, &tx, &turn).unwrap();
    assert!(rx.try_recv().is_ok());
    send_pending(&db, &tx, &turn).unwrap();
    assert!(rx.try_recv().is_err());
}

#[test]
fn silent_wake_survives_postcommit_checkpoint_error() {
    let (db, _, _, member, turn) = fixture();
    let checkpoint = crate::transcripts::inflight_path(db.data_dir(), &member).unwrap();
    std::fs::create_dir_all(&checkpoint).unwrap();
    assert!(sessions::end_turn(&db, &turn, "completed", None, None, false).is_err());
    assert!(sessions::running_turn_id(&db, &member).unwrap().is_none());
    let (tx, mut rx) = mpsc::unbounded_channel();
    send_pending(&db, &tx, &turn).unwrap();
    assert!(rx.try_recv().is_ok());
    std::fs::remove_dir(&checkpoint).unwrap();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    send_pending(&db, &tx, &turn).unwrap();
    assert!(rx.try_recv().is_err());
}
