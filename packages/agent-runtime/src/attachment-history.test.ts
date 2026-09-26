import { describe, expect, it } from "vitest";
import { hydrateAttachmentHistory } from "./attachment-history.js";
import type { UiMessage } from "@pi-desktop/shared";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";

describe("hydrateAttachmentHistory", () => {
  it("inlines image attachments when supportsVision is true and within byte limits", async () => {
    const tmp = resolve(os.tmpdir(), `test-attach-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    const imgPath = resolve(tmp, "sample.png");
    await writeFile(imgPath, "fake-png-bytes");

    const history: UiMessage[] = [
      {
        id: "msg-1",
        role: "user",
        content: "look at this",
        createdAt: new Date().toISOString(),
        attachments: [
          {
            name: "sample.png",
            ref: imgPath,
            kind: "image",
            mimeType: "image/png",
            size: 14,
          },
        ],
      },
    ];

    const hydrated = await hydrateAttachmentHistory(history, {
      projectPath: tmp,
      supportsVision: true,
    });

    expect(hydrated[0]?.attachments?.[0]?.data).toBe(
      Buffer.from("fake-png-bytes").toString("base64")
    );
  });

  it("limits inlined base64 images to the latest N user messages to prevent V8 OOM (#1077)", async () => {
    const tmp = resolve(os.tmpdir(), `test-attach-limits-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    const history: UiMessage[] = [];
    for (let i = 1; i <= 10; i++) {
      const imgPath = resolve(tmp, `sample-${i}.png`);
      await writeFile(imgPath, `fake-png-bytes-${i}`);
      history.push({
        id: `msg-${i}`,
        role: "user",
        content: `image ${i}`,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
        attachments: [
          {
            name: `sample-${i}.png`,
            ref: imgPath,
            kind: "image",
            mimeType: "image/png",
            size: 20,
          },
        ],
      });
    }

    // Default maxInlinedImageMessages is 5
    const hydrated = await hydrateAttachmentHistory(history, {
      projectPath: tmp,
      supportsVision: true,
      maxInlinedImageMessages: 5,
    });

    // Old messages (msg-1 through msg-5) should NOT have data inlined in memory
    for (let i = 0; i < 5; i++) {
      expect(hydrated[i]?.attachments?.[0]?.data).toBeUndefined();
      expect(hydrated[i]?.attachments?.[0]?.ref).toContain(`sample-${i + 1}.png`);
    }

    // Recent messages (msg-6 through msg-10) should have data inlined
    for (let i = 5; i < 10; i++) {
      expect(hydrated[i]?.attachments?.[0]?.data).toBeDefined();
    }
  });
});
