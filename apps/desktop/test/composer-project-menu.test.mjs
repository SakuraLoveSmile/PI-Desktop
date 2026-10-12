import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { slotSsr } from "./helpers/slot-ssr.mjs";

test("project footer trigger remains reachable without a workspace", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerProjectMenu } = await ssr.load("/src/features/chat/composer/ComposerProjectMenu.tsx");
  const { useAppStore } = await ssr.load("/src/stores/app-store.ts");
  useAppStore.setState({ activeSessionId: undefined, sessions: [], workspace: null });
  const html = ssr.render(createElement(ComposerProjectMenu, {}));
  assert.match(html, /composer-workspace-item composer-footer-trigger/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(html, /<span>[^<]+<\/span>/);
});

test("project footer labels the owning project and respects disabled surfaces", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerProjectMenu } = await ssr.load("/src/features/chat/composer/ComposerProjectMenu.tsx");
  const { useAppStore } = await ssr.load("/src/stores/app-store.ts");
  useAppStore.setState({ activeSessionId: "local", sessions: [{ id: "local", source: "desktop" }] });
  const props = { path: "/isolated/project-a", name: "Project A" };
  const html = ssr.render(createElement(ComposerProjectMenu, props));
  assert.match(html, /aria-label="[^"]*: Project A"/);
  assert.match(html, /<span>Project A<\/span>/);
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(ssr.render(createElement(ComposerProjectMenu, { ...props, disabled: true })), /disabled=""/);
});

test("the owning context can disable the project footer for a remote conversation", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerProjectMenu } = await ssr.load("/src/features/chat/composer/ComposerProjectMenu.tsx");
  const { useAppStore } = await ssr.load("/src/stores/app-store.ts");
  useAppStore.setState({
    activeSessionId: "remote",
    sessions: [{ id: "remote", source: "remote" }],
    workspace: { path: "/isolated/local", name: "Local" },
  });
  const html = ssr.render(createElement(ComposerProjectMenu, {
    path: "/remote/project", name: "Remote project", disabled: true,
  }));
  assert.match(html, /<span>Remote project<\/span>/);
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-expanded="false"/);
});
