import { describe, expect, it } from "vitest";
import {
  isSessionSummaryNote,
  isSessionSummaryRefreshResult,
  isSessionSummaryState,
  type SessionSummaryNote,
} from "./session-summary.js";

const note = (patch: Partial<SessionSummaryNote> = {}): SessionSummaryNote => ({
  sessionId: "s1",
  text: "Working on the importer.",
  revision: 1,
  basedOnMessageCount: 4,
  updatedAt: "2026-11-22T06:05:00.000Z",
  behind: 0,
  diverged: false,
  ...patch,
});

describe("session summary note validation", () => {
  it("accepts a well-formed note and rejects every malformed field", () => {
    expect(isSessionSummaryNote(note())).toBe(true);
    for (const bad of [
      note({ sessionId: "" }),
      note({ text: "   " }),
      note({ text: "x".repeat(2001) }),
      note({ revision: 0 }),
      note({ revision: 1.5 }),
      note({ basedOnMessageCount: -1 }),
      note({ updatedAt: "yesterday" }),
      note({ behind: Number.MAX_SAFE_INTEGER + 1 }),
      { ...note(), diverged: "no" },
      null,
      [],
      "note",
    ]) {
      expect(isSessionSummaryNote(bad)).toBe(false);
    }
  });

  it("measures the text limit in UTF-8 bytes, as the Host does", () => {
    expect(isSessionSummaryNote(note({ text: "字".repeat(666) }))).toBe(true);
    expect(isSessionSummaryNote(note({ text: "字".repeat(667) }))).toBe(false);
  });

  it("requires a state to carry a count and either a valid note or null", () => {
    expect(isSessionSummaryState({ summary: null, messageCount: 0 })).toBe(true);
    expect(isSessionSummaryState({ summary: note(), messageCount: 6 })).toBe(true);
    expect(isSessionSummaryState({ summary: note(), messageCount: -1 })).toBe(false);
    expect(isSessionSummaryState({ summary: { text: "no shape" }, messageCount: 1 })).toBe(false);
    expect(isSessionSummaryState({ messageCount: 1 })).toBe(false);
  });

  it("knows the refresh outcomes and the reasons a run is skipped", () => {
    expect(isSessionSummaryRefreshResult({ outcome: "updated", summary: note({ revision: 2 }) })).toBe(true);
    for (const reason of ["disabled", "no-content", "not-behind", "too-soon", "conflict"]) {
      expect(isSessionSummaryRefreshResult({ outcome: "skipped", reason, summary: null })).toBe(true);
      expect(isSessionSummaryRefreshResult({ outcome: "skipped", reason, summary: note() })).toBe(true);
    }
    expect(isSessionSummaryRefreshResult({ outcome: "skipped", reason: "bored", summary: null })).toBe(false);
    expect(isSessionSummaryRefreshResult({ outcome: "updated", summary: null })).toBe(false);
    expect(isSessionSummaryRefreshResult({ outcome: "unchanged", summary: note() })).toBe(false);
    expect(isSessionSummaryRefreshResult(undefined)).toBe(false);
  });
});
