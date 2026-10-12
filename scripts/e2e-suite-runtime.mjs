import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function loadCatalog(directory = root) {
  const catalog = JSON.parse(await readFile(join(directory, "scripts/e2e-suite-catalog.json"), "utf8"));
  const ids = new Set();
  for (const entry of catalog.suites) {
    if (ids.has(entry.id)) throw new Error(`Duplicate E2E suite: ${entry.id}`);
    ids.add(entry.id);
    if (!catalog.families.includes(entry.family) || !["smoke", "nightly", "manual"].includes(entry.tier) || !entry.safety?.trim()) throw new Error(`Incomplete E2E classification: ${entry.id}`);
    if (!/^scripts\/e2e-[\w-]+\.mjs$/.test(entry.script)) throw new Error(`Unsafe suite path: ${entry.script}`);
    if (entry.tier !== "manual" && Object.keys(entry.env ?? {}).some(key => !["PI_DESKTOP_TEST_BASE_URL", "PI_DESKTOP_TEST_MODEL"].includes(key))) throw new Error(`Unexpected environment override: ${entry.id}`);
    if (entry.env?.PI_DESKTOP_TEST_BASE_URL && !/^http:\/\/127\.0\.0\.1:\d+\//.test(entry.env.PI_DESKTOP_TEST_BASE_URL)) throw new Error(`Non-fixture endpoint: ${entry.id}`);
    await readFile(join(directory, entry.script));
  }
  const scripts = (await readdir(join(directory, "scripts"))).filter(name => /^e2e-.*\.mjs$/.test(name) && !name.startsWith("e2e-suite"));
  const classified = new Set(catalog.suites.map(entry => entry.script));
  for (const script of scripts) if (!classified.has(`scripts/${script}`)) throw new Error(`Unclassified E2E entrypoint: ${script}`);
  return catalog;
}

export function selectSuites(catalog, { tier = "nightly", family, suite } = {}) {
  if (!["smoke", "nightly", "manual"].includes(tier)) throw new Error(`Unknown E2E tier: ${tier}`);
  if (family && !catalog.families.includes(family)) throw new Error(`Unknown E2E family: ${family}`);
  if (suite && !catalog.suites.some(entry => entry.id === suite)) throw new Error(`Unknown E2E suite: ${suite}`);
  const selected = catalog.suites.filter(entry =>
    (tier === "nightly" ? entry.tier !== "manual" : entry.tier === tier) &&
    (!family || entry.family === family) && (!suite || entry.id === suite));
  if (!selected.length) throw new Error("No matching E2E suites (manual suites are never selected automatically)");
  return selected;
}

/** Start from a tool/display allowlist; do not inherit keys, profiles or preview flags. */
export function fixtureEnvironment(parent, directory, overrides = {}) {
  const env = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL", "CI", "npm_execpath", "npm_config_store_dir", "PNPM_HOME"]) {
    if (parent[key] !== undefined) env[key] = parent[key];
  }
  if (parent.PI_DESKTOP_HOST_BIN) env.PI_DESKTOP_HOST_BIN = resolve(parent.PI_DESKTOP_HOST_BIN);
  return { ...env, HOME: join(directory, "home"), USERPROFILE: join(directory, "home"),
    XDG_CONFIG_HOME: join(directory, "config"), XDG_CACHE_HOME: join(directory, "cache"),
    XDG_DATA_HOME: join(directory, "local"), TMPDIR: join(directory, "tmp"), TEMP: join(directory, "tmp"), TMP: join(directory, "tmp"),
    ELECTRON_RENDERER_URL: "", ...overrides };
}

export async function runSuite(entry, { directory = root, parentEnv = process.env, timeoutMs = 480_000, onOutput = chunk => process.stdout.write(chunk) } = {}) {
  if (entry.tier === "manual") throw new Error(`Manual suite requires a direct authorized invocation: ${entry.id}: ${entry.safety}`);
  const scratch = await mkdtemp(join(tmpdir(), "pi-e2e-suite-"));
  const env = fixtureEnvironment(parentEnv, scratch, entry.env);
  for (const path of [env.HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME, env.TMPDIR]) await mkdir(path, { recursive: true });
  const start = Date.now();
  let output = "";
  let timedOut = false;
  try {
    const child = spawn(process.execPath, [entry.script, ...(entry.args ?? [])], {
      cwd: directory, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    const capture = chunk => { const text = String(chunk); output += text; onOutput(text); };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    }, timeoutMs);
    const result = await new Promise((resolveResult, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveResult({ code, signal }));
    }).finally(() => clearTimeout(timer));
    const skips = output.split(/\r?\n/).filter(line => /^SKIP\s/.test(line));
    const unexpectedSkips = skips.filter(line => !(entry.excludedCoverage ?? []).some(id => line.startsWith(`SKIP ${id} `)));
    return { id: entry.id, script: entry.script, ...result, timedOut, durationMs: Date.now() - start,
      passed: result.code === 0 && !timedOut && !unexpectedSkips.length, excludedCoverage: entry.excludedCoverage ?? [], skips, unexpectedSkips };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** Identify dirty request candidates without treating HEAD alone as the tested tree. */
export async function candidateIdentity(directory = root) {
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const git = args => execFileSync("git", args, { cwd: directory });
  const head = git(["rev-parse", "HEAD"]).toString().trim();
  const baseMain = git(["rev-parse", "origin/main"]).toString().trim();
  const digest = createHash("sha256").update(git(["diff", "--binary", "HEAD", "--"]));
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(path => path && !path.startsWith(".artifacts/") && !path.startsWith(".review-evidence/")).sort();
  for (const path of untracked) {
    const absolute = join(directory, path);
    const entry = await lstat(absolute);
    digest.update(path).update("\0");
    if (entry.isSymbolicLink()) digest.update("symlink\0").update(await readlink(absolute));
    else if (entry.isFile()) digest.update("file\0").update(await readFile(absolute));
    else throw new Error(`Unsupported untracked candidate entry: ${path}`);
    digest.update("\0");
  }
  const hostBinary = process.env.PI_DESKTOP_HOST_BIN ? resolve(process.env.PI_DESKTOP_HOST_BIN) : null;
  const hostBinarySha256 = hostBinary ? createHash("sha256").update(await readFile(hostBinary)).digest("hex") : null;
  return { head, baseMain, hostBinary, hostBinarySha256, dirty: git(["status", "--porcelain"]).length > 0, workspaceDiffSha256: digest.digest("hex"), platform: process.platform, node: process.version };
}
