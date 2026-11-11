#!/usr/bin/env node
/** Include capture entry points in the real Desktop TypeScript program. */
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const desktop = join(root, "apps/desktop");
const require = createRequire(join(desktop, "package.json"));
const ts = require("typescript");
const config = ts.readConfigFile(join(desktop, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, desktop);
const options = { ...parsed.options, noEmit: true, paths: {
  ...parsed.options.paths,
  "@pi-desktop/shared": [join(root, "packages/shared/src/index.ts")],
  "@pi-desktop/shared/*": [join(root, "packages/shared/src/*")],
  "@pi-desktop/i18n": [join(root, "packages/i18n/src/index.ts")],
  "@pi-desktop/i18n/*": [join(root, "packages/i18n/src/*")],
} };
const program = ts.createProgram([...parsed.fileNames, join(here, "renderer.tsx"), join(here, "fixtures.ts")], options);
const diagnostics = [config.error, ...parsed.errors, ...ts.getPreEmitDiagnostics(program)].filter(Boolean);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  process.exitCode = 1;
} else console.log("UI capture and Desktop TypeScript: 0 diagnostics (no emit)");
