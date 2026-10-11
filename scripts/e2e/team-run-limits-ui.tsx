import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { AppSettings, TeamSnapshot } from "@pi-desktop/shared";
import { catalogs } from "@pi-desktop/i18n";
import { ExpertTeamSettingsPage } from "../../apps/desktop/src/features/settings/ExpertTeamSettingsPage";
import { TeamRunLimitNotice } from "../../apps/desktop/src/components/workpanel/team/TeamRunLimitNotice";
import { api } from "../../apps/desktop/src/lib/api";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import "../../apps/desktop/src/styles/tokens.css";
import "../../apps/desktop/src/styles/base.css";
import "../../apps/desktop/src/styles/ui-kit.css";
import "../../apps/desktop/src/styles/settings.css";
import "../../apps/desktop/src/styles/work-panel.css";
import "../../apps/desktop/src/styles/team-panel.css";

declare global { var teamRunLimitsUiStep: (step: string) => Promise<unknown>; }

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 5000;
  while (!condition() && performance.now() < deadline) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  assert(condition(), `UI did not reach expected state: ${label}`);
}

const HOUR = 3_600_000;
const i18n = createInstance();
let canonical: AppSettings = {
  defaultMode: "agent", theme: "light", enterToSend: true, onboardingDismissed: true,
  expertTeam: { schemaVersion: 1, userDefaults: { fullstack: { instructions: "Preserve this expert configuration" } },
    projectOverrides: { "/fixture/project": { reviewer: { instructions: "Preserve project configuration" } } } },
};
let writes = 0;
let injectedRoleConflict = false;
const calls: Array<{ policy: unknown; expected: unknown }> = [];
const container = document.createElement("main");
container.className = "settings-content";
container.style.height = "100%";
document.body.append(container);
const root = createRoot(container);
let mount = 0;
const input = (index: number) => {
  const element = container.querySelectorAll<HTMLInputElement>('input[type="number"]')[index];
  assert(element, `missing budget input ${index}`);
  return element;
};
const save = () => {
  const element = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === i18n.t("settings.expertTeam.save"));
  assert(element, "missing policy Save button");
  return element;
};
const renderSettings = () => flushSync(() => root.render(
  <I18nextProvider i18n={i18n}><div className="settings-content-inner"><ExpertTeamSettingsPage key={mount} /></div></I18nextProvider>,
));

globalThis.teamRunLimitsUiStep = async (step) => {
  if (step === "setup") {
    await i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: catalogs["zh-CN"] } },
      interpolation: { escapeValue: false } });
    document.documentElement.dataset.theme = "light";
    // Mock the external settings/project backend only. Use the production
    // store, page, input handlers, validation and compare-and-swap writer.
    api.listProjects = async () => ({ projects: [] });
    api.getSettings = async () => structuredClone(canonical);
    api.setSettings = async (patch) => {
      writes += 1;
      calls.push({ policy: structuredClone(patch.expertTeam?.runLimits), expected: structuredClone(patch.expertTeamExpected) });
      if (injectedRoleConflict) {
        injectedRoleConflict = false;
        assert(canonical.expertTeam, "fixture team missing");
        canonical.expertTeam.userDefaults.fullstack = { instructions: "Concurrent role edit survives" };
      }
      if (JSON.stringify(patch.expertTeamExpected) !== JSON.stringify(canonical.expertTeam ?? null)) {
        throw Object.assign(new Error("TEAM_CONFIG_CONFLICT"), { code: "TEAM_CONFIG_CONFLICT" });
      }
      canonical = { ...canonical, expertTeam: structuredClone(patch.expertTeam) };
      return {};
    };
    useAppStore.setState({ settings: structuredClone(canonical) });
    renderSettings();
    await until(() => container.textContent?.includes(i18n.t("settings.expertTeam.emptyProjects")) ?? false, "projects loaded");
    assert(input(0).value === "6" && input(1).value === "10", "legacy defaults are not six/ten hours");
    assert(container.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true", "limits are not enabled by default");
    assert(container.querySelectorAll(".expert-team-role-card").length === 6, "settings lost an expert role card");
    assert(!save().disabled, "valid default policy cannot be saved");
  } else if (step === "invalid") {
    await until(() => save().disabled, "non-increasing hours disable Save");
    assert(container.querySelector('[role="alert"]')?.textContent === i18n.t("settings.expertTeam.runLimits.invalid"), "invalid input lacks localized guidance");
    assert(writes === 0, "invalid policy was persisted");
  } else if (step === "disabled-saved") {
    await until(() => canonical.expertTeam?.runLimits?.enabled === false && !save().disabled, "disabled policy saved");
    assert(canonical.expertTeam?.runLimits?.softMs === 6 * HOUR && canonical.expertTeam.runLimits.hardMs === 10 * HOUR, "hours did not convert to milliseconds");
    assert(canonical.expertTeam?.userDefaults.fullstack?.instructions === "Preserve this expert configuration", "save overwrote role settings");
    assert(canonical.expertTeam?.projectOverrides["/fixture/project"]?.reviewer?.instructions === "Preserve project configuration", "save overwrote project role settings");
    assert(calls.length === 1 && calls[0].expected !== undefined, "save omitted expert policy CAS metadata");
  } else if (step === "reload") {
    mount += 1;
    renderSettings();
    await until(() => input(0).value === "6" && input(1).value === "10", "saved policy reload");
    assert(container.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false", "reload lost disabled policy");
  } else if (step === "arm-role-conflict") {
    injectedRoleConflict = true;
  } else if (step === "role-conflict-saved") {
    await until(() => canonical.expertTeam?.runLimits?.hardMs === 12 * HOUR && !save().disabled, "policy rebase persisted");
    assert(canonical.expertTeam?.runLimits?.enabled === true && canonical.expertTeam.runLimits.softMs === 7 * HOUR, "rebase lost edited limits");
    assert(canonical.expertTeam?.userDefaults.fullstack?.instructions === "Concurrent role edit survives", "CAS rebase overwrote concurrent expert edit");
    assert(writes === 3, "fixture did not exercise rejected write then successful CAS rebase");
  } else if (step === "arm-policy-conflict") {
    assert(canonical.expertTeam?.runLimits, "fixture policy missing");
    canonical.expertTeam.runLimits = { ...canonical.expertTeam.runLimits, hardMs: 13 * HOUR };
  } else if (step === "policy-conflict") {
    await until(() => container.querySelector('[role="alert"]')?.textContent === i18n.t("settings.expertTeam.conflict"), "same-policy conflict displayed");
    assert(input(1).value === "13", "conflict did not refresh the canonical policy");
    assert(writes === 3 && canonical.expertTeam?.runLimits?.hardMs === 13 * HOUR, "stale editor overwrote concurrent policy");
  } else if (step === "notices") {
    const limits: NonNullable<TeamSnapshot["runLimits"]> = {
      enabled: true, runId: "fixture-run", startedAt: 0, elapsedMs: 10 * HOUR,
      softMs: 6 * HOUR, hardMs: 10 * HOUR, softMessageId: "fixture-soft", hardReachedAt: 10 * HOUR,
    };
    flushSync(() => root.render(<I18nextProvider i18n={i18n}>
      <section className="team-panel">
        <h2>{i18n.t("team.runLimitTitle")}</h2>
        <TeamRunLimitNotice limits={{ ...limits, elapsedMs: 6 * HOUR, hardReachedAt: null }} safelyFinishing={false} />
        <TeamRunLimitNotice limits={limits} safelyFinishing={true} />
        <TeamRunLimitNotice limits={limits} safelyFinishing={false} />
        <TeamRunLimitNotice limits={{ ...limits, enabled: false }} safelyFinishing={false} />
      </section>
    </I18nextProvider>));
    container.scrollTop = 0;
    const notices = container.querySelectorAll('[role="status"]');
    assert(notices.length === 4, "notice states are missing");
    assert(notices[0].textContent?.includes(i18n.t("team.runLimitSoft")), "soft notice missing");
    assert(notices[1].textContent?.includes(i18n.t("team.runLimitStopping")), "safe finishing notice missing");
    assert(!notices[2].textContent?.includes(i18n.t("team.runLimitStopping")) && notices[2].textContent?.includes(i18n.t("team.runLimitPaused")), "settled pause incorrectly says tools are finishing");
    assert(notices[3].textContent?.includes(i18n.t("team.runLimitDisabled")) && notices[3].textContent?.includes("10.0"), "disabled notice loses retained elapsed clock");
    assert(container.scrollWidth <= window.innerWidth, "notices overflow the viewport");
  } else throw new Error(`Unknown UI step: ${step}`);
  return { ok: true, step, writes, policy: canonical.expertTeam?.runLimits,
    concurrentRole: canonical.expertTeam?.userDefaults.fullstack?.instructions };
};
