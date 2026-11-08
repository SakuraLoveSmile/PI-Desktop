//! Command matching for Goals that carry no approval-bound command list.
//!
//! The model's evidence references are only a hint here. The Host looks for the
//! check's own command among the Bash runs of this execution and lets the last
//! run that ended with a verdict decide, so a model that skips the references,
//! or cites an earlier run, cannot leave a stale observation behind.

use super::{Cited, Gap, Judged, Judgment, Verdict};
use crate::goal_reports::tool_index::ToolRunIndex;

/// Settles one check. `cited` is where the check's evidence references led.
pub(super) fn settle<'a>(index: &'a ToolRunIndex, command: &str, cited: Cited<'a>) -> Verdict {
    let runs = index.bash_runs(command);
    let found = runs.len();
    let finished: Vec<Judged<'a>> = runs.into_iter().filter_map(Judged::of).collect();
    let finished_count = finished.len();
    let last = finished.into_iter().next_back();
    match (cited, last) {
        (Cited::Run(cited), Some(last)) if !cited.call.is_same_call(&last.call) => {
            Verdict::Conclusive(last.decides(finished_count, Some(&cited)))
        }
        // The cited run is the last one, so the reference already said it all.
        (Cited::Run(cited), _) => Verdict::Conclusive(cited.judgment),
        (_, Some(last)) => Verdict::Conclusive(last.decides(finished_count, None)),
        (Cited::Ambiguous, None) => Verdict::Inconclusive(Gap::Ambiguous),
        (Cited::Nothing, None) if found == 0 => Verdict::Inconclusive(Gap::NoRun),
        (Cited::Nothing, None) => Verdict::Inconclusive(Gap::NoFinishedRun(found)),
    }
}

impl Judged<'_> {
    /// The judgment of the run that decides the check, with how it was found.
    /// `replaced` is the earlier run the check cited, when there was one.
    fn decides(self, finished: usize, replaced: Option<&Judged<'_>>) -> Judgment {
        let rank = if finished == 1 {
            "its only finished run".to_string()
        } else {
            format!("the last of its {finished} finished runs")
        };
        let replaces = replaced
            .map(|cited| {
                let (id, result) = (cited.call.id(), cited.judgment.result);
                format!(" and replaces the cited tool call {id} ({result})")
            })
            .unwrap_or_default();
        let detail = format!(
            "{} Matched by the check command: tool call {} is {rank} in this execution{replaces}.",
            self.judgment.detail,
            self.call.id(),
        );
        Judgment {
            detail,
            ..self.judgment
        }
    }
}
