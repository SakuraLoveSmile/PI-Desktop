use serde::Serialize;

use super::{BudgetState, Request, ToolClass};

/// Captured at rejection under the admission lock. Commands and paths never
/// enter the budget, so these diagnostics cannot expose their contents.
#[derive(Debug, Serialize)]
pub struct ShellCapacityDiagnostics {
    host: CapacityCounts,
    session: CapacityCounts,
    holders: Vec<ShellHolder>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CapacityCounts {
    in_flight: usize,
    queued: usize,
    shell_in_flight: usize,
    shell_queued: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellHolder {
    session_id: String,
    tool: &'static str,
    in_flight: usize,
}

impl ShellCapacityDiagnostics {
    pub(super) fn capture(state: &BudgetState, request: &Request) -> Option<Self> {
        if request.class != ToolClass::Shell {
            return None;
        }
        let waiting = state.waiting.iter().filter(|entry| !entry.granted);
        let usage = state.sessions.get(&request.session_id);
        let mut holders: Vec<_> = state
            .sessions
            .iter()
            .filter_map(|(session_id, usage)| {
                let count = usage.classes[ToolClass::Shell as usize];
                (count > 0).then(|| ShellHolder {
                    session_id: session_id.clone(),
                    tool: "Bash",
                    in_flight: count,
                })
            })
            .collect();
        holders.sort_by(|a, b| a.session_id.cmp(&b.session_id));
        Some(Self {
            host: CapacityCounts {
                in_flight: state.active,
                queued: state.queued,
                shell_in_flight: state.classes[ToolClass::Shell as usize],
                shell_queued: waiting
                    .clone()
                    .filter(|entry| entry.request.class == ToolClass::Shell)
                    .count(),
            },
            session: CapacityCounts {
                in_flight: usage.map_or(0, |usage| usage.active),
                queued: waiting
                    .clone()
                    .filter(|entry| entry.request.session_id == request.session_id)
                    .count(),
                shell_in_flight: usage.map_or(0, |usage| usage.classes[ToolClass::Shell as usize]),
                shell_queued: waiting
                    .filter(|entry| {
                        entry.request.session_id == request.session_id
                            && entry.request.class == ToolClass::Shell
                    })
                    .count(),
            },
            holders,
        })
    }

    pub(super) fn guidance(&self) -> String {
        let holders = self
            .holders
            .iter()
            .map(|holder| format!("{}:Bash x{}", holder.session_id, holder.in_flight))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "; host: {} in-flight, {} queued (Bash: {} in-flight, {} queued); session: {} in-flight, {} queued (Bash: {} in-flight, {} queued); shell holders: [{}]. Background processes and long sleep hold a shell slot until they stop. Do not poll with sleep; use wait_for_updates for teammate replies, or run a long command in the background and check its process status after capacity returns. Retry after an active process finishes or is explicitly stopped; background execution uses the same capacity.",
            self.host.in_flight, self.host.queued, self.host.shell_in_flight, self.host.shell_queued,
            self.session.in_flight, self.session.queued, self.session.shell_in_flight, self.session.shell_queued, holders,
        )
    }
}
