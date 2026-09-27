import { describe, expect, it } from "vitest";
import {
  executionFromResponse,
  executionListFromResponse,
  planExecutionFromUnknown,
} from "./plan-execution.js";

describe("planExecutionFromUnknown", () => {
  const validRecord = {
    id: "exec-1",
    proposalId: "prop-1",
    sessionId: "sess-1",
    kind: "goal",
    plan: "# Test Goal",
    title: "Test Goal",
    question: "Approve goal?",
    artifact: {
      relativePath: ".pi/goal/prop-1.md",
      sha256: "hash123",
      sizeBytes: 100,
    },
    targetPermissionMode: "bypass",
    state: "running",
  };

  it("decodes missing artifact workspaceKind as project", () => {
    const result = planExecutionFromUnknown(validRecord);
    expect(result).not.toBeNull();
    expect(result?.artifact.workspaceKind).toBe("project");
  });

  it("decodes explicit scratch workspaceKind", () => {
    const result = planExecutionFromUnknown({
      ...validRecord,
      artifact: {
        ...validRecord.artifact,
        workspaceKind: "scratch",
      },
    });
    expect(result).not.toBeNull();
    expect(result?.artifact.workspaceKind).toBe("scratch");
  });

  it("decodes explicit project workspaceKind", () => {
    const result = planExecutionFromUnknown({
      ...validRecord,
      artifact: {
        ...validRecord.artifact,
        workspaceKind: "project",
      },
    });
    expect(result).not.toBeNull();
    expect(result?.artifact.workspaceKind).toBe("project");
  });

  it("rejects explicitly invalid workspaceKind at the boundary", () => {
    expect(
      planExecutionFromUnknown({
        ...validRecord,
        artifact: {
          ...validRecord.artifact,
          workspaceKind: "invalid-kind",
        },
      }),
    ).toBeNull();

    expect(
      planExecutionFromUnknown({
        ...validRecord,
        artifact: {
          ...validRecord.artifact,
          workspaceKind: 123,
        },
      }),
    ).toBeNull();
  });

  it("rejects non-records or incomplete records", () => {
    expect(planExecutionFromUnknown(null)).toBeNull();
    expect(planExecutionFromUnknown(undefined)).toBeNull();
    expect(planExecutionFromUnknown("string")).toBeNull();
    expect(planExecutionFromUnknown({ ...validRecord, id: undefined })).toBeNull();
    expect(planExecutionFromUnknown({ ...validRecord, artifact: null })).toBeNull();
  });

  it("extracts from response envelopes", () => {
    expect(executionFromResponse({ execution: validRecord })?.id).toBe("exec-1");
    expect(executionFromResponse(validRecord)?.id).toBe("exec-1");
    expect(executionListFromResponse({ executions: [validRecord] })).toHaveLength(1);
    expect(executionListFromResponse([validRecord])).toHaveLength(1);
  });
});
