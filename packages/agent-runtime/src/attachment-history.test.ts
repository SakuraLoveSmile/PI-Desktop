import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import os from "node:os";
import type { UiMessage } from "@pi-desktop/shared";
import { excludeCurrentPrompt, hydrateAttachmentHistory, readFileAtRecordedSize } from "./attachment-history.js";

async function withTempDir(run: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(os.tmpdir(), "test-attachment-history-"));
  try { await run(path); } finally { await rm(path, { recursive: true, force: true }); }
}

function userMessage(id: string, attachments: NonNullable<UiMessage["attachments"]>): UiMessage {
  return { id, role: "user", content: id, createdAt: new Date().toISOString(), attachments };
}

describe("hydrateAttachmentHistory", () => {
  it("rejects a file that grows while its admitted bytes are being read", async () => {
    let statCalls = 0;
    const payload = Buffer.from("image");
    const file = {
      async stat() {
        statCalls += 1;
        return {
          isFile: () => true,
          size: statCalls === 1 ? payload.length : payload.length + 1,
        } as Awaited<ReturnType<FileHandle["stat"]>>;
      },
      async read(buffer: Buffer, offset: number, length: number) {
        payload.copy(buffer, offset, 0, length);
        return { buffer, bytesRead: length };
      },
      async close() {},
    };
    const bytes = await readFileAtRecordedSize(
      "fixture.png",
      payload.length,
      async () => file as unknown as FileHandle,
    );
    expect(bytes).toBeUndefined();
    expect(statCalls).toBe(2);
  });

  it("inlines images within the per-image limit", async () => {
    await withTempDir(async (tmp) => {
      const path = resolve(tmp, "sample.png");
      await writeFile(path, "fake-png-bytes");
      const hydrated = await hydrateAttachmentHistory([userMessage("msg-1", [{
        name: "sample.png", ref: path, kind: "image", mimeType: "image/png", size: 14,
      }])], { projectPath: tmp, supportsVision: true });
      expect(hydrated[0]?.attachments?.[0]?.data).toBe(Buffer.from("fake-png-bytes").toString("base64"));
    });
  });

  it("preserves all images when aggregate size is within budget", async () => {
    await withTempDir(async (tmp) => {
      const history: UiMessage[] = [];
      const payloads: string[] = [];
      for (let i = 1; i <= 6; i++) {
        const payload = `image-${i}`;
        const path = resolve(tmp, `sample-${i}.png`);
        await writeFile(path, payload);
        payloads.push(payload);
        history.push(userMessage(`msg-${i}`, [{ name: `sample-${i}.png`, ref: path, kind: "image", mimeType: "image/png", size: payload.length }]));
      }
      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp, supportsVision: true,
        maxInlinedImageHistoryBytes: payloads.reduce((total, payload) => total + payload.length, 0),
      });
      for (let i = 0; i < payloads.length; i++) {
        expect(hydrated[i]?.attachments?.[0]?.data).toBe(Buffer.from(payloads[i]!).toString("base64"));
      }
    });
  });

  it("bounds aggregate bytes and keeps newest attachments first", async () => {
    await withTempDir(async (tmp) => {
      const payloads = ["old1", "old2", "new3"];
      const attachments = await Promise.all(payloads.map(async (payload, index) => {
        const path = resolve(tmp, `sample-${index + 1}.png`);
        await writeFile(path, payload);
        return { name: `sample-${index + 1}.png`, ref: path, kind: "image" as const, mimeType: "image/png", size: 1 };
      }));
      const hydrated = await hydrateAttachmentHistory([userMessage("many", attachments)], {
        projectPath: tmp, supportsVision: true, maxInlinedImageHistoryBytes: 8,
      });
      expect(hydrated[0]?.attachments?.map((attachment) => attachment.data)).toEqual([
        undefined, Buffer.from("old2").toString("base64"), Buffer.from("new3").toString("base64"),
      ]);
      expect(hydrated[0]?.content).toContain("sample-1.png");
    });
  });

  it("treats a zero history budget as no images inlined", async () => {
    await withTempDir(async (tmp) => {
      const path = resolve(tmp, "sample.png");
      await writeFile(path, "image");
      const hydrated = await hydrateAttachmentHistory([userMessage("zero", [{
        name: "sample.png", ref: path, kind: "image", mimeType: "image/png", size: 5,
      }])], { projectPath: tmp, supportsVision: true, maxInlinedImageHistoryBytes: 0 });
      expect(hydrated[0]?.attachments?.[0]?.data).toBeUndefined();
      expect(hydrated[0]?.content).toContain("sample.png");
    });
  });

  it("excludes a legacy current prompt before an over-budget image is hydrated", async () => {
    await withTempDir(async (tmp) => {
      const previousPath = resolve(tmp, "previous.png");
      const currentPath = resolve(tmp, "current.png");
      await writeFile(previousPath, "previous");
      await writeFile(currentPath, "current");
      const history = [
        userMessage("previous", [{ name: "previous.png", ref: previousPath, kind: "image", mimeType: "image/png", size: 8 }]),
        userMessage("legacy-current", [{ name: "current.png", ref: currentPath, kind: "image", mimeType: "image/png", size: 7 }]),
      ];
      const restored = excludeCurrentPrompt(history, "legacy-current");
      const hydrated = await hydrateAttachmentHistory(restored, {
        projectPath: tmp, supportsVision: true, maxInlinedImageHistoryBytes: 8,
      });
      expect(hydrated).toHaveLength(1);
      expect(hydrated[0]?.content).toBe("previous");
      expect(hydrated[0]?.attachments?.[0]?.data).toBe(Buffer.from("previous").toString("base64"));
    });
  });
});
