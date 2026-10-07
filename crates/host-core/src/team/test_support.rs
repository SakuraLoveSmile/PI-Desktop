//! Shared fixtures for current-review expert delegation and real mailbox turns.
use super::{
    mailbox::{send_team_message, SendMessageParams},
    model::TeamProposedMember,
};
use crate::{db::Database, session_collaboration, sessions};

pub(super) fn expert_proposal(name: &str) -> TeamProposedMember {
    TeamProposedMember {
        name: name.into(),
        description: None,
        context_kind: None,
        member_session_id: None,
        presentation: None,
        selection: None,
    }
}

pub(super) fn complete_approved_expert_turn(db: &Database, lead: &str, member: &str) {
    let message = send_team_message(
        db,
        SendMessageParams {
            team_session_id: lead,
            caller_session_id: lead,
            target_identifier: member,
            content: "Inspect current approved task",
            idempotency_key: None,
        },
    )
    .unwrap();
    super::authority::record_dispatch(db, lead, &message, false).unwrap();
    let turn = session_collaboration::begin_turn(db, member, &message.id, None, None).unwrap();
    sessions::end_turn(db, &turn, "completed", None, None, false).unwrap();
    session_collaboration::settle_turn(db, &turn).unwrap();
}
