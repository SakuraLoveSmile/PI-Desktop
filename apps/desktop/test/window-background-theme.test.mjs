import { readAppSource, readMainSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protocolSource = await readFile(
  new URL("../../../packages/shared/src/protocol.ts", import.meta.url),
  "utf8",
);
const mainSource = await readMainSource();
const apiSource = await readFile(
  new URL("../src/lib/api.ts", import.meta.url),
  "utf8",
);
const appSource = await readAppSource();

test("theme changes synchronize the native non-macOS window background", () => {
  assert.match(
    protocolSource,
    /windowSetBackgroundColor:\s*"pi-desktop\/window\/setBackgroundColor"/,
  );
  assert.match(
    apiSource,
    /setWindowBackgroundColor:\s*\(theme:\s*"light" \| "dark",\s*color\?:\s*string\)[\s\S]*?IPC\.invoke\.windowSetBackgroundColor/,
  );
  assert.match(
    mainSource,
    /handle\(IPC\.invoke\.windowSetBackgroundColor,[\s\S]*?!isWindowBackgroundColor\(requested\)[\s\S]*?mainWindow\.setBackgroundColor\(color\)/,
  );
  // A malformed colour is refused; an omitted one falls back to the host
  // palette, which is what restores the default after a theme switch.
  assert.match(mainSource, /isWindowBackgroundColor\(requested\)\s*\n?\s*\? requested/);
  assert.match(mainSource, /: theme === "light"\s*\n?\s*\? "#ffffff"\s*\n?\s*: "#181818"/);
  assert.match(
    mainSource,
    /process\.platform === "darwin"\) return \{ applied: false, theme \};/,
  );
  assert.match(
    appSource,
    /document\.documentElement\.dataset\.theme = resolvedTheme;/,
  );
  assert.ok(
    appSource.includes(
      "setWindowBackgroundColor(resolvedTheme, pluginTheme?.windowBackground?.[resolvedTheme])",
    ),
  );
});
