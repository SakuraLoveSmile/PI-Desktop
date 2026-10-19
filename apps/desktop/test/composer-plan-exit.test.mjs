import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { slotSsr } from "./helpers/slot-ssr.mjs";

/*
 * The Plan chip's close control as its first frame renders it. Clicking it runs
 * the toolbar's `selectMode("agent")`, the switch the + menu's Plan toggle
 * already makes; the click itself is covered by the Electron E2E (E2E-088).
 */

const noop = () => {};
const key = (value) => value;

/** The close control's opening tag, or null when the chip stands alone. */
function closeControl(html) {
  return html.match(/<button\b[^>]*composer-contract-exit[^>]*>/)?.[0] ?? null;
}

test("a committed Plan offers its close control beside the chip, and the chip keeps its label", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerContractPicker } = await ssr.load("/src/features/chat/composer/ComposerContractPicker.tsx");
  const html = ssr.render(createElement(ComposerContractPicker, { t: key, mode: "plan", planningLive: false, onClick: noop, onExitPlan: noop }));

  assert.match(html, /^<span class="composer-contract-group"/);
  assert.match(html, /aria-label="chat\.contractMode: settings\.modePlan"/);
  const exit = closeControl(html);
  assert.ok(exit, "the close control is rendered");
  assert.match(exit, /aria-label="chat\.exitPlanMode"/);
  assert.doesNotMatch(exit, /disabled/);
});

test("the close control waits while the plan is drafted or awaits approval, and while controls are blocked", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerContractPicker } = await ssr.load("/src/features/chat/composer/ComposerContractPicker.tsx");
  const picker = (props) =>
    ssr.render(createElement(ComposerContractPicker, { t: key, mode: "plan", planningLive: false, onClick: noop, onExitPlan: noop, ...props }));

  assert.match(closeControl(picker({ planningLive: true })), /disabled=""/);
  assert.match(closeControl(picker({ planAwaitingApproval: true })), /disabled=""/);
  assert.match(closeControl(picker({ controlsBlocked: true })), /disabled=""/);
});

test("the close control is offered only for a committed Plan with an exit handler", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerContractPicker } = await ssr.load("/src/features/chat/composer/ComposerContractPicker.tsx");
  const picker = (props) => ssr.render(createElement(ComposerContractPicker, { t: key, planningLive: false, onClick: noop, ...props }));

  // Goal keeps its chip alone.
  const goal = picker({ mode: "goal", onExitPlan: noop });
  assert.equal(closeControl(goal), null);
  assert.doesNotMatch(goal, /composer-contract-group/);
  // A staged or executing Plan shows the Plan chip while the committed mode is not Plan.
  assert.equal(closeControl(picker({ mode: "agent", displayMode: "plan", onExitPlan: noop })), null);
  // Without a handler, the Plan chip stands alone as before.
  assert.equal(closeControl(picker({ mode: "plan" })), null);
});
