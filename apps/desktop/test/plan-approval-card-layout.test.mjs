import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const readDesktop = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [approvalBar, styles] = await Promise.all([
  readDesktop("src/components/PlanApprovalBar.tsx"),
  loadStyles(),
]);

test("plan approval card implements full-width flex column hierarchy without two-column rail", () => {
  const barRule = styles.match(/\.plan-approval-bar\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(barRule, "plan-approval-bar rule exists");
  assert.match(barRule, /display:\s*flex;/);
  assert.match(barRule, /flex-direction:\s*column;/);
  assert.match(barRule, /width:\s*100%;/);
  assert.match(barRule, /min-width:\s*0;/);
  assert.match(barRule, /gap:\s*10px;/);
  assert.match(barRule, /padding:\s*12px 14px;/);
  assert.match(barRule, /border:\s*1px solid var\(--ds-border-subtle\);/);
  assert.match(barRule, /border-radius:\s*var\(--radius-xs\);/);
  assert.match(barRule, /background:\s*var\(--ds-bg-composer\);/);
  assert.match(barRule, /box-shadow:\s*var\(--ds-shadow-composer\);/);
  assert.doesNotMatch(barRule, /grid-template-columns/, "does not use a grid template column rail");
});

test("plan approval title and summary span full width with natural wrapping", () => {
  const copyRule = styles.match(/\.plan-approval-copy\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(copyRule, "plan-approval-copy rule exists");
  assert.match(copyRule, /display:\s*flex;/);
  assert.match(copyRule, /width:\s*100%;/);
  assert.match(copyRule, /min-width:\s*0;/);
  assert.match(copyRule, /flex-direction:\s*column;/);
  assert.match(copyRule, /gap:\s*6px;/);

  const titleRule = styles.match(/\.plan-approval-title\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(titleRule, "plan-approval-title rule exists");
  assert.match(titleRule, /min-width:\s*0;/);
  assert.match(titleRule, /font-size:\s*var\(--text-base-plus\);/);
  assert.match(titleRule, /line-height:\s*var\(--leading-compact\);/);
  assert.match(titleRule, /overflow-wrap:\s*break-word;/);
  assert.doesNotMatch(titleRule, /overflow-wrap:\s*anywhere;/, "avoids anywhere splitting words into single characters");

  const summaryRule = styles.match(/\.plan-approval-summary\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(summaryRule, "plan-approval-summary rule exists");
  assert.match(summaryRule, /width:\s*100%;/);
  assert.match(summaryRule, /min-width:\s*0;/);
  assert.match(summaryRule, /font-size:\s*var\(--text-base\);/);
  assert.match(summaryRule, /line-height:\s*var\(--leading-body\);/);
  assert.match(summaryRule, /overflow-wrap:\s*break-word;/);
});

test("plan approval footer arranges details on the left and actions on the right with responsive wrapping", () => {
  const footerRule = styles.match(/\.plan-approval-footer\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(footerRule, "plan-approval-footer rule exists");
  assert.match(footerRule, /display:\s*flex;/);
  assert.match(footerRule, /min-width:\s*0;/);
  assert.match(footerRule, /align-items:\s*flex-end;/);
  assert.match(footerRule, /flex-wrap:\s*wrap;/);
  assert.match(footerRule, /gap:\s*8px 12px;/);

  const detailsRule = styles.match(/\.plan-approval-details\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(detailsRule, "plan-approval-details rule exists");
  assert.match(detailsRule, /flex:\s*1 1 180px;/);
  assert.match(detailsRule, /min-width:\s*0;/);

  const actionsRule = styles.match(/\.plan-approval-actions\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(actionsRule, "plan-approval-actions rule exists");
  assert.match(actionsRule, /flex:\s*0 1 auto;/);
  assert.match(actionsRule, /max-width:\s*100%;/);
  assert.match(actionsRule, /margin-left:\s*auto;/);
  assert.match(actionsRule, /flex-wrap:\s*wrap;/);
  assert.match(actionsRule, /justify-content:\s*flex-end;/);
  assert.doesNotMatch(actionsRule, /overflow:\s*hidden;/, "actions are not clipped by overflow");

  const splitRule = styles.match(/\.plan-approval-split\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(splitRule, "plan-approval-split rule exists");
  assert.match(splitRule, /width:\s*auto;/);
  assert.match(splitRule, /min-width:\s*132px;/);
  assert.match(splitRule, /flex:\s*0 0 auto;/);

  const artifactPathRule = styles.match(/\.plan-approval-artifact-path\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(artifactPathRule, "plan-approval-artifact-path rule exists");
  assert.match(artifactPathRule, /max-width:\s*min\(36ch, 38vw\);/);
  assert.match(artifactPathRule, /text-overflow:\s*ellipsis;/);
  assert.match(artifactPathRule, /white-space:\s*nowrap;/);
});

test("action buttons preserve accessible touch target height across viewports", () => {
  const goalToggle = styles.match(/\.plan-approval-goal-toggle[^{]*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(goalToggle, /min-height:\s*30px;/);

  const rejectRule = styles.match(/\.plan-approval-reject[^{]*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(rejectRule, /min-height:\s*30px;/);
});

test("obsolete container queries on plan approval are removed", () => {
  assert.doesNotMatch(styles, /@container composer-stack[^}]*?\.plan-approval-bar/);
  assert.doesNotMatch(styles, /@container composer-stack[^}]*?\.plan-approval-title/);
  assert.doesNotMatch(styles, /@container composer-stack[^}]*?\.plan-approval-actions/);
  assert.doesNotMatch(styles, /@container composer-stack[^}]*?\.plan-approval-split/);
});

test("PlanApprovalBar JSX structures copy, warning, and footer groups", () => {
  // Title and summary live inside .plan-approval-copy
  const copyStart = approvalBar.indexOf('<div className="plan-approval-copy">');
  assert.ok(copyStart > -1, "plan-approval-copy is rendered");
  const copyBlock = approvalBar.slice(copyStart, approvalBar.indexOf("</div>", copyStart) + 6);
  assert.match(copyBlock, /className="plan-approval-title"/);
  assert.match(copyBlock, /className="plan-approval-summary"/);

  // Draft warning renders between copy and footer
  const warningPos = approvalBar.indexOf('className="plan-approval-draft-warning"');
  const footerPos = approvalBar.indexOf('className="plan-approval-footer"');
  assert.ok(warningPos > copyStart, "draft warning is after copy");
  assert.ok(footerPos > warningPos, "footer is after draft warning");

  // Footer encloses details and actions
  const footerBlock = approvalBar.slice(footerPos);
  assert.match(footerBlock, /className="plan-approval-details"/);
  assert.match(footerBlock, /className="plan-approval-actions"/);
  assert.match(footerBlock, /className="plan-approval-split"/);
  assert.match(footerBlock, /className="plan-approval-goal-toggle"/);
  assert.match(footerBlock, /className="plan-approval-schedule"/);
  assert.match(footerBlock, /className="plan-approval-reject"/);
});

test("PlanApprovalBar preserves approval and execution semantics", () => {
  // Check that approve button resolves with "approve" action
  assert.match(approvalBar, /void resolve\("approve",\s*approvalMode\)/);
  // Check that reject button resolves with "reject" action
  assert.match(approvalBar, /void resolve\("reject"\)/);
  // Check that schedule popover is preserved
  assert.match(approvalBar, /plan-approval-schedule-popover/);
  // Check that Goal conversion and cancellation are preserved
  assert.match(approvalBar, /convertPlanToGoal/);
  assert.match(approvalBar, /cancelPlanConversion/);
  // Check that resolvePlan receives the action payload
  assert.match(approvalBar, /await resolvePlan\(/);
});
