import assert from "node:assert/strict";
import test from "node:test";

import { thinkingLevelLabel } from "../src/features/chat/composer/thinking-level-label.ts";

const t = (key) => key;

test("the reasoning chip names only the off state; other levels keep their canonical values", () => {
  assert.equal(thinkingLevelLabel("off", t), "chat.thinkingOff");
  assert.equal(thinkingLevelLabel("low", t), "low");
  assert.equal(thinkingLevelLabel("high", t), "high");
});
