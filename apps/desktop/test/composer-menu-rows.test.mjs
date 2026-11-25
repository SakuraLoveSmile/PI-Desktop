import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  esbuild: { jsx: "automatic" },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => server.close());

const { ComposerModelList } = await server.ssrLoadModule(
  "/src/features/chat/composer/ComposerModelList.tsx",
);
const { ComposerExecutionProfileOptions } = await server.ssrLoadModule(
  "/src/features/chat/composer/ComposerExecutionProfilePicker.tsx",
);
const { fileDir, fileLeaf, searchPlusMenuFiles, PLUS_MENU_FILE_LIMIT } = await server.ssrLoadModule(
  "/src/features/chat/composer/plus-menu-files.ts",
);
const { ComposerPlusMenuBody } = await server.ssrLoadModule(
  "/src/features/chat/composer/ComposerPlusMenuBody.tsx",
);

const t = (key) => key;
const rowsOf = (html) => html.split("<button").slice(1);

function modelInfo(modelId, extra = {}) {
  return {
    modelId,
    displayName: modelId,
    providerId: "acme",
    capabilities: ["text"],
    source: "user",
    ...extra,
  };
}

function renderModelList(selectedModelId) {
  const provider = {
    id: "acme",
    defaultModelId: "acme-large",
    models: [{ id: "acme-large" }, { id: "acme-fast", alias: "Fast" }, { id: "acme-vision", supportsImages: true }],
  };
  return renderToStaticMarkup(
    createElement(ComposerModelList, {
      t,
      modelListRef: { current: null },
      modelGroups: [
        {
          provider,
          providerDisplayName: "Acme Cloud",
          models: [
            modelInfo("acme-large", { reasoning: true, contextWindow: 200_000 }),
            modelInfo("acme-fast", { contextWindow: 1_048_576 }),
            modelInfo("acme-vision"),
          ],
        },
      ],
      modelHighlight: -1,
      setModelHighlight() {},
      selectedProviderId: "acme",
      selectedModelId,
      selectModel() {},
    }),
  );
}

test("a model row is one line: the name, the context figure, capability icons and a check slot", () => {
  const rows = rowsOf(renderModelList("acme-large"));
  assert.equal(rows.length, 3);
  for (const row of rows) assert.match(row, /role="menuitemradio"/);

  // The wire id stays one hover away on every row.
  assert.match(rows[0], /title="acme-large"/);
  assert.match(rows[1], /title="acme-fast"/);

  // The provider is the group heading, never repeated on a row, and a row
  // carries no icon tile.
  const html = renderModelList("acme-large");
  assert.equal(html.split("Acme Cloud").length - 1, 2, "the heading's label and its aria-label only");
  for (const row of rows) {
    assert.doesNotMatch(row, /Acme Cloud/);
    assert.doesNotMatch(row, /composer-model-option-icon|composer-model-option-provider/);
  }

  // Context figures read as a column: the row without a published window keeps
  // an empty cell, so the icons and the check stay in line.
  assert.match(rows[0], /<span class="composer-model-option-ctx">200K<\/span>/);
  assert.match(rows[1], /<span class="composer-model-option-ctx">1\.05M<\/span>/);
  assert.match(rows[2], /<span class="composer-model-option-ctx"><\/span>/);
});

test("the current model row is marked by a check in a fixed slot, never by hiding the others' slot", () => {
  const rows = rowsOf(renderModelList("acme-large"));
  assert.match(rows[0], /aria-checked="true"/);
  assert.match(rows[0], /<span class="composer-menu-check-slot" aria-hidden="true"><svg[^>]*composer-menu-check/);
  for (const row of rows.slice(1)) {
    assert.match(row, /aria-checked="false"/);
    assert.match(row, /<span class="composer-menu-check-slot" aria-hidden="true"><\/span>/);
  }

  const alias = rowsOf(renderModelList("acme-fast"));
  assert.match(alias[1], /aria-checked="true"/);
  assert.doesNotMatch(alias[0], /composer-menu-check"/);
});

test("a model row shows one name, the alias winning, and capabilities as labelled icons", () => {
  const rows = rowsOf(renderModelList("acme-large"));
  assert.match(rows[1], /<span class="composer-model-label is-alias">Fast<\/span>/);
  assert.match(rows[0], /<span class="composer-model-label\s*">acme-large<\/span>/);
  assert.doesNotMatch(rows[0], /is-alias/);

  assert.match(rows[0], /aria-label="chat\.modelBadgeReasoning"/);
  assert.doesNotMatch(rows[0], /chat\.modelBadgeVision/);
  assert.match(rows[2], /aria-label="chat\.modelBadgeVision"/);
  assert.doesNotMatch(rows[2], /chat\.modelBadgeReasoning/);
  assert.doesNotMatch(rows[1], /chat\.modelBadge/);
});

function renderProfileOptions(props = {}) {
  return renderToStaticMarkup(
    createElement(ComposerExecutionProfileOptions, {
      t,
      executionProfile: "standard",
      controlsBlocked: false,
      canSwitchToStandard: true,
      onChoose() {},
      ...props,
    }),
  );
}

test("the execution profile menu lists the two profiles, each a name over its description", () => {
  const html = renderProfileOptions();
  const rows = rowsOf(html);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row, /role="menuitemradio"/);
    assert.match(row, /composer-plus-item is-two-line/);
  }
  assert.match(rows[0], /composer-plus-item-name">chat\.profileAgent<\/span><span class="composer-plus-item-desc">chat\.profileAgentDesc</);
  assert.match(rows[1], /composer-plus-item-name">chat\.profileTeam<\/span><span class="composer-plus-item-desc">chat\.profileTeamDesc</);

  // The team's warning line is gone: the description already says what it does.
  assert.doesNotMatch(html, /profileTeamNotice/);
});

test("the current profile carries the check, and a running team cannot be switched back mid-run", () => {
  const standard = rowsOf(renderProfileOptions({ executionProfile: "standard" }));
  assert.match(standard[0], /aria-checked="true"/);
  assert.match(standard[0], /composer-menu-check/);
  assert.match(standard[1], /aria-checked="false"/);
  assert.doesNotMatch(standard[1], /composer-menu-check/);

  const team = rowsOf(renderProfileOptions({ executionProfile: "team", canSwitchToStandard: false }));
  assert.match(team[1], /aria-checked="true"/);
  assert.match(team[0], /disabled=""/, "the standard row waits for the teammates");
  assert.doesNotMatch(team[1], /disabled=""/);

  // Standard stays freely switchable while the profile is standard, and a
  // team may be left once nothing is running.
  assert.doesNotMatch(rowsOf(renderProfileOptions({ canSwitchToStandard: false }))[0], /disabled=""/);
  assert.doesNotMatch(rowsOf(renderProfileOptions({ executionProfile: "team" }))[0], /disabled=""/);
});

test("blocked controls disable both profile rows", () => {
  for (const row of rowsOf(renderProfileOptions({ controlsBlocked: true }))) {
    assert.match(row, /disabled=""/);
  }
});

test("the Add menu lists workspace files only for a search, matching any part of the path", () => {
  const entries = [
    { path: "src/app/Composer.tsx", kind: "file" },
    { path: "src/app", kind: "dir" },
    { path: "docs/Readme.md", kind: "file" },
  ];
  assert.deepEqual(searchPlusMenuFiles(entries, ""), []);
  assert.deepEqual(searchPlusMenuFiles(entries, "   "), []);
  assert.deepEqual(
    searchPlusMenuFiles(entries, " COMPOSER ").map((entry) => entry.path),
    ["src/app/Composer.tsx"],
  );
  assert.deepEqual(
    searchPlusMenuFiles(entries, "src/app").map((entry) => entry.path),
    ["src/app/Composer.tsx", "src/app"],
  );

  const many = Array.from({ length: PLUS_MENU_FILE_LIMIT + 5 }, (_, index) => ({
    path: `pkg/file-${index}.ts`,
    kind: "file",
  }));
  const found = searchPlusMenuFiles(many, "file");
  assert.equal(found.length, PLUS_MENU_FILE_LIMIT);
  assert.equal(found[0].path, "pkg/file-0.ts", "the index order is kept");
});

test("a file row splits into its name and the folder it sits in", () => {
  assert.equal(fileLeaf("src/app/Composer.tsx"), "Composer.tsx");
  assert.equal(fileLeaf("src\\app\\Composer.tsx"), "Composer.tsx");
  assert.equal(fileLeaf("README.md"), "README.md");
  assert.equal(fileDir("src/app/Composer.tsx"), "src/app");
  assert.equal(fileDir("src\\app\\Composer.tsx"), "src/app", "separators are shown as slashes");
  assert.equal(fileDir("README.md"), "", "a file at the root has no folder line");
});

// The Add menu's rows are rendered by the real body component; the portal that
// positions them is the only part left out.
const tWithFallback = (key, fallback) => (typeof fallback === "string" ? fallback : key);

function renderPlusBody(props = {}) {
  return renderToStaticMarkup(
    createElement(ComposerPlusMenuBody, {
      t: tWithFallback,
      mode: "agent",
      controlsBlocked: false,
      query: "",
      onQueryChange() {},
      files: [],
      pluginCommands: [],
      otherCommands: [],
      onPickAndAttach() {},
      onInsertReference() {},
      onInsertCommand() {},
      onToggleMode() {},
      ...props,
    }),
  );
}

const menuItems = (html) => rowsOf(html).filter((row) => /role="menuitem"/.test(row));
const switches = (html) => rowsOf(html).filter((row) => /role="switch"/.test(row));

test("the Add menu offers attaching and the two mode switches, and no profile rows", () => {
  const html = renderPlusBody();
  const items = menuItems(html);
  assert.equal(items.length, 1, "without a search only the attach row is listed");
  assert.match(items[0], /composer-plus-item-name">chat\.addFiles</);
  assert.doesNotMatch(html, /composer-plus-group-title/);
  assert.doesNotMatch(html, /menuitemradio|profileAgent|profileTeam/, "the execution profile lives in its own menu");

  const [plan, goal] = switches(html);
  assert.match(plan, /aria-label="settings\.modePlan"/);
  assert.match(goal, /aria-label="settings\.modeGoal"/);
  assert.match(plan, /aria-checked="false"/);
  assert.match(goal, /aria-checked="false"/);
});

test("the mode switches show the current mode and lock while controls are blocked", () => {
  const [plan, goal] = switches(renderPlusBody({ mode: "plan" }));
  assert.match(plan, /aria-checked="true"/);
  assert.match(goal, /aria-checked="false"/);

  for (const row of switches(renderPlusBody({ controlsBlocked: true }))) {
    assert.match(row, /disabled=""/);
  }
});

test("a file result is its name with the folder after it; folders and root files add no folder line", () => {
  const html = renderPlusBody({
    query: "app",
    files: [
      { path: "src/app/Composer.tsx", kind: "file" },
      { path: "src/app", kind: "dir" },
      { path: "README.md", kind: "file" },
    ],
  });
  assert.match(html, /composer-plus-group-title">File references</);
  const [, file, folder, root] = menuItems(html);

  assert.match(file, /title="src\/app\/Composer\.tsx"/);
  assert.match(file, /composer-plus-item-name">Composer\.tsx<\/span><span class="composer-plus-item-desc">src\/app</);

  assert.match(folder, /composer-plus-item-name">src\/app<\/span>/);
  assert.doesNotMatch(folder, /composer-plus-item-desc/);

  assert.match(root, /composer-plus-item-name">README\.md<\/span><span class="composer-plus-item-desc"><\/span>/);
});

test("a command row is its name with a one-line description, falling back to its title", () => {
  const html = renderPlusBody({
    pluginCommands: [
      { id: "plugin.deploy", name: "deploy", kind: "plugin", title: "Deploy", description: "Ship the build" },
    ],
    otherCommands: [
      { id: "builtin.context.inspect", name: "context", kind: "builtin", title: "Context", description: "raw text" },
      { id: "skill.review", name: "review", kind: "skill", title: "Review", description: "" },
    ],
  });
  assert.match(html, /composer-plus-group-title">Plugin commands</);
  assert.match(html, /composer-plus-group-title">Commands</);
  const [, deploy, context, review] = menuItems(html);

  assert.match(deploy, /composer-plus-item-name">\/deploy<\/span><span class="composer-plus-item-desc">Ship the build</);
  assert.match(context, /composer-plus-item-desc">contextInsights\.title</, "the inspector shows its translated title");
  assert.doesNotMatch(context, /raw text/);
  assert.match(review, /composer-plus-item-desc">Review</, "a command without a description shows its title");
});
