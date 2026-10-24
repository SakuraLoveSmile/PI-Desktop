import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { PiSkillDiscovery } from "@pi-desktop/shared";
import { PiSkillDiscoveryPanel } from "../../apps/desktop/src/components/settings/PiSkillDiscoveryPanel";
import { api } from "../../apps/desktop/src/lib/api";
import "../../apps/desktop/src/styles/tokens.css";
import "../../apps/desktop/src/styles/settings.css";

declare global { var piSkillDiscoveryProbe: () => Promise<unknown>; }
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function until(condition: () => boolean, label?: string) {
  const deadline = performance.now() + 6000;
  while (!condition() && performance.now() < deadline) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  assert(condition(), "UI did not reach the expected state" + (label ? `: ${label}` : ""));
}
async function settle() {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
globalThis.piSkillDiscoveryProbe = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
  const candidate = { id: "fixture", name: "planning-with-files", path: "/fixture/.pi/agent/npm/node_modules/planning-with-files", skills: ["SKILL.md"], hasExtensions: false, imported: false };
  let calls = 0;
  let cancel = true;
  let fail = false;
  let runtimeFailure = false;
  let discoveryCalls = 0;
  let empty = false;
  let partial = false;
  api.discoverPiSkills = async () => {
    discoveryCalls++;
    if (fail) throw new Error("Discovery unavailable");
    return { candidates: empty ? [] : [{ ...candidate }], errors: partial ? ["Unreadable package fixture"] : [] };
  };
  api.importPiSkills = async id => {
    assert(id === candidate.id, "wrong candidate"); calls++;
    if (!cancel) candidate.imported = true;
    if (runtimeFailure) throw new Error("Plugin process failed");
    return { canceled: cancel };
  };
  const outsideButton = document.createElement("button");
  outsideButton.textContent = "Outside panel";
  document.body.append(outsideButton);
  outsideButton.focus();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(<I18nextProvider i18n={i18n}><PiSkillDiscoveryPanel /></I18nextProvider>));
  assert(document.activeElement === outsideButton, "mount must not move focus into the panel");
  const button = (label: string) => [...container.querySelectorAll("button")].find(b => b.textContent === label)!;
  assert(Boolean(button("Show pi CLI skills")), "panel must start collapsed");
  assert(container.textContent?.includes(i18n.t("plugins.piSkillsTitle")), "collapsed panel must retain its title");
  assert(container.textContent?.includes(i18n.t("plugins.piSkillsSummary")), "collapsed panel must explain the optional source");
  await settle();
  assert(discoveryCalls === 0, "mount must not discover packages before explicit reveal");
  flushSync(() => button("Show pi CLI skills").click());
  await until(() => Boolean(button("Import and enable")), "step1");
  assert(discoveryCalls === 1, "explicit reveal must discover exactly once");
  assert(calls === 0, "step-1");
  assert(container.textContent?.includes(candidate.path), "source path must be visible");
  flushSync(() => button("Import and enable").click());
  await until(() => !button("Import and enable").disabled);
  assert(!candidate.imported && calls === 1, "step-2");
  cancel = false;
  flushSync(() => button("Import and enable").click());
  await until(() => Boolean(button("Already imported")));
  assert(button("Already imported").disabled, "step-3");
  fail = true;
  flushSync(() => button("Refresh pi CLI skills").click());
  await until(() => Boolean(container.querySelector('[role="alert"]')));
  assert(container.textContent?.includes("Discovery unavailable"), "step-4");
  assert(container.textContent?.includes(i18n.t("plugins.piSkillsDiscoveryFailed")), "discovery failure must explain the failed action");
  assert(!container.textContent?.includes("No pi CLI npm skill packages found."), "failed discovery must not report an empty source");
  assert(!button("Already imported"), "failed discovery must not show stale candidates");
  assert(container.querySelector("details")?.textContent?.includes("Discovery unavailable"), "discovery error details must remain inspectable");
  assert(!container.querySelector("details")?.open, "technical discovery details must start collapsed");
  container.querySelector("summary")?.click();
  assert(container.querySelector("details")?.open, "technical discovery details must expand on request");
  fail = false;
  flushSync(() => button("Refresh pi CLI skills").click());
  await until(() => !button("Refresh pi CLI skills").disabled);
  assert(!container.querySelector('[role="alert"]'), "step-5");
  empty = true;
  flushSync(() => button("Refresh pi CLI skills").click());
  await until(() => !button("Refresh pi CLI skills").disabled);
  assert(container.textContent?.includes("No pi CLI npm skill packages found."), "successful empty discovery must show the empty state");
  assert(!container.querySelector('[role="alert"]'), "empty discovery must not show an error");
  partial = true;
  flushSync(() => button("Refresh pi CLI skills").click());
  await until(() => !button("Refresh pi CLI skills").disabled);
  assert(container.textContent?.includes(i18n.t("plugins.piSkillsDiscoveryPartial")), "unreadable discovery must show a friendly warning");
  assert(!container.textContent?.includes("No pi CLI npm skill packages found."), "unreadable discovery must not report an empty source");
  empty = false;
  flushSync(() => button("Refresh pi CLI skills").click());
  await until(() => Boolean(button("Already imported")));
  assert(container.textContent?.includes(i18n.t("plugins.piSkillsDiscoveryPartial")), "partial discovery must show a friendly warning");
  assert(container.querySelector("details")?.textContent?.includes("Unreadable package fixture"), "partial discovery details must remain inspectable");
  partial = false;
  candidate.imported = false;
  flushSync(() => button("Refresh pi CLI skills").click());
  await until(() => Boolean(button("Import and enable")), "step6");
  runtimeFailure = true;
  flushSync(() => button("Import and enable").click());
  await until(() => Boolean(container.querySelector('[role="alert"]')));
  await until(() => Boolean(button("Already imported")));
  assert(button("Already imported").disabled, "step-6");
  assert(container.textContent?.includes("Plugin process failed"), "rediscovery must not hide the import error");
  assert(container.textContent?.includes("manage imported packages in Plugins"), "recovery location must remain visible");

  // --- T3 Dismiss & Reopen Scenarios ---
  // 1. Dismiss button exists and dismisses panel
  const dismissBtn = () => container.querySelector<HTMLButtonElement>("[data-action=\"dismiss-pi-skills\"]");
  assert(Boolean(dismissBtn()), "dismiss button must be present in expanded header");
  assert(dismissBtn()?.getAttribute("aria-label") === "Dismiss pi CLI skills", "dismiss button must have localized aria-label");

  // 2. Click dismiss -> candidate cards, paths, hint, and refresh button are hidden
  flushSync(() => dismissBtn()?.click());
  await until(() => Boolean(container.querySelector("[data-action=\"reveal-pi-skills\"]")), "step-7");
  assert(document.activeElement === container.querySelector("[data-action=\"reveal-pi-skills\"]"), "dismiss must move focus to the reveal button");
  assert(!container.querySelector("[data-action=\"dismiss-pi-skills\"]"), "dismiss button must be hidden when collapsed");
  assert(!container.textContent?.includes(candidate.path), "path must be hidden when collapsed");
  assert(!container.textContent?.includes("Installed npm packages are discovered read-only"), "hint must be hidden when collapsed");
  assert(!button("Refresh pi CLI skills"), "refresh button must be hidden when collapsed");

  // 3. Closed state does not issue discover requests
  discoveryCalls = 0;
  const originalDiscover = api.discoverPiSkills;
  api.discoverPiSkills = async () => {
    discoveryCalls++;
    return { candidates: [{ ...candidate }], errors: [] };
  };
  await settle();
  assert(discoveryCalls === 0, "closed state must not initiate new discovery calls");

  // 4. Click reveal -> shows loading status then restores expanded panel
  let resolveDelayedDiscovery: ((v: PiSkillDiscovery) => void) | undefined;
  api.discoverPiSkills = () => new Promise(resolve => {
    discoveryCalls++;
    resolveDelayedDiscovery = resolve;
  });
  const revealBtn = container.querySelector<HTMLButtonElement>("[data-action=\"reveal-pi-skills\"]")!;
  assert(revealBtn.textContent === "Show pi CLI skills", "reveal button must have localized text");
  flushSync(() => revealBtn.click());
  assert(document.activeElement === container.querySelector(".pi-skill-discovery-header h3"), "reveal must move focus to the panel heading");
  await until(() => Boolean(container.querySelector("[role=\"status\"]")), "step-8");
  assert(container.textContent?.includes("Looking for pi CLI skills…"), "loading state must be visible during rediscovery");
  assert(!container.textContent?.includes("No pi CLI npm skill packages found."), "loading must not show the empty state");
  assert(discoveryCalls === 1, "reopen must trigger discovery call");

  // Resolve the discovery
  resolveDelayedDiscovery?.({ candidates: [{ ...candidate, imported: false }], errors: [] }); await until(() => Boolean(button("Import and enable")), "step-reveal-resolve");
  assert(container.textContent?.includes(candidate.path), "step-9");

  // 5. In-flight discovery dismissed before return -> late response is ignored, panel stays closed, never imports
  let resolveLate: ((v: PiSkillDiscovery) => void) | undefined;
  api.discoverPiSkills = () => new Promise(resolve => {
    discoveryCalls++;
    resolveLate = resolve;
  });
  // Trigger refresh
  flushSync(() => button("Refresh pi CLI skills").click());
  await until(() => Boolean(container.querySelector("[role=\"status\"]")), "step-10");
  // Immediately dismiss while discovery is in-flight
  flushSync(() => dismissBtn()?.click());
  await until(() => Boolean(container.querySelector("[data-action=\"reveal-pi-skills\"]")), "step-11");
  // Late resolve returns
  const callsBeforeLate = calls;
  flushSync(() => {
    resolveLate?.({ candidates: [{ ...candidate, imported: false }], errors: [] });
  });
  await settle();
  assert(Boolean(container.querySelector("[data-action=\"reveal-pi-skills\"]")), "late discovery must not reopen collapsed panel");
  assert(calls === callsBeforeLate, "late discovery must never trigger import");

  // Restore api.discoverPiSkills before reopening
  api.discoverPiSkills = originalDiscover;
  candidate.imported = false;

  // 6. Busy state (importing) disables dismiss button
  flushSync(() => container.querySelector<HTMLButtonElement>("[data-action=\"reveal-pi-skills\"]")?.click());
  await until(() => Boolean(button("Import and enable")));
  let resolveImport: ((v: Awaited<ReturnType<typeof api.importPiSkills>>) => void) | undefined;
  api.importPiSkills = () => new Promise(resolve => {
    resolveImport = resolve;
  });
  flushSync(() => button("Import and enable").click());
  await until(() => Boolean(button("Import and enable").disabled), "step-12");
  assert(dismissBtn()?.disabled === true, "dismiss button must be disabled while import is busy");
  assert(button("Refresh pi CLI skills").disabled === true, "refresh button must be disabled while import is busy");
  flushSync(() => resolveImport?.({ canceled: true }));
  await until(() => dismissBtn()?.disabled === false, "step-13");
  assert(button("Refresh pi CLI skills").disabled === false, "buttons re-enabled after import settles");

  // 7. Remounting component keeps the optional source collapsed and idle.
  flushSync(() => dismissBtn()?.click());
  await until(() => Boolean(container.querySelector("[data-action=\"reveal-pi-skills\"]")), "step-14");
  root.unmount();
  discoveryCalls = 0;
  api.discoverPiSkills = async () => {
    discoveryCalls++;
    return { candidates: [{ ...candidate }], errors: [] };
  };
  const root2 = createRoot(container);
  flushSync(() => root2.render(<I18nextProvider i18n={i18n}><PiSkillDiscoveryPanel /></I18nextProvider>));
  await settle();
  assert(Boolean(button("Show pi CLI skills")), "remounting panel must restore default collapsed state");
  assert(discoveryCalls === 0, "remounting panel must not trigger discovery");

  root2.unmount(); container.remove(); outsideButton.remove();
  return {
    ok: true,
    scenarios: [
      "collapsed mount discovers only after reveal",
      "cancel",
      "enable",
      "duplicate",
      "failure and retry",
      "empty and partial discovery feedback",
      "registered import runtime failure",
      "dismiss and reveal",
      "dismiss during discovery ignores late response",
      "busy disables dismiss and refresh",
      "remount restores default collapsed state without discovery",
    ],
  };
};
