import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { slotSsr } from "./helpers/slot-ssr.mjs";

/**
 * The Advisor row rendered through Vite SSR, so the copy and the detail states
 * are checked as the first frame the user sees. Pins that the picker cannot
 * list (no providers loaded here) are the stale state: the row names the pinned
 * pair and says the Advisor is unavailable.
 */
test("the Advisor row reads Off until a model is pinned, and names a stale pin", async (t) => {
  const ssr = await slotSsr(t);
  const { AdvisorCard } = await ssr.load("/src/features/settings/advisor-card.tsx");
  const render = (settings) =>
    ssr.render(
      createElement(AdvisorCard, { settings, saveSettings: async () => {} }),
      { sessionId: null },
    );

  const off = render({});
  assert.match(off, /Advisor/);
  assert.match(off, /model-default-empty">Off</);
  assert.doesNotMatch(off, /Unavailable\./);

  const cleared = render({ advisorProviderId: null, advisorModelId: null });
  assert.match(cleared, /model-default-empty">Off</);

  const stale = render({ advisorProviderId: "openai", advisorModelId: "gpt-5" });
  assert.match(stale, /openai/);
  assert.match(stale, /gpt-5/);
  assert.match(stale, /Unavailable\./);
});
