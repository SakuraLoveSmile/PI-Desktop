//! Keeps a background command alive once it announces a local server.
//!
//! A background command launched without a `timeout` runs under the 60-second
//! default. When the address detector reports that it serves a local address,
//! the Host adopts it: the deadline moves out to the server lifetime, within a
//! small number of slots. The loop that owns the deadline asks after every
//! output chunk and once more when the deadline fires. See ADR
//! background-server-adoption.

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::json;
use tokio::time::{Instant, Sleep};

use super::ToolsExecuteResult;

/// Adopted servers one session may keep running at the same time.
pub(crate) const MAX_ADOPTED_PER_SESSION: usize = 2;
/// Adopted servers the whole Host may keep running at the same time.
pub(crate) const MAX_ADOPTED_PER_HOST: usize = 2;

/// Which limit refused an adoption.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Cap {
    Session,
    Host,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Limits {
    pub(crate) per_session: usize,
    pub(crate) per_host: usize,
    /// How long an adopted server may run, counted from adoption. This is the
    /// largest `timeout` a model may ask for, so adoption grants nothing a
    /// model could not already request.
    pub(crate) lifetime: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            per_session: MAX_ADOPTED_PER_SESSION,
            per_host: MAX_ADOPTED_PER_HOST,
            lifetime: Duration::from_millis(super::MAX_BASH_TIMEOUT_MS),
        }
    }
}

#[derive(Debug, Default)]
struct Counts {
    host: usize,
    sessions: HashMap<String, usize>,
}

/// Counts the adopted servers of every session and of the Host.
#[derive(Debug)]
pub(crate) struct AdoptionLedger {
    limits: Limits,
    counts: Mutex<Counts>,
}

impl AdoptionLedger {
    pub(crate) fn new(limits: Limits) -> Self {
        Self {
            limits,
            counts: Mutex::default(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Counts> {
        // Bounded in-memory counting only; a poisoned lock still holds sound counts.
        self.counts.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Takes a slot for `session`. The session's own cap is reported first: it
    /// is the one its owner can act on.
    fn try_adopt(self: &Arc<Self>, session: &str) -> Result<AdoptionGrant, Cap> {
        let mut counts = self.lock();
        let held = counts.sessions.get(session).copied().unwrap_or(0);
        if held >= self.limits.per_session {
            return Err(Cap::Session);
        }
        if counts.host >= self.limits.per_host {
            return Err(Cap::Host);
        }
        counts.host += 1;
        counts.sessions.insert(session.to_string(), held + 1);
        Ok(AdoptionGrant {
            ledger: Arc::clone(self),
            session: session.to_string(),
        })
    }
}

impl Default for AdoptionLedger {
    fn default() -> Self {
        Self::new(Limits::default())
    }
}

/// One slot of the ledger. Dropping it returns the slot, so an exit, a stop, a
/// timeout, an abort and a task that unwinds all give it back.
#[derive(Debug)]
pub(crate) struct AdoptionGrant {
    ledger: Arc<AdoptionLedger>,
    session: String,
}

impl Drop for AdoptionGrant {
    fn drop(&mut self) {
        let mut counts = self.ledger.lock();
        counts.host = counts.host.saturating_sub(1);
        let emptied = match counts.sessions.get_mut(&self.session) {
            Some(held) => {
                *held = held.saturating_sub(1);
                *held == 0
            }
            None => false,
        };
        if emptied {
            counts.sessions.remove(&self.session);
        }
    }
}

/// What adoption did for one command, as the end message and the audit row tell it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AdoptionOutcome {
    /// Not eligible, or no address announced yet.
    NotAdopted,
    Adopted {
        lifetime_ms: u64,
    },
    CapReached {
        cap: Cap,
        limit: usize,
    },
}

impl AdoptionOutcome {
    pub(crate) fn audit_label(self) -> Option<&'static str> {
        match self {
            Self::NotAdopted => None,
            Self::Adopted { .. } => Some("adopted"),
            Self::CapReached { .. } => Some("cap_reached"),
        }
    }
}

/// The adoption state of one eligible command. It lives in the command's output
/// owner, which the execution loop already shares with the Host.
#[derive(Debug)]
pub(crate) struct ServerAdoption {
    ledger: Arc<AdoptionLedger>,
    session: String,
    outcome: AdoptionOutcome,
}

impl ServerAdoption {
    pub(crate) fn new(ledger: Arc<AdoptionLedger>, session: String) -> Self {
        Self {
            ledger,
            session,
            outcome: AdoptionOutcome::NotAdopted,
        }
    }

    /// True until the command is adopted; a refusal for lack of a slot is retried.
    pub(crate) fn pending(&self) -> bool {
        !matches!(self.outcome, AdoptionOutcome::Adopted { .. })
    }

    pub(crate) fn outcome(&self) -> AdoptionOutcome {
        self.outcome
    }

    /// One look at the command: once it has announced an address and a slot is
    /// free it is adopted, exactly once.
    pub(crate) fn poll(&mut self, address_seen: bool) -> Option<Adoption> {
        if !address_seen || !self.pending() {
            return None;
        }
        match self.ledger.try_adopt(&self.session) {
            Ok(grant) => {
                let lifetime = self.ledger.limits.lifetime;
                self.outcome = AdoptionOutcome::Adopted {
                    lifetime_ms: u64::try_from(lifetime.as_millis()).unwrap_or(u64::MAX),
                };
                Some(Adoption { lifetime, grant })
            }
            Err(cap) => {
                let limit = match cap {
                    Cap::Session => self.ledger.limits.per_session,
                    Cap::Host => self.ledger.limits.per_host,
                };
                self.outcome = AdoptionOutcome::CapReached { cap, limit };
                None
            }
        }
    }
}

/// The decision to keep a command alive: a new deadline and the slot that pays for it.
#[derive(Debug)]
pub(crate) struct Adoption {
    pub(crate) lifetime: Duration,
    grant: AdoptionGrant,
}

impl Adoption {
    /// Moves the pinned deadline out. The caller keeps the returned slot until
    /// the command's process tree is gone.
    pub(crate) fn apply(self, deadline: Pin<&mut Sleep>) -> AdoptionGrant {
        deadline.reset(Instant::now() + self.lifetime);
        self.grant
    }
}

/// Rewrites the timeout message of a command that was adopted, or says why it
/// was not. A result that is not a timeout, and one adoption never touched,
/// stays as it is; the default and explicit wordings are written elsewhere.
pub(crate) fn annotate_outcome(result: &mut ToolsExecuteResult, outcome: AdoptionOutcome) {
    if result.error_code.as_deref() != Some("TOOL_TIMEOUT") {
        return;
    }
    match outcome {
        AdoptionOutcome::NotAdopted => {}
        AdoptionOutcome::Adopted { lifetime_ms } => {
            result.content["error"] = json!(format!(
                "Background Bash stopped after the {} second server limit, counted from when it printed a local server address. Pass timeout in seconds (1-21600) to choose a different limit.",
                lifetime_ms / 1000
            ));
            result.content["timeoutMs"] = json!(lifetime_ms);
            result.content["timeoutIsDefault"] = json!(false);
        }
        AdoptionOutcome::CapReached { cap, limit } => {
            let holder = match cap {
                Cap::Session => "this session",
                Cap::Host => "the Host",
            };
            let servers = if limit == 1 { "server" } else { "servers" };
            let message = result.content["error"].as_str().unwrap_or_default();
            result.content["error"] = json!(format!(
                "{message} It printed a local server address but was not kept running, because {holder} already keeps {limit} {servers} running; stop one first or pass timeout in seconds (1-21600)."
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ledger(per_session: usize, per_host: usize, lifetime: Duration) -> Arc<AdoptionLedger> {
        Arc::new(AdoptionLedger::new(Limits {
            per_session,
            per_host,
            lifetime,
        }))
    }

    fn result(error_code: Option<&str>, error: &str) -> ToolsExecuteResult {
        ToolsExecuteResult {
            tool_call_id: "job".into(),
            ok: false,
            is_error: Some(true),
            content: json!({"error": error, "stdout": "retained"}),
            duration_ms: 60_000,
            denied: None,
            error_code: error_code.map(str::to_string),
            command_shell_id: None,
        }
    }

    #[test]
    fn the_ledger_keeps_each_session_and_the_host_within_their_caps() {
        let ledger = ledger(2, 3, Duration::from_secs(1));
        let first = ledger.try_adopt("a").unwrap();
        let second = ledger.try_adopt("a").unwrap();
        assert_eq!(ledger.try_adopt("a").unwrap_err(), Cap::Session);
        let other = ledger.try_adopt("b").unwrap();
        assert_eq!(ledger.try_adopt("b").unwrap_err(), Cap::Host);
        drop((first, second, other));
        assert!(ledger.try_adopt("b").is_ok());
    }

    #[test]
    fn a_slot_comes_back_when_its_grant_is_dropped_or_its_task_unwinds() {
        let ledger = ledger(1, 1, Duration::from_secs(1));
        drop(ledger.try_adopt("s").unwrap());
        let held = ledger.try_adopt("s").unwrap();
        assert_eq!(ledger.try_adopt("s").unwrap_err(), Cap::Session);
        drop(held);

        let task_ledger = Arc::clone(&ledger);
        let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _grant = task_ledger.try_adopt("s").unwrap();
            panic!("the execution task died");
        }));
        assert!(unwound.is_err());
        assert!(
            ledger.try_adopt("s").is_ok(),
            "the slot is returned when the task unwinds"
        );
    }

    #[test]
    fn a_command_is_adopted_once_and_only_after_it_announces_an_address() {
        let mut command = ServerAdoption::new(ledger(2, 2, Duration::from_secs(9)), "s".into());
        assert!(command.pending());
        assert!(command.poll(false).is_none());
        assert_eq!(command.outcome(), AdoptionOutcome::NotAdopted);

        let adoption = command.poll(true).expect("an address was announced");
        assert_eq!(adoption.lifetime, Duration::from_secs(9));
        assert_eq!(
            command.outcome(),
            AdoptionOutcome::Adopted { lifetime_ms: 9000 }
        );
        assert!(!command.pending());
        assert!(command.poll(true).is_none(), "adoption happens once");
    }

    #[test]
    fn a_full_ledger_refuses_and_a_slot_freed_in_time_is_still_used() {
        let ledger = ledger(1, 2, Duration::from_secs(9));
        let held = ledger.try_adopt("s").unwrap();
        let mut command = ServerAdoption::new(Arc::clone(&ledger), "s".into());
        assert!(command.poll(true).is_none());
        assert_eq!(
            command.outcome(),
            AdoptionOutcome::CapReached {
                cap: Cap::Session,
                limit: 1
            }
        );
        assert!(command.pending(), "a refusal is retried");

        drop(held);
        let adoption = command.poll(true).expect("a slot was freed in time");
        assert_eq!(
            command.outcome(),
            AdoptionOutcome::Adopted { lifetime_ms: 9000 }
        );
        drop(adoption);
    }

    #[test]
    fn the_default_limits_are_two_per_session_two_per_host_and_the_largest_timeout() {
        let limits = Limits::default();
        assert_eq!(limits.per_session, 2);
        assert_eq!(limits.per_host, 2);
        assert_eq!(
            limits.lifetime,
            Duration::from_millis(super::super::MAX_BASH_TIMEOUT_MS)
        );
    }

    #[test]
    fn the_end_message_names_the_server_limit_or_the_cap_and_nothing_else() {
        let mut adopted = result(Some("TOOL_TIMEOUT"), "bash timed out");
        annotate_outcome(
            &mut adopted,
            AdoptionOutcome::Adopted {
                lifetime_ms: 21_600_000,
            },
        );
        assert_eq!(adopted.content["timeoutMs"], 21_600_000);
        assert_eq!(adopted.content["timeoutIsDefault"], false);
        let message = adopted.content["error"].as_str().unwrap();
        assert!(message.contains("21600 second server limit"), "{message}");
        assert_eq!(adopted.content["stdout"], "retained");

        let mut refused = result(Some("TOOL_TIMEOUT"), "default wording stays");
        annotate_outcome(
            &mut refused,
            AdoptionOutcome::CapReached {
                cap: Cap::Session,
                limit: 2,
            },
        );
        let message = refused.content["error"].as_str().unwrap();
        assert!(message.starts_with("default wording stays"), "{message}");
        assert!(
            message.contains("this session already keeps 2 servers"),
            "{message}"
        );
        assert!(refused.content.get("timeoutMs").is_none());

        for untouched in [
            result(Some("TOOL_TIMEOUT"), "bash timed out"),
            result(Some("TOOL_ABORTED"), "bash aborted"),
            result(None, "failed"),
        ] {
            let mut copy = result(untouched.error_code.as_deref(), "same");
            annotate_outcome(&mut copy, AdoptionOutcome::NotAdopted);
            assert_eq!(copy.content["error"], "same");
        }
        let mut stopped = result(Some("TOOL_ABORTED"), "bash aborted");
        annotate_outcome(
            &mut stopped,
            AdoptionOutcome::Adopted {
                lifetime_ms: 21_600_000,
            },
        );
        assert_eq!(stopped.content["error"], "bash aborted");
        assert!(stopped.content.get("timeoutMs").is_none());
    }

    #[test]
    fn the_audit_label_is_present_only_when_adoption_did_something() {
        assert_eq!(AdoptionOutcome::NotAdopted.audit_label(), None);
        assert_eq!(
            AdoptionOutcome::Adopted { lifetime_ms: 1 }.audit_label(),
            Some("adopted")
        );
        assert_eq!(
            AdoptionOutcome::CapReached {
                cap: Cap::Host,
                limit: 2
            }
            .audit_label(),
            Some("cap_reached")
        );
    }

    #[tokio::test]
    async fn an_adoption_moves_a_pinned_deadline_out() {
        let mut command = ServerAdoption::new(ledger(1, 1, Duration::from_millis(500)), "s".into());
        let deadline = tokio::time::sleep(Duration::from_millis(30));
        tokio::pin!(deadline);
        let slot = command
            .poll(true)
            .expect("adopted")
            .apply(deadline.as_mut());
        let early = tokio::time::timeout(Duration::from_millis(150), deadline.as_mut()).await;
        assert!(
            early.is_err(),
            "the original 30 ms deadline no longer fires"
        );
        drop(slot);
    }
}
