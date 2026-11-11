#!/usr/bin/env node
/** Opt-in, offline screenshots of production renderer components in fixture state. */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { arch, release, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { candidateIdentity, fixtureEnvironment } from "../e2e-suite-runtime.mjs";
import { resolveElectronBinary } from "../e2e/boot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const usage = "Usage: capture.mjs --output .artifacts/<new-run> [--build-only]";

export function parseArguments(args) {
  const result = { buildOnly: false };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === "--") continue;
    if (value === "--build-only" && !result.buildOnly) result.buildOnly = true;
    else if (value === "--output" && args[index + 1] && !result.output) result.output = args[++index];
    else throw new Error(usage);
  }
  if (!result.output) throw new Error(usage);
  return result;
}

export function captureEnvironment(parent, scratch, output, bundle) {
  const env = fixtureEnvironment(parent, scratch, {
    PI_DESKTOP_DATA_DIR: join(scratch, "data"),
    PI_UI_CAPTURE_OUTPUT: output,
    PI_UI_CAPTURE_BUNDLE: bundle,
    TZ: "UTC",
  });
  // This renderer harness never starts a Host, even if a caller selected one.
  delete env.PI_DESKTOP_HOST_BIN;
  return env;
}

export async function createCaptureOutput(path, directory = root) {
  const rootReal = await realpath(directory);
  const output = resolve(rootReal, path);
  const artifacts = join(rootReal, ".artifacts");
  const rel = relative(artifacts, output);
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error("Capture output must be a new directory under this worktree's .artifacts/");
  }
  let parent = rootReal;
  for (const name of relative(rootReal, dirname(output)).split(sep)) {
    parent = join(parent, name);
    let entry;
    try { entry = await lstat(parent); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (entry) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Capture output ancestors must be real worktree directories");
    } else await mkdir(parent);
  }
  await mkdir(output); // EEXIST is intentional: never overwrite prior evidence.
  return output;
}

export async function sourceIdentity(directory = root) {
  const { head, baseMain, dirty, workspaceDiffSha256 } = await candidateIdentity(directory, { includeHost: false });
  return { head, baseMain, dirty, workspaceDiffSha256 };
}

async function buildRenderer(bundle, config) {
  const desktop = join(root, "apps/desktop");
  const require = createRequire(join(desktop, "package.json"));
  const { build } = await import(pathToFileURL(require.resolve("vite")).href);
  const { default: tailwind } = await import(pathToFileURL(require.resolve("@tailwindcss/vite")).href);
  const fixedNow = Date.parse(config.settings.now);
  // Install before any imported component evaluates module-level dates.
  const banner = `(() => { const RealDate = Date; function FixtureDate(...args) {
    if (!new.target) return new RealDate(${fixedNow}).toString();
    return Reflect.construct(RealDate, args.length ? args : [${fixedNow}], new.target);
  } Object.setPrototypeOf(FixtureDate, RealDate); FixtureDate.prototype = RealDate.prototype;
  FixtureDate.now = () => ${fixedNow}; globalThis.Date = FixtureDate; })();`;
  await build({
    configFile: false, root: desktop, logLevel: "warn", plugins: [tailwind()],
    esbuild: { jsx: "automatic" },
    define: { "process.env.NODE_ENV": '"production"' },
    resolve: { alias: [
      { find: /^@pi-desktop\/i18n\/locales\/([^/]+)$/, replacement: join(root, "packages/i18n/src/locales/$1/index.ts") },
      { find: "@pi-desktop/i18n/locale-info", replacement: join(root, "packages/i18n/src/locale-info.ts") },
      { find: "@pi-desktop/i18n", replacement: join(root, "packages/i18n/src/index.ts") },
      { find: "@pi-desktop/shared", replacement: join(root, "packages/shared/src") },
      { find: "react", replacement: join(desktop, "node_modules/react") },
      { find: "react-dom", replacement: join(desktop, "node_modules/react-dom") },
    ] },
    build: {
      outDir: bundle, emptyOutDir: false, minify: false,
      lib: { entry: join(here, "renderer.tsx"), name: "PiUiCapture", formats: ["iife"], fileName: () => "renderer.js", cssFileName: "renderer" },
      rollupOptions: { output: { inlineDynamicImports: true, banner } },
    },
  });
  await writeFile(join(bundle, "index.html"), `<!doctype html><html lang="zh-CN" data-theme="dark"><head>
    <meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'">
    <link rel="stylesheet" href="renderer.css"><title>PI-Desktop isolated UI fixtures</title></head>
    <body><div id="root"></div><script src="renderer.js"></script></body></html>`);
  await writeFile(join(bundle, "scenes.json"), JSON.stringify(config));
  await cp(join(here, "electron.cjs"), join(bundle, "electron.cjs"));
  await cp(join(here, "preload.cjs"), join(bundle, "preload.cjs"));
  await cp(join(here, "network.cjs"), join(bundle, "network.cjs"));
}

async function launch(electronBinary, bundle, output, scratch) {
  const env = captureEnvironment(process.env, scratch, output, bundle);
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "TMPDIR", "PI_DESKTOP_DATA_DIR"]) {
    await mkdir(env[key], { recursive: true });
  }
  const args = [join(bundle, "electron.cjs"), `--user-data-dir=${join(scratch, "chromium")}`];
  // AppKit's crash-restoration prompt precedes app.whenReady. Override only this
  // child's volatile argument domain, never the user's persistent preferences.
  if (process.platform === "darwin") args.push("-ApplePersistenceIgnoreState", "YES");
  const child = spawn(electronBinary, args, {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  let outputText = "";
  let timedOut = false;
  const onData = data => { const line = String(data); outputText += line; process.stdout.write(line); };
  child.stdout.on("data", onData); child.stderr.on("data", onData);
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === "win32") child.kill("SIGKILL");
    else if (child.pid) process.kill(-child.pid, "SIGKILL");
  }, 180_000);
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const result = await new Promise((resolveResult, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveResult({ code, signal }));
    });
    if (result.code !== 0 || timedOut) throw new Error(`Capture failed: ${JSON.stringify({ ...result, timedOut })}`);
    return JSON.parse(await readFile(join(output, "capture-result.json"), "utf8"));
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    await writeFile(join(output, "electron.log"), outputText);
  }
}

export async function capture(options) {
  execFileSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], { cwd: root });
  const config = JSON.parse(await readFile(join(here, "scenes.json"), "utf8"));
  const source = await sourceIdentity();
  const output = await createCaptureOutput(options.output);
  const bundle = join(output, "bundle");
  const scratch = await mkdtemp(join(tmpdir(), "pi-ui-capture-"));
  try {
    await buildRenderer(bundle, config);
    if (options.buildOnly) {
      await writeFile(join(output, "build.json"), JSON.stringify({ source, config, capture: "NOT RUN" }, null, 2));
      console.log(`UI fixture bundle prepared; Electron NOT RUN: ${output}`);
      return;
    }
    const { electronBinary } = resolveElectronBinary(root);
    const result = await launch(electronBinary, bundle, output, scratch);
    if (result.ok !== true || result.images?.length !== config.scenes.length) throw new Error("Incomplete capture result");
    const after = await sourceIdentity();
    if (JSON.stringify(after) !== JSON.stringify(source)) throw new Error("Source changed during capture; evidence is not a single candidate");
    const images = [];
    for (const scene of config.scenes) {
      const entry = result.images.find(image => image.id === scene.id && image.file === scene.file);
      if (!entry || entry.width !== config.settings.viewport.width || entry.height !== config.settings.viewport.height) throw new Error(`Invalid capture: ${scene.id}`);
      images.push({ ...entry, sha256: hash(await readFile(join(output, scene.file))) });
    }
    const dependencyLockSha256 = hash(await readFile(join(root, "node_modules/.pnpm/lock.yaml")));
    const environment = { platform: process.platform, arch: arch(), osRelease: release(), dependencyLockSha256, ...result.environment };
    await writeFile(join(output, "manifest.json"), JSON.stringify({ schemaVersion: 1, source, config, environment, images }, null, 2));
    console.log(`UI_CAPTURE_MANIFEST ${join(output, "manifest.json")}`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help")) console.log(usage);
  else try { await capture(parseArguments(process.argv.slice(2))); }
  catch (error) { console.error(error.stack || String(error)); process.exitCode = 1; }
}
