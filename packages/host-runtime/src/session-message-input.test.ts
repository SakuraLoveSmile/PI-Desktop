import { describe, expect, it } from "vitest";
import { resolveSessionMessageInput } from "./session-message-input.js";
import { formatSessionMessage } from "@pi-desktop/shared";

describe("Host-owned Team dispatch HEAD", () => {
  it("carries the send-time HEAD in the real model framing without changing body", async () => {
    const senderHead = "a".repeat(40);
    const content = "Inspect assigned source";
    const host = { async call<T>() {
      return { message: { id: "dispatch", sourceSessionId: "lead", sourceTitle: "Lead", targetSessionId: "member", kind: "message", content, status: "queued", senderHead } } as T;
    } };
    const input = await resolveSessionMessageInput(host, { sessionId: "member", sessionMessageId: "dispatch" });
    expect(input?.content).toBe(content);
    expect(input?.origin).toMatchObject({ senderHead });
    expect(formatSessionMessage(input!.content, input!.origin)).toContain(`"senderHead":"${senderHead}"`);
  });
  it("leaves old messages and non-Git senders compatible", async () => {
    const host = { async call<T>() {
      return { message: { id: "dispatch", sourceSessionId: "lead", sourceTitle: "Lead", targetSessionId: "member", kind: "message", content: "Inspect source", status: "queued" } } as T;
    } };
    const input = await resolveSessionMessageInput(host, { sessionId: "member", sessionMessageId: "dispatch" });
    expect(input?.origin).not.toHaveProperty("senderHead");
  });
});
