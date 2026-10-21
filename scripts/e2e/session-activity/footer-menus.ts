import { flushSync } from "react-dom";
import type { TFunction } from "i18next";
import type { GitWorkspaceMutation, GitWorkspaceSnapshot, SessionSummary } from "@pi-desktop/shared";
import { api } from "../../../apps/desktop/src/lib/api";
import { useAppStore } from "../../../apps/desktop/src/stores/app-store";

export type FooterScene = "project-menu" | "location-menu" | "branch-menu" | "worktree-create";
type Probe = {
  host: HTMLElement;
  check: (value: unknown, name: string) => void;
  until: (predicate: () => boolean, name: string) => Promise<void>;
  click: (target: Element | null | undefined) => void;
};

/** Replace only Host-facing calls. Menu/controller/store navigation remain real. */
export function installFooterMenuFixture(t: TFunction) {
  const worktreeLabel = t("chat.workspaceMenu.worktreeMode");
  const original = {
    getWorkspaceGit: api.getWorkspaceGit,
    switchWorkspaceBranch: api.switchWorkspaceBranch,
    createWorkspaceBranch: api.createWorkspaceBranch,
    createWorkspaceWorktree: api.createWorkspaceWorktree,
    createSession: api.createSession,
    setProject: api.setProject,
    clearProject: api.clearProject,
    getOnboarding: api.getOnboarding,
  };
  const path = "/isolated/music";
  const managedPath = "/isolated/managed/review";
  const nestedRoot = "/isolated/nested-repo";
  const nestedRelative = "/apps/frontend";
  const nestedProject = nestedRoot + nestedRelative;
  const nestedManaged = "/isolated/managed/nested-review";
  let nestedWorktrees = [
    { path: nestedRoot, branch: "main", isMain: true, managed: false },
    { path: nestedManaged, branch: "nested-review", isMain: false, managed: true },
  ];
  const calls: string[] = [];
  let serial = 0;
  let dirty = false;
  let branch = "main";
  let failSwitch = false;
  let deferSwitch = false;
  let deferredSwitch: ((value: Awaited<ReturnType<typeof api.switchWorkspaceBranch>>) => void) | null = null;
  let deferredWorktree: ((value: Awaited<ReturnType<typeof api.createWorkspaceWorktree>>) => void) | null = null;
  let deferWorktree = false;
  let worktrees = [
    { path, branch: "main", isMain: true, managed: false },
    { path: managedPath, branch: "review", isMain: false, managed: true },
    { path: "/isolated/foreign", branch: "occupied", isMain: false, managed: false },
  ];
  function snapshot(projectPath = path): GitWorkspaceSnapshot {
    const nestedTree = nestedWorktrees.find(item => projectPath === item.path || projectPath.startsWith(`${item.path}/`));
    const relevantTrees = nestedTree ? nestedWorktrees : worktrees;
    const tree = nestedTree ?? worktrees.find(item => item.path === projectPath);
    const current = nestedTree ? nestedTree.branch : projectPath === path ? branch : tree?.branch ?? "main";
    return {
      projectPath, rootPath: nestedTree?.path ?? projectPath, mainPath: nestedTree ? nestedRoot : path, branch: current,
      head: "fixture-head", isWorktree: Boolean(tree && !tree.isMain), dirty,
      branches: ["main", "feature/menu", "review", "occupied", branch].filter((name, index, all) => all.indexOf(name) === index).map(name => ({
        name, current: name === current,
        ...(name === "occupied" ? { checkedOutPath: "/isolated/foreign" } : {}),
      })),
      worktrees: relevantTrees.map(item => ({ ...item, ...(item.path === path ? { branch } : {}) })),
    };
  }
  function mutate(request: GitWorkspaceMutation, kind: string) {
    calls.push(`${kind}:${request.sessionId}:${request.projectPath}:${request.branch}`);
    if (request.expectedHead !== "fixture-head") throw new Error("Stale checkout");
    if (dirty) throw new Error("Checkout became dirty");
    branch = request.branch;
    return { git: snapshot(request.projectPath) };
  }
  api.getWorkspaceGit = async request => ({ git: snapshot(request.projectPath) });
  api.switchWorkspaceBranch = async request => {
    if (failSwitch) { calls.push("switch-error"); throw new Error("Checkout became dirty"); }
    if (deferSwitch) return new Promise(resolve => { deferredSwitch = resolve; });
    return mutate(request, "switch");
  };
  api.createWorkspaceBranch = async request => mutate(request, "branch");
  api.createWorkspaceWorktree = async request => {
    calls.push(`worktree:${request.sessionId}:${request.branch}`);
    const worktree = { path: `/isolated/managed/${request.branch}`, branch: request.branch, isMain: false, managed: true };
    if (snapshot(request.projectPath).mainPath === nestedRoot) nestedWorktrees = [...nestedWorktrees, worktree];
    else worktrees = [...worktrees, worktree];
    const result = { git: snapshot(request.projectPath), worktree };
    if (deferWorktree) return new Promise(resolve => { deferredWorktree = resolve; });
    return result;
  };
  api.setProject = async projectPath => {
    calls.push(`project:${projectPath}`);
    return { workspace: { path: projectPath, name: projectPath === path ? "PI-Desktop" : projectPath.split("/").at(-1)!, branch: snapshot(projectPath).branch ?? undefined } };
  };
  api.clearProject = async () => { calls.push("project:clear"); return { ok: true }; };
  api.getOnboarding = async () => ({ showChecklist: false, steps: [] });
  api.createSession = async input => {
    calls.push(`session:${input?.projectPath ?? "none"}`);
    const owner = useAppStore.getState().sessions.find(item => item.id === "activity-a")!;
    const session: SessionSummary = { ...owner, ...input, id: `footer-session-${++serial}`, projectPath: input?.projectPath, source: "desktop", messageCount: 0 };
    return { session };
  };

  const set = (patch: Parameters<typeof useAppStore.setState>[0]) => flushSync(() => useAppStore.setState(patch));
  const input = (field: HTMLInputElement | null, value: string) => {
    if (!field) throw new Error("Missing footer input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    flushSync(() => { setter.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const key = (target: EventTarget, value: string) => flushSync(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
  const trigger = (host: HTMLElement, index: number) => host.querySelectorAll<HTMLButtonElement>(".composer-footer-trigger")[index];
  const menu = (kind: string) => document.querySelector<HTMLElement>(`.composer-${kind}-menu.is-open`);
  const find = (root: Element | null | undefined, text: string) => [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(item => item.textContent?.trim() === text);
  const close = () => key(window, "Escape");
  async function open(probe: Probe, index: number, kind: string) {
    // Session navigation remounts the controls; let their ownership effects settle.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    probe.click(trigger(probe.host, index));
    await probe.until(() => Boolean(menu(kind)) && !menu(kind)?.textContent?.includes("正在读取"), `${kind} menu did not load`);
    return menu(kind)!;
  }
  async function run(probe: Probe) {
    const { check, until, click, host } = probe;
    const baseline = useAppStore.getState();
    const ownerMessages = baseline.messages;
    const restoreOwner = () => set({ ...baseline, activeProjectPath: path, openProjectPaths: [path, "/isolated/docs"], openProjects: [{ path, name: "PI-Desktop", branch }, { path: "/isolated/docs", name: "Notes project", branch: "main" }], isRunning: false, runningSessions: {}, workPanelOpen: false });
    const markCurrentUsed = () => set(state => ({ sessions: state.sessions.map(item => item.id === state.activeSessionId ? { ...item, messageCount: 1 } : item) }));
    try {
      restoreOwner();
      let popup = await open(probe, 2, "footer-branch");
      check(find(popup, "main")?.getAttribute("aria-checked") === "true", "footer branch identifies current checkout");
      check(find(popup, "occupied")?.disabled, "footer disables a branch occupied by another worktree");
      input(popup.querySelector("input"), "feature");
      check(popup.querySelectorAll('[role="menuitemradio"]').length === 1, "branch search filters local branches");
      key(popup.querySelector("input")!, "ArrowDown");
      check(document.activeElement === find(popup, "feature/menu"), "branch search ArrowDown focuses filtered branch");
      click(find(popup, "feature/menu"));
      await until(() => trigger(host, 2)?.textContent?.includes("feature/menu") === true && !menu("footer-branch"), "Branch selection did not update footer");
      check(useAppStore.getState().workspace?.branch === "feature/menu", "branch mutation updates matching project metadata");
      popup = await open(probe, 2, "footer-branch");
      click(find(popup, "新建分支"));
      input(popup.querySelector("input"), "feature/created");
      click(find(popup, "创建并切换"));
      await until(() => trigger(host, 2)?.textContent?.includes("feature/created") === true, "Create branch did not update current branch");
      check(calls.some(item => item === `branch:activity-a:${path}:feature/created`), "new branch uses owning session and directory");
      dirty = true;
      popup = await open(probe, 2, "footer-branch");
      check(find(popup, "main")?.disabled && find(popup, "新建分支")?.disabled && popup.textContent?.includes("未跟踪"), "dirty checkout disables branch mutations and explains why");
      close(); dirty = false; failSwitch = true;
      popup = await open(probe, 2, "footer-branch"); click(find(popup, "main"));
      await until(() => popup.querySelector('[role="alert"]')?.textContent?.includes("Checkout became dirty") === true, "Host checkout error was not visible");
      check(trigger(host, 2)?.textContent?.includes("feature/created"), "failed checkout preserves current branch");
      close(); failSwitch = false;

      popup = await open(probe, 1, "footer-location"); click(find(popup, worktreeLabel));
      check(!popup.textContent?.includes("occupied") && Boolean(find(popup, "review")), "worktree picker lists only app-managed checkouts");
      click(find(popup, "review"));
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === managedPath, "Managed worktree did not create scoped session");
      check(useAppStore.getState().sessions.find(item => item.id === "activity-a")?.projectPath === path, "worktree selection preserves old conversation directory");
      check(useAppStore.getState().sessions.some(item => item.id === "activity-a" && item.messageCount > 0), "worktree selection preserves old conversation content metadata");
      markCurrentUsed();
      popup = await open(probe, 1, "footer-location"); click(find(popup, "本地"));
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === path, "Local mode did not return to main directory");
      check(useAppStore.getState().sessions.some(item => item.projectPath === managedPath), "local mode leaves worktree session intact");
      markCurrentUsed();
      popup = await open(probe, 1, "footer-location"); click(find(popup, worktreeLabel)); click(find(popup, "新建工作树"));
      input(popup.querySelector("input"), "menu-created"); click(find(popup, "创建工作树"));
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === "/isolated/managed/menu-created", "Created worktree did not navigate to its actual directory");
      await until(() => trigger(host, 1)?.textContent?.includes(worktreeLabel) === true, "Worktree mode did not derive from new checkout snapshot");
      check(calls.some(item => item.startsWith("session:/isolated/managed/menu-created")), "created worktree opens a real store-created session");

      restoreOwner();
      set(state => ({
        workspace: { path: nestedProject, name: "Frontend", branch: "main" }, activeProjectPath: nestedProject,
        openProjectPaths: [nestedProject], openProjects: [{ path: nestedProject, name: "Frontend", branch: "main" }],
        sessions: state.sessions.map(item => item.id === "activity-a" ? { ...item, projectPath: nestedProject } : item),
      }));
      popup = await open(probe, 1, "footer-location"); click(find(popup, worktreeLabel)); click(find(popup, "nested-review"));
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === nestedManaged + nestedRelative, "Nested project worktree selection lost its relative directory");
      check(calls.includes(`session:${nestedManaged}${nestedRelative}`), "managed worktree preserves nested project execution directory");
      markCurrentUsed();
      popup = await open(probe, 1, "footer-location"); click(find(popup, "本地"));
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === nestedProject, "Nested worktree local mode did not return to nested main directory");
      check(useAppStore.getState().sessions.some(item => item.projectPath === nestedManaged + nestedRelative), "nested local mode retains the managed worktree conversation");
      markCurrentUsed();
      popup = await open(probe, 1, "footer-location"); click(find(popup, worktreeLabel)); click(find(popup, "新建工作树"));
      input(popup.querySelector("input"), "nested-created"); click(find(popup, "创建工作树"));
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === "/isolated/managed/nested-created" + nestedRelative, "Nested project worktree creation lost its relative directory");
      check(calls.includes(`session:/isolated/managed/nested-created${nestedRelative}`), "new worktree preserves nested project execution directory");
      markCurrentUsed();
      popup = await open(probe, 1, "footer-location"); click(find(popup, "本地"));
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === nestedProject, "New nested worktree did not round trip to local project directory");
      check(useAppStore.getState().sessions.find(item => item.id === "activity-a")?.projectPath === nestedProject, "nested worktree round trip preserves original conversation scope");

      restoreOwner();
      popup = await open(probe, 0, "project");
      check(find(popup, "PI-Desktop")?.getAttribute("aria-checked") === "true", "project picker checks current project");
      const count = calls.filter(item => item.startsWith("session:")).length;
      click(find(popup, "PI-Desktop"));
      check(calls.filter(item => item.startsWith("session:")).length === count && useAppStore.getState().activeSessionId === "activity-a", "choosing same project preserves active conversation");
      popup = await open(probe, 0, "project"); input(popup.querySelector("input"), "/isolated/docs");
      check(popup.querySelectorAll('[role="menuitemradio"]').length === 1, "project search matches a path");
      key(popup.querySelector("input")!, "Enter");
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === "/isolated/docs", "Project Enter did not create scoped conversation");
      check(useAppStore.getState().sessions.find(item => item.id === "activity-a")?.projectPath === path && ownerMessages.length > 0, "project switching retains original populated session");
      popup = await open(probe, 0, "project"); click(find(popup, "不指定工作区"));
      await until(() => !useAppStore.getState().workspace && Boolean(useAppStore.getState().activeSessionId) && !useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath, "No-workspace did not create pathless session");
      check(!trigger(host, 2), "pathless conversation has no borrowed Git branch");
      popup = await open(probe, 0, "project"); click(find(popup, "新建工作区"));
      check(useAppStore.getState().createProjectDialogOpen, "new workspace opens existing project creation workflow");
      set({ createProjectDialogOpen: false });
      popup = await open(probe, 0, "project"); click(find(popup, "连接 SSH"));
      check(useAppStore.getState().page === "settings" && useAppStore.getState().settingsTab === "remoteHosts", "SSH action reaches existing Remote Hosts settings");

      restoreOwner();
      set(state => ({ sessions: state.sessions.map(item => item.id === "activity-a" ? { ...item, source: "remote" } : item) }));
      check(trigger(host, 0)?.disabled && !trigger(host, 2), "remote-owned session disables local project actions and hides local branch");
      restoreOwner(); deferWorktree = true;
      popup = await open(probe, 1, "footer-location"); click(find(popup, worktreeLabel)); click(find(popup, "新建工作树"));
      input(popup.querySelector("input"), "late-result"); click(find(popup, "创建工作树"));
      await until(() => Boolean(deferredWorktree), "Deferred worktree request did not begin");
      close(); popup = await open(probe, 0, "project"); click(find(popup, "Notes project"));
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === "/isolated/docs", "Concurrent project switch did not finish");
      const newOwner = useAppStore.getState().activeSessionId;
      const lateTree = worktrees.find(item => item.branch === "late-result")!;
      deferredWorktree!({ git: snapshot(path), worktree: lateTree });
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(useAppStore.getState().activeSessionId === newOwner && useAppStore.getState().workspace?.path === "/isolated/docs", "late worktree result does not navigate a different session");
      check(!calls.includes("session:/isolated/managed/late-result"), "late result does not create a foreign session");

      restoreOwner(); deferSwitch = true;
      popup = await open(probe, 2, "footer-branch"); click(find(popup, "feature/menu"));
      await until(() => Boolean(deferredSwitch), "Deferred branch request did not begin");
      close(); popup = await open(probe, 0, "project"); click(find(popup, "Notes project"));
      await until(() => useAppStore.getState().sessions.find(item => item.id === useAppStore.getState().activeSessionId)?.projectPath === "/isolated/docs", "Project switch during checkout did not finish");
      const branchOwner = useAppStore.getState().activeSessionId;
      deferredSwitch!({ git: { ...snapshot(path), branch: "feature/late" } });
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(useAppStore.getState().activeSessionId === branchOwner && useAppStore.getState().workspace?.branch === "main" && useAppStore.getState().openProjects.find(item => item.path === path)?.branch !== "feature/late", "late branch result cannot leak into another project or repaint old metadata");
    } finally {
      dirty = false; failSwitch = false; deferSwitch = false; deferWorktree = false; branch = "main";
      nestedWorktrees = nestedWorktrees.filter(item => item.path === nestedRoot || item.path === nestedManaged);
      set(baseline); close();
    }
  }
  async function scene(probe: Probe, scene: FooterScene) {
    close();
    // Earlier probes leave a running Goal checkpoint, which keeps Composer active
    // even after the agent run flags are cleared. Menu scenes require an idle strip.
    set({ isRunning: false, runningSessions: {}, planCheckpoints: {}, activeProjectPath: path, openProjectPaths: [path, "/isolated/docs"], openProjects: [{ path, name: "PI-Desktop", branch: "main" }, { path: "/isolated/docs", name: "Notes project", branch: "main" }] });
    probe.check(probe.host.querySelector('.composer-top-strip')?.getAttribute('data-expanded') === 'true'
      && Boolean(probe.host.querySelector('.composer-footer-project button:not(:disabled)')), `${scene} starts with idle workspace controls`);
    const kind = scene === "project-menu" ? "project" : scene === "branch-menu" ? "footer-branch" : "footer-location";
    const index = scene === "project-menu" ? 0 : scene === "branch-menu" ? 2 : 1;
    const popup = await open(probe, index, kind);
    if (scene === "worktree-create") {
      probe.click(find(popup, worktreeLabel)); probe.click(find(popup, "新建工作树"));
      input(popup.querySelector("input"), "feature/composer-refinement");
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
    const bounds = popup.getBoundingClientRect();
    probe.check(bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight, `${scene} stays within viewport`);
    probe.check(popup.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)), `${scene} paints above conversation: hit=${document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.outerHTML.slice(0, 250)}; style=${getComputedStyle(popup).visibility}/${getComputedStyle(popup).opacity}`);
    probe.check(getComputedStyle(popup).backgroundColor !== "rgba(0, 0, 0, 0)", `${scene} has an opaque surface`);
  }
  return { run, scene, restore: () => Object.assign(api, original) };
}
