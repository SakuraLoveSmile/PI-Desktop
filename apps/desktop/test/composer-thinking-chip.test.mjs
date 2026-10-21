import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { slotSsr } from "./helpers/slot-ssr.mjs";

test("the reasoning chip names the off state instead of hiding it", async (context) => {
  const ssr = await slotSsr(context);
  const { ComposerModelPicker } = await ssr.load("/src/features/chat/composer/ComposerModelPicker.tsx");
  // The trigger reads only these fields while the menu is closed.
  const controller = {
    open: false,
    setOpen() {},
    setModelHighlight() {},
    modelListRef: { current: null },
    modelGroups: [],
    thinkingMenuLevels: [],
    selectModel() {},
    commitThinkingLevel() {},
    onMenuKeyDown() {},
  };
  const render = (thinkingLevel, thinkingLabel) => ssr.render(createElement(ComposerModelPicker, {
    t: (key) => key,
    controller,
    modelLabel: "Qwen3.8-Max",
    thinkingLabel,
    thinkingLevel,
    controlsBlocked: false,
    onCloseOtherMenus() {},
  }));

  const off = render("off", "chat.thinkingOff");
  assert.match(off, /class="composer-model-thinking-level">chat\.thinkingOff<\/span>/);
  assert.match(off, /class="composer-model-thinking-dot"/);

  const high = render("high", "high");
  assert.match(high, /class="composer-model-thinking-level">high<\/span>/);
});
