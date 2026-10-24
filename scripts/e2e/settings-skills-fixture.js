import { IPC } from "@pi-desktop/shared";

const PROJECT_PATH = "/fixture/projects/desktop-demo";
const SECOND_PROJECT_PATH = "/fixture/projects/utility-demo";
const STAMP = "2026-10-23T00:00:00.000Z";

function record(id, name, level, description, projectPath = PROJECT_PATH) {
  return {
    id, name, level, description, enabled: true, source: "created", sizeBytes: 128,
    path: `${level === "global" ? "/fixture/home" : projectPath}/.agents/skills/${id}/SKILL.md`,
    ...(level === "project" ? { projectPath } : {}),
    scope: level === "global" ? { mode: "global", projects: [] } : { mode: "projects", projects: [projectPath] },
    createdAt: STAMP, updatedAt: STAMP,
  };
}

/** Explicit preload-only boundaries; no filesystem or runtime services are used. */
export function createSkillsFixture(parameters) {
  const populated = parameters.get("skills") === "populated";
  const skills = populated ? [
    record("review-notes", "Review notes", "global", "Prepare a focused code review checklist."),
    record("project-checks", "Project checks", "project", "Run the checks used by this project."),
    record("utility-checks", "Utility checks", "project", "Checks for the other project.", SECOND_PROJECT_PATH),
  ] : [];
  const bodies = new Map(skills.map((skill) => [skill.id, `# ${skill.name}\n\nFixture instructions.`]));
  const calls = [];
  const required = new Set([
    IPC.invoke.projectList, IPC.invoke.projectGroupList, IPC.invoke.skillList, IPC.invoke.skillRead, IPC.invoke.skillCreate,
    IPC.invoke.skillUpdate, IPC.invoke.skillSetEnabled, IPC.invoke.skillImport,
    IPC.invoke.piSkillDiscover, IPC.invoke.piSkillImport,
  ]);
  function invoke(channel, input) {
    if (!required.has(channel)) return { handled: false };
    calls.push({ channel, input });
    const find = () => {
      const skill = skills.find((candidate) => candidate.id === input.id && candidate.level === input.level);
      if (!skill) throw new Error(`Unknown fixture skill: ${input.id} at ${input.level}`);
      return skill;
    };
    let data;
    switch (channel) {
      case IPC.invoke.projectList:
        data = { projects: populated ? [{ id: 1, name: "Desktop demo", path: PROJECT_PATH,
          pinned: false, createdAt: 1, lastOpenedAt: 1 },
          { id: 2, name: "Utility demo", path: SECOND_PROJECT_PATH, pinned: false, createdAt: 1, lastOpenedAt: 1 }] : [] };
        break;
      case IPC.invoke.projectGroupList:
        data = { groups: [] };
        break;
      case IPC.invoke.skillList:
        if (!["global", "project"].includes(input?.level)) throw new Error("Fixture skill level is required");
        data = { skills: skills.filter((skill) => skill.level === input.level &&
          (skill.level !== "project" || input.projectPath === skill.projectPath)).map((skill) => ({ ...skill })) };
        break;
      case IPC.invoke.skillRead: {
        const skill = find();
        data = { skill: { ...skill }, body: bodies.get(skill.id) };
        break;
      }
      case IPC.invoke.skillCreate: {
        const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (input.level === "project" && !input.projectPath) throw new Error("Project creation requires a project path");
        const skill = { ...record(id, input.name, input.level, input.description, input.projectPath),
          enabled: input.enabled, scope: input.scope };
        skills.push(skill);
        bodies.set(id, input.body);
        data = { skill: { ...skill } };
        break;
      }
      case IPC.invoke.skillUpdate: {
        const skill = find();
        Object.assign(skill, { name: input.name, description: input.description,
          enabled: input.enabled, scope: input.scope });
        bodies.set(skill.id, input.body);
        data = { skill: { ...skill } };
        break;
      }
      case IPC.invoke.skillSetEnabled:
        find().enabled = input.enabled;
        data = {};
        break;
      case IPC.invoke.skillImport:
      case IPC.invoke.piSkillImport:
        data = { canceled: true };
        break;
      case IPC.invoke.piSkillDiscover:
        if (parameters.get("cli") === "error") throw new Error("Fixture discovery unavailable");
        data = { candidates: [], errors: [] };
        break;
      default: throw new Error(`Missing Skills fixture branch: ${channel}`);
    }
    return { handled: true, data };
  }
  return { invoke, calls, populated, projectPath: PROJECT_PATH };
}

/** Representative user paths through the production Skills screen. */
export async function exerciseSkillsPage({ fixture, t, select, settle, flushSync, assert }) {
  const page = () => document.querySelector(".skills-settings");
  const textButton = (root, label) => [...root.querySelectorAll("button")]
    .find((button) => button.textContent.trim() === label);
  async function click(button, message) {
    assert(button instanceof HTMLButtonElement, message);
    assert(!button.disabled, `${message}: must be enabled`);
    flushSync(() => button.click());
    await settle();
  }
  async function input(node, value) {
    assert(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement, "Input must be present");
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  }
  const rows = () => [...page().querySelectorAll('[role="listitem"]')];
  const filter = async (level) => {
    const label = t(`settings.capabilityFilter${level}`);
    const control = [...page().querySelectorAll(".agent-capability-segment button")]
      .find((button) => button.textContent.startsWith(label));
    await click(control, `Scope filter ${label}`);
  };
  const newButton = () => textButton(page(), t("settings.newSkill"));
  const dialog = () => document.querySelector('[role="dialog"]');
  async function dismissEditor() {
    await click(textButton(dialog(), t("common.cancel")), "Cancel editor");
    assert(!dialog(), "Cancel must close the editor without saving");
  }
  async function openCreate(expectedScope) {
    await click(newButton(), "Create a skill");
    assert(dialog()?.textContent.includes(expectedScope), "Editor must identify the creation scope");
  }
  async function fillAndSave(name, description) {
    await input(dialog().querySelector("input"), name);
    await input(dialog().querySelector("textarea"), description);
    await input(dialog().querySelector(".ext-skill-body"), `# ${name}\n\nUse these fixture instructions.`);
    await click(textButton(dialog(), t("common.save")), "Save skill");
    assert(!dialog(), "Successful save must return to the Skills list");
  }

  await select(t("settings.skills"));
  assert(page(), "Skills destination must render its production workbench");
  const primaryActions = [...page().querySelectorAll("button.btn-primary")];
  assert(primaryActions.length === 1 && primaryActions[0] === newButton(),
    "The page must offer one primary New action rather than duplicate empty-state calls to action");
  const headers = [...page().querySelectorAll(".agent-capability-group")];
  for (const [index, header] of headers.entries()) {
    const canImport = index === 0 || fixture.populated;
    const importFile = textButton(header, t("settings.importSkillFile"));
    const importFolder = textButton(header, t("settings.importSkillDir"));
    assert(canImport ? importFile && importFolder : !importFile && !importFolder,
      "Each available scope header must keep file and folder import actions together");
  }
  assert(!page().querySelector(".pi-skill-discovery-dismiss"), "CLI discovery must initially be collapsed");
  assert(!fixture.calls.some((call) => call.channel === IPC.invoke.piSkillDiscover),
    "Opening Skills must not scan local CLI packages");
  const search = page().querySelector('input[type="search"]');
  await input(search, "not-a-fixture-skill");
  assert(page().textContent.includes(t("settings.capabilityNoMatches")), "Unmatched Skills search must explain no matches");
  await click(page().querySelector(`button[aria-label="${t("settings.clearSearch")}"]`), "Clear Skills search");
  assert(search.value === "", "Clear must reset Skills search");

  if (!fixture.populated) {
    assert(rows().length === 0 && page().textContent.includes(t("settings.skillsEmpty")),
      "Empty installation must show a useful empty state");
    await filter("Project");
    assert(newButton()?.disabled, "Project creation must be disabled until a project exists");
    assert(!textButton(page(), t("settings.importSkillFile")) && !textButton(page(), t("settings.importSkillDir")),
      "A missing project must not offer project import");
    assert(page().textContent.includes(t("settings.selectProjectFirst")), "Missing project must explain what is needed");
    await click(textButton(page(), t("settings.skillsManageProjects")), "Manage projects from empty state");
    assert(!page() && document.querySelector(".settings-section-title")?.textContent.includes(t("settings.projectArchive")),
      "Manage projects must navigate to the project settings");
    return { skillsEmpty: true, scopedCreationGuard: true, manageProjects: true, deferredCliDiscovery: true };
  }

  assert(rows().length === 2, "All must show both global and project skills");
  await openCreate(t("settings.globalScope"));
  await fillAndSave("Fixture global skill", "Available across projects.");
  assert(rows().some((row) => row.textContent.includes("Fixture global skill")),
    "Creating from All must save a global skill and return to the list");
  const globalCreateCall = fixture.calls.findLast((call) => call.channel === IPC.invoke.skillCreate);
  assert(globalCreateCall.input.level === "global" && !globalCreateCall.input.projectPath &&
    globalCreateCall.input.scope.mode === "global",
    "All creation must write to the global scope without a project destination");
  await filter("Project");
  assert(rows().length === 1 && rows()[0].textContent.includes("Project checks"), "Project filter must show only selected-project skills");
  await openCreate(t("settings.projectScope", { project: "Desktop demo" }));
  await fillAndSave("Fixture project skill", "Only for the selected project.");
  assert(rows().some((row) => row.textContent.includes("Fixture project skill")), "Created project skill must appear in its list");
  const projectBeforeImport = rows().map((row) => row.textContent).join("|");
  await click(textButton(page(), t("settings.importSkillDir")), "Import project skill folder");
  assert(rows().map((row) => row.textContent).join("|") === projectBeforeImport,
    "Canceling project folder import must preserve the selected project's list");
  const folderImportCall = fixture.calls.findLast((call) => call.channel === IPC.invoke.skillImport);
  assert(folderImportCall.input.level === "project" && folderImportCall.input.sourceKind === "dir" &&
    folderImportCall.input.projectPath === fixture.projectPath,
    "Folder import must identify the selected project destination and directory source kind");
  async function chooseProject(name) {
    await click(page().querySelector(`button[aria-label="${t("settings.selectProject")}"]`), "Choose project");
    const option = [...document.querySelectorAll('[role="option"]')]
      .find((candidate) => candidate.textContent.trim() === name);
    await click(option, `Select project ${name}`);
  }
  await chooseProject("Utility demo");
  assert(rows().length === 1 && rows()[0].textContent.includes("Utility checks"),
    "Changing project must replace project skills with the selected project's collection");
  await chooseProject("Desktop demo");
  assert(rows().length === 2 && rows().some((row) => row.textContent.includes("Fixture project skill")),
    "Returning to a project must restore its saved skill collection");
  const createCall = fixture.calls.findLast((call) => call.channel === IPC.invoke.skillCreate);
  assert(createCall.input.level === "project" && createCall.input.projectPath === fixture.projectPath,
    "Project creation must retain the selected project at the preload boundary");

  await filter("Global");
  assert(rows().length === 2 && rows().some((row) => row.textContent.includes("Fixture global skill")) &&
    !rows().some((row) => row.textContent.includes("Fixture project skill")),
    "Global filter must show the saved global skill and hide project skills");
  await openCreate(t("settings.globalScope"));
  await dismissEditor();
  const globalRow = rows()[0];
  const toggle = globalRow.querySelector('[role="switch"]');
  assert(toggle?.getAttribute("aria-checked") === "true", "Fixture global skill must initially be active");
  await click(toggle, "Toggle the global skill");
  assert(rows()[0].querySelector('[role="switch"]').getAttribute("aria-checked") === "false", "Toggle must visibly disable the skill");
  const toggleCall = fixture.calls.findLast((call) => call.channel === IPC.invoke.skillSetEnabled);
  assert(toggleCall.input.level === "global" && toggleCall.input.id === "review-notes" && !toggleCall.input.enabled,
    "Toggle must preserve the global skill identity and ownership");

  await click(rows()[0].querySelector(".settings-icon-button"), "Edit the global skill");
  assert(dialog()?.querySelector("input").value === "Review notes", "Edit must load the selected skill");
  await fillAndSave("Review notes updated", "Updated fixture description.");
  assert(rows()[0].textContent.includes("Review notes updated"), "Saving an edit must update the visible list");
  const before = rows().map((row) => row.textContent).join("|");
  await click(textButton(page(), t("settings.importSkillFile")), "Import global skill file");
  assert(rows().map((row) => row.textContent).join("|") === before, "Canceling native import must preserve the list");
  const importCall = fixture.calls.findLast((call) => call.channel === IPC.invoke.skillImport);
  assert(importCall.input.level === "global" && importCall.input.sourceKind === "file",
    "File import must identify its destination and source kind");
  await filter("All");
  assert(rows().length === 4, "Returning to All must show saved skills across scopes");
  return { skillsPopulated: true, searchAndFilters: true, createGlobal: true, createProject: true,
    projectSwitch: true, editGlobal: true, toggleGlobal: true, canceledFileImport: true,
    canceledProjectFolderImport: true, deferredCliDiscovery: true };
}

/** Rendered geometry and interaction coverage at the supported narrow width. */
export async function exerciseSkillsNarrow({ t, select, settle, flushSync, assert }) {
  await select(t("settings.skills"));
  const page = document.querySelector(".skills-settings");
  const rows = [...page.querySelectorAll('[role="listitem"]')];
  assert(window.innerWidth === 560 && window.innerHeight === 780,
    "Narrow Skills regression must run at 560 by 780 CSS pixels");
  assert(rows.length === 2, "Narrow fixture must show global and project skills");
  for (const row of rows) {
    const name = row.querySelector(".agent-capability-name");
    assert(name && name.scrollWidth <= name.clientWidth + 1 && name.scrollHeight <= name.clientHeight + 1,
      `Narrow skill name must remain fully readable: ${name?.textContent} (${name?.clientWidth}/${name?.scrollWidth}px)`);
  }
  const controls = [...page.querySelectorAll("button, input")];
  for (const control of controls) {
    const bounds = control.getBoundingClientRect();
    assert(bounds.width > 0 && bounds.left >= 0 && bounds.right <= window.innerWidth + 1,
      `Narrow Skills control must stay inside the viewport: ${control.getAttribute("aria-label") || control.textContent.trim()}`);
  }
  const row = rows[0];
  const toggle = row.querySelector('[role="switch"]');
  toggle.scrollIntoView({ block: "nearest" });
  await settle();
  const bounds = toggle.getBoundingClientRect();
  const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  assert(toggle === hit || toggle.contains(hit), "Narrow skill toggle must be reachable by pointer");
  flushSync(() => toggle.click());
  await settle();
  assert(toggle.getAttribute("aria-checked") === "false", "Narrow skill toggle must visibly update");

  const edit = row.querySelector(".settings-icon-button");
  edit.scrollIntoView({ block: "nearest" });
  await settle();
  assert(Number(getComputedStyle(edit).opacity) > 0, "Narrow skill edit action must remain visible without hover");
  const editBounds = edit.getBoundingClientRect();
  const editHit = document.elementFromPoint(editBounds.left + editBounds.width / 2, editBounds.top + editBounds.height / 2);
  assert(edit === editHit || edit.contains(editHit), "Narrow skill edit action must be reachable by pointer");
  flushSync(() => edit.click());
  await settle();
  const dialog = document.querySelector('[role="dialog"]');
  assert(dialog?.querySelector("input").value === "Review notes", "Narrow edit must open the selected skill");
  const cancel = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === t("common.cancel"));
  flushSync(() => cancel.click());
  await settle();
  assert(!document.querySelector('[role="dialog"]'), "Narrow editor must close normally");
  return { skillsNarrow: true, viewport: [window.innerWidth, window.innerHeight],
    readableNames: true, controlsInViewport: true, toggleAndEdit: true };
}
