import { describe, expect, it } from "vitest";
import { formatAskToolOutput, normalizeInteractionRequiredDetails, type AskToolQuestion } from "./types.js";

describe("asktool output", () => {
  const questions: AskToolQuestion[] = [
    { question: "Preferred color?", options: ["Blue", "Green"] },
    {
      question: "Which platforms?",
      options: [
        { label: "**Web**", description: "Runs in a browser." },
        { label: "Desktop", description: "Installs on the user's computer." },
      ],
      multiSelect: true,
    },
  ];

  it("serializes each question with selected answers and a stable separator", () => {
    expect(formatAskToolOutput(questions, [["Blue"], ["**Web**", "Desktop"]])).toBe(
      "Preferred color?：Blue\n---\nWhich platforms?：**Web**、Desktop",
    );
  });

  it("keeps skipped answers as empty placeholders", () => {
    expect(formatAskToolOutput(questions, [null, ["Desktop"]])).toBe(
      "Preferred color?：\n---\nWhich platforms?：Desktop",
    );
  });
});

describe("durable unattended error details", () => {
  const valid = { kind: "interaction_required", toolName: "asktool", toolCallId: "ask", questions: [{ question: "Choose?", options: ["Yes"] }] };
  it("keeps only the normalized public question fields", () => {
    expect(normalizeInteractionRequiredDetails({ ...valid, rawArguments: { secret: "hidden" }, questions: [{ question: " Choose? ", options: [{ label: " Yes ", description: " Good ", raw: "hidden" }], raw: "hidden" }] })).toEqual({ ...valid, questions: [{ question: "Choose?", options: [{ label: "Yes", description: "Good" }] }] });
  });
  it("retains invalid-arguments markers without raw arguments", () => {
    expect(normalizeInteractionRequiredDetails({ ...valid, questions: [], invalidArguments: true, raw: "hidden" })).toEqual({ ...valid, questions: [], invalidArguments: true });
  });
  it("rejects unusable, oversized, or inconsistent payloads", () => {
    for (const details of [null, true, { ...valid, questions: [] }, { ...valid, kind: "other" }, { ...valid, toolName: "Bash" }, { ...valid, toolCallId: "" }, { ...valid, invalidArguments: true }, { ...valid, questions: [{ question: "Q", options: [true] }] }, { ...valid, questions: [{ question: "x".repeat(65536), options: ["Yes"] }] }]) expect(normalizeInteractionRequiredDetails(details)).toBeUndefined();
  });
});
