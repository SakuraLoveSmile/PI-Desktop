import { describe, expect, it } from "vitest";
import { hydrateAttachmentHistory } from "./attachment-history.js";
import type { UiMessage } from "@pi-desktop/shared";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import os from "node:os";

async function withTempDir(run: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(os.tmpdir(), "test-attachment-history-"));
  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

function userMessage(
  id: string,
  attachments: NonNullable<UiMessage["attachments"]>,
): UiMessage {
  return {
    id,
    role: "user",
    content: id,
    createdAt: new Date().toISOString(),
    attachments,
  };
}

describe("hydrateAttachmentHistory", () => {
  it("inlines image attachments when supportsVision is true and within per-image byte limits", async () => {
    await withTempDir(async (tmp) => {
      const imgPath = resolve(tmp, "sample.png");
      await writeFile(imgPath, "fake-png-bytes");

      const history = [
        userMessage("msg-1", [
          {
            name: "sample.png",
            ref: imgPath,
            kind: "image",
            mimeType: "image/png",
            size: 14,
          },
        ]),
      ];

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
      });

      expect(hydrated[0]?.attachments?.[0]?.data).toBe(
        Buffer.from("fake-png-bytes").toString("base64"),
      );
    });
  });

  it("preserves all image turns when their aggregate size is within budget", async () => {
    await withTempDir(async (tmp) => {
      const history: UiMessage[] = [];
      const payloads: string[] = [];
      for (let i = 1; i <= 6; i++) {
        const payload = `image-${i}`;
        const imgPath = resolve(tmp, `sample-${i}.png`);
        await writeFile(imgPath, payload);
        payloads.push(payload);
        history.push(
          userMessage(`msg-${i}`, [
            {
              name: `sample-${i}.png`,
              ref: imgPath,
              kind: "image",
              mimeType: "image/png",
              size: payload.length,
            },
          ]),
        );
      }

      const budget = payloads.reduce((total, payload) => total + payload.length, 0);
      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
        maxInlinedImageHistoryBytes: budget,
      });

      for (let i = 0; i < payloads.length; i++) {
        expect(hydrated[i]?.attachments?.[0]?.data).toBe(
          Buffer.from(payloads[i]!).toString("base64"),
        );
      }
    });
  });

  it("bounds aggregate bytes across many attachments in one message and keeps the newest first", async () => {
    await withTempDir(async (tmp) => {
      const payloads = ["old1", "old2", "new3"];
      const attachments = await Promise.all(
        payloads.map(async (payload, index) => {
          const imgPath = resolve(tmp, `sample-${index + 1}.png`);
          await writeFile(imgPath, payload);
          return {
            name: `sample-${index + 1}.png`,
            ref: imgPath,
            kind: "image" as const,
            mimeType: "image/png",
            // The on-disk size, not caller-supplied metadata, controls the budget.
            size: 1,
          };
        }),
      );
      const history = [userMessage("msg-many-images", attachments)];

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
        maxInlinedImageHistoryBytes: 8,
      });

      expect(hydrated[0]?.attachments?.map((attachment) => attachment.data)).toEqual([
        undefined,
        Buffer.from("old2").toString("base64"),
        Buffer.from("new3").toString("base64"),
      ]);
      expect(hydrated[0]?.content).toContain("sample-1.png");
    });
  });

  it("treats a zero history budget as no images inlined", async () => {
    await withTempDir(async (tmp) => {
      const imgPath = resolve(tmp, "sample.png");
      await writeFile(imgPath, "image");
      const history = [
        userMessage("msg-1", [
          {
            name: "sample.png",
            ref: imgPath,
            kind: "image",
            mimeType: "image/png",
            size: 5,
          },
        ]),
      ];

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
        maxInlinedImageHistoryBytes: 0,
      });

      expect(hydrated[0]?.attachments?.[0]?.data).toBeUndefined();
      expect(hydrated[0]?.content).toContain("sample.png");
    });
  });
});
