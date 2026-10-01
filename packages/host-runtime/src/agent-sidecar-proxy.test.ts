import { describe, expect, it } from "vitest";
import { isHostProxyAllowed } from "./agent-sidecar.js";

describe("sidecar host proxy allowlist", () => {
  it("allows the Team RPCs used by the Team runtime", () => {
    expect([
      "team.createMember",
      "team.createTask",
      "team.declareStrategy",
      "team.getBoard",
      "team.getExecutionDecision",
      "team.getLaunchReview",
      "team.getRoster",
      "team.interruptMember",
      "team.listMessages",
      "team.sendMessage",
      "team.updateTask",
      "goalReports.submitDraft",
      "goalReports.invalidateDraft",
      "goalReports.markFailed",
    ].every(isHostProxyAllowed)).toBe(true);
  });

  it("keeps unrelated state and arbitrary Team mutations outside the proxy", () => {
    expect(isHostProxyAllowed("settings.set")).toBe(false);
    expect(isHostProxyAllowed("session.delete")).toBe(false);
    expect(isHostProxyAllowed("team.pause")).toBe(false);
    expect(isHostProxyAllowed("team.ackMessage")).toBe(false);
    expect(isHostProxyAllowed("team.updateLaunchReview")).toBe(false);
    expect(isHostProxyAllowed("team.confirmLaunchReview")).toBe(false);
    expect(isHostProxyAllowed("team.cancelLaunchReview")).toBe(false);
    expect(isHostProxyAllowed("goalReports.get")).toBe(false);
    expect(isHostProxyAllowed("goalReports.retry")).toBe(false);
  });
});
