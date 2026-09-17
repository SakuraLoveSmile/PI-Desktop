import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperSource = await readFile(
  new URL("../src/lib/open-http-url.ts", import.meta.url),
  "utf8",
);
const markdownSource = await readFile(
  new URL("../src/components/Markdown.tsx", import.meta.url),
  "utf8",
);
const previewSource = await readFile(
  new URL("../src/hooks/use-preview-target.ts", import.meta.url),
  "utf8",
);
const pluginSheetSource = await readFile(
  new URL("../src/features/plugins/PluginDetailSheet.tsx", import.meta.url),
  "utf8",
);
const workPanelSource = await readFile(
  new URL("../src/stores/slices/work-panel-slice.ts", import.meta.url),
  "utf8",
);

test("resolveLinkOpenTarget treats only external as the OS browser", () => {
  assert.match(
    helperSource,
    /return linkOpenTarget === "external" \? "external" : "workpanel";/,
  );
});

test("work-panel destination returns to chat when a session can show it", () => {
  assert.match(helperSource, /return Boolean\(state.activeSessionId\);/);
  assert.match(helperSource, /if \(state.page !== "chat"\) \{/);
  assert.match(helperSource, /state.setPage\("chat"\);/);
  assert.match(
    helperSource,
    /wantsWorkPanel && canPresentWorkPanelBrowser\(state\)/,
  );
  assert.match(helperSource, /state.openUrlInWorkPanel\(trimmed\);/);
  assert.match(helperSource, /void api.browserOpenExternal\(trimmed\);/);
});

test("chat markdown HTTP clicks share openHttpUrl", () => {
  assert.match(markdownSource, /import \{ openHttpUrl \} from "\.\.\/lib\/open-http-url"/);
  assert.match(markdownSource, /openHttpUrl\(href\)/);
  assert.match(markdownSource, /openHttpUrl\(target\.url\)/);
  assert.match(markdownSource, /openHttpUrl\(source\)/);
  assert.doesNotMatch(
    markdownSource,
    /if \(linkOpenTarget === "external"\) \{\s*void api\.browserOpenExternal\(href\);/,
  );
});

test("previewable transcript URLs follow the link-open setting", () => {
  assert.match(previewSource, /import \{ openHttpUrl \} from "\.\.\/lib\/open-http-url"/);
  assert.match(
    previewSource,
    /target\.kind === "file" \? openFileRef\(target\.path\) : openHttpUrl\(target\.url\)/,
  );
});

test("plugin homepage and repository links follow the link-open setting", () => {
  assert.match(pluginSheetSource, /import \{ openHttpUrl \} from "\.\.\/\.\.\/lib\/open-http-url"/);
  assert.match(pluginSheetSource, /openHttpUrl\(link\.url\)/);
  assert.match(pluginSheetSource, /openHttpUrl\(activeVersion\.provenance!\.sourceRepository\)/);
  assert.doesNotMatch(pluginSheetSource, /openUrlInWorkPanel\(/);
});

test("forced work-panel preview does not read linkOpenTarget", () => {
  assert.doesNotMatch(workPanelSource, /linkOpenTarget/);
});
