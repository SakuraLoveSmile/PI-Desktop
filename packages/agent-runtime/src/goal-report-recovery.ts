import { recoverFinalAnswer, type FinalAnswerRecovery } from "./final-answer-recovery.js";

const GOAL_REPORT_NUDGE = [
  "<goal_report_recovery>",
  "The approved Goal execution has no valid structured report: it was missing, invalidated by later work, or contradicted by the latest progress snapshot.",
  "Reconcile the existing checklist with UpdateGoalProgress using the work and checks actually observed, then call SubmitGoalReport now.",
  "Use partial or blocked if work remains incomplete; do not claim met or mark unfinished items completed merely to submit a report.",
  "A partial or blocked verdict keeps the Goal blocked, waiting for the user. In limitations and nextSteps, state exactly what the user needs to provide or decide before execution can continue.",
  "Avoid further evidence-changing tools after submission, or submit a replacement report afterward. This is the single automatic report recovery attempt.",
  "</goal_report_recovery>",
].join("\n");

/** One report recovery budget per approved execution segment; the runtime owns I/O. */
export class GoalReportRecovery {
  pending = false;
  inProgress = false;
  suppressRunEnd = false;
  private attempted = false;

  reset(): void {
    this.pending = false;
    this.inProgress = false;
    this.suppressRunEnd = false;
    this.attempted = false;
  }

  arm(): boolean {
    if (this.attempted) return false;
    this.attempted = true;
    this.pending = true;
    this.suppressRunEnd = true;
    return true;
  }

  async recover(runtime: FinalAnswerRecovery): Promise<void> {
    if (!this.pending) return;
    this.pending = false;
    this.suppressRunEnd = false;
    this.inProgress = true;
    try {
      await recoverFinalAnswer(GOAL_REPORT_NUDGE, runtime);
    } finally {
      this.inProgress = false;
      this.suppressRunEnd = false;
    }
  }
}
