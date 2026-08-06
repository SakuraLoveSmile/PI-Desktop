#!/usr/bin/env node
/**
 * PI-Desktop subagent registry e2e (headless protocol-level, D202).
 * Drives the real host-core binary over its NDJSON RPC pipe against a throwaway
 * data dir, then feeds the documents it wrote through the real loader — the two
 * halves the unit suites cover separately and never together.
 *
 * Env:
 *  PI_DESKTOP_HOST_BIN (optional)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { PROTOCOL_VERSION } from "../packages/shared/dist/protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const hostBinaryName = `pi-desktop-host-core${process.platform === "win32" ? ".exe" : ""}`;
const hostBinCandidates = [];
const configuredHostBin = process.env.PI_DESKTOP_HOST_BIN?.trim();
if (configuredHostBin) {
  const configured = resolve(configuredHostBin);
  hostBinCandidates.push(configured);
  if (process.platform === "win32" && !configured.toLowerCase().endsWith(".exe")) {
    hostBinCandidates.push(`${configured}.exe`);
  }
}
hostBinCandidates.push(join(root, "target", "debug", hostBinaryName));
const hostBin = hostBinCandidates.find((candidate) => existsSync(candidate));
if (!hostBin) {
  console.error("host binary missing; tried:", hostBinCandidates.join(", "));
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "pi-subagent-data-"));
const projectA = mkdtempSync(join(tmpdir(), "pi-project-a-"));
const projectB = mkdtempSync(join(tmpdir(), "pi-project-b-"));

const host = spawn(hostBin, [], {
  env: { ...process.env, PI_DESKTOP_DATA_DIR: dataDir, RUST_LOG: "error" },
  stdio: ["pipe", "pipe", "pipe"],
});
host.stderr.on("data", (chunk) => {
  const text = String(chunk).trim();
  if (text) console.error("[host]", text);
});
// A debug host-core takes seconds to boot, so a call issued at t=0 waits on it;
// failing the whole run fast when it dies beats waiting out every timeout.
host.on("exit", (code, signal) => {
  for (const [id, { reject }] of pending) {
    pending.delete(id);
    reject(new Error(`host exited code=${code} signal=${signal}`));
  }
});

let seq = 0;
const pending = new Map();
let buffer = "";
host.stdout.on("data", (chunk) => {
  buffer += String(chunk);
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id != null && pending.has(message.id)) {
      const { resolve: settle } = pending.get(message.id);
      pending.delete(message.id);
      settle(message);
    }
  }
});

const call = (method, params = {}) =>
  new Promise((settle, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: settle, reject });
    host.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 30_000);
  });

const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

try {
  // 0. Handshake — every other method answers UNAUTHORIZED without it.
  const hello = await call("app.handshake", { protocolVersion: PROTOCOL_VERSION });
  check(
    "handshake accepted",
    hello.result?.protocolVersion === PROTOCOL_VERSION,
    `host ${hello.result?.version}`,
  );

  // 1. Create.
  const created = await call("agents.create", {
    name: "Log Reader",
    description: "Read build logs and report the first real failure.",
    tools: ["Read", "Grep", "Bash"],
    body: "You are log-reader. Read the log and report the first real failure.\n",
  });
  const record = created.result?.subagent;
  check("agents.create returns a record", !!record, JSON.stringify(record?.id));
  // id == name == slug: the name is the handle the model passes to Task, so a
  // display name that differed from the handle would be a second identity.
  check(
    "the name is slugified into the Task handle",
    record?.id === "log-reader" && record?.name === "log-reader",
    `id=${record?.id} name=${record?.name}`,
  );
  check(
    "the tool grant round-trips",
    JSON.stringify(record?.tools) === JSON.stringify(["Read", "Grep", "Bash"]),
    JSON.stringify(record?.tools),
  );

  // 2. Documents on disk.
  const agentsDir = join(dataDir, "agents");
  const entries = readdirSync(agentsDir).sort();
  check(
    "the registry writes a flat <id>.md beside registry.json",
    entries.includes("log-reader.md") && entries.includes("registry.json"),
    entries.join(", "),
  );
  const document = readFileSync(join(agentsDir, "log-reader.md"), "utf8");
  check(
    "the document carries the frontmatter the loader reads",
    /^---\n/.test(document) &&
      /name: log-reader/.test(document) &&
      /tools: \[Read, Grep, Bash\]/.test(document),
    JSON.stringify(document.split("\n").slice(0, 6).join(" | ")),
  );

  // 3. Duplicate names are refused, not suffixed.
  const dup = await call("agents.create", {
    name: "log-reader",
    description: "A second one.",
    body: "Body.\n",
  });
  check(
    "a duplicate name is refused with SUBAGENT_INVALID",
    dup.error?.data?.errorCode === "SUBAGENT_INVALID",
    `${dup.error?.code}/${dup.error?.data?.errorCode}: ${dup.error?.message}`,
  );

  // 4. Scope filtering.
  const before = await call("agents.active", { projectPath: projectA });
  check(
    "a global definition is active in any project",
    before.result?.subagents?.length === 1,
    `${before.result?.subagents?.length} active`,
  );
  await call("agents.setScope", {
    id: "log-reader",
    scope: { mode: "projects", projects: [projectB] },
  });
  const inA = await call("agents.active", { projectPath: projectA });
  const inB = await call("agents.active", { projectPath: projectB });
  check(
    "scoping to one project removes it from the other",
    inA.result?.subagents?.length === 0 && inB.result?.subagents?.length === 1,
    `A=${inA.result?.subagents?.length} B=${inB.result?.subagents?.length}`,
  );
  const listed = await call("agents.list");
  check(
    "list still shows it, so the UI can report it as inactive here",
    listed.result?.subagents?.length === 1,
    `${listed.result?.subagents?.length} listed`,
  );
  await call("agents.setScope", { id: "log-reader", scope: { mode: "global", projects: [] } });

  // 5. Disabled records leave the active set.
  await call("agents.setEnabled", { id: "log-reader", enabled: false });
  const off = await call("agents.active", { projectPath: projectA });
  check(
    "a disabled definition is not active anywhere",
    off.result?.subagents?.length === 0,
    `${off.result?.subagents?.length} active`,
  );
  await call("agents.setEnabled", { id: "log-reader", enabled: true });

  // 6. Read returns the body the editor sheet loads.
  const read = await call("agents.read", { id: "log-reader" });
  check(
    "read returns the body for the editor",
    /report the first real failure/.test(read.result?.body ?? ""),
    JSON.stringify((read.result?.body ?? "").slice(0, 40)),
  );

  // 7. The cap matches MAX_SUBAGENT_DEFINITIONS, so the UI cannot store a
  // definition the loader would then drop.
  let capError = null;
  for (let i = 0; i < 20; i += 1) {
    const extra = await call("agents.create", {
      name: `filler-${i}`,
      description: "Filler.",
      body: "Body.\n",
    });
    if (extra.error) {
      capError = { at: i, error: extra.error };
      break;
    }
  }
  const full = await call("agents.list");
  check(
    "the registry caps at 16 definitions",
    full.result?.subagents?.length === 16 && capError?.at === 15,
    `${full.result?.subagents?.length} stored, refused on the ${capError?.at}th filler: ${capError?.error?.message}`,
  );

  // 8. Remove.
  for (let i = 0; i < 15; i += 1) await call("agents.remove", { id: `filler-${i}` });
  const trimmed = await call("agents.list");
  check(
    "remove deletes the record and its document",
    trimmed.result?.subagents?.length === 1 &&
      !readdirSync(agentsDir).includes("filler-0.md"),
    readdirSync(agentsDir).join(", "),
  );

  // 9. Precedence through the real loader.
  const { loadSubagentDefinitions } = await import(
    join(root, "packages", "agent-runtime", "dist", "index.js")
  );
  const readActive = async (projectPath) => {
    const active = await call("agents.active", { projectPath });
    return active.result.subagents.map((entry) => ({
      id: entry.id,
      document: readFileSync(entry.path, "utf8"),
      filePath: entry.path,
    }));
  };
  const userDocuments = await readActive(projectA);
  const merged = await loadSubagentDefinitions(projectA, { userDocuments });
  const byName = new Map(merged.definitions.map((d) => [d.name, d]));
  check(
    "the registry document reaches the loader as a user definition",
    byName.get("log-reader")?.source === "user",
    `source=${byName.get("log-reader")?.source}`,
  );
  check(
    "the three builtins are still there beside it",
    ["explorer", "code-reviewer", "test-runner"].every(
      (name) => byName.get(name)?.source === "builtin",
    ),
    [...byName.keys()].join(", "),
  );
  check(
    "the declared tools survive the round trip to the loader",
    JSON.stringify(byName.get("log-reader")?.tools) ===
      JSON.stringify(["Read", "Grep", "Bash"]),
    JSON.stringify(byName.get("log-reader")?.tools),
  );

  // A project document of the same name must win: the registry is a user-level
  // layer, not a replacement for a committed .pi/agents document.
  mkdirSync(join(projectA, ".pi", "agents"), { recursive: true });
  writeFileSync(
    join(projectA, ".pi", "agents", "log-reader.md"),
    "---\nname: log-reader\ndescription: The project's own log reader.\ntools: Read\n---\n\nProject body.\n",
  );
  const shadowed = await loadSubagentDefinitions(projectA, { userDocuments });
  const winner = shadowed.definitions.find((d) => d.name === "log-reader");
  check(
    "a project document shadows the registry entry",
    winner?.source === "project" &&
      winner?.description === "The project's own log reader.",
    `source=${winner?.source} description=${winner?.description}`,
  );
  check(
    "shadowing does not duplicate the name",
    shadowed.definitions.filter((d) => d.name === "log-reader").length === 1,
    `${shadowed.definitions.filter((d) => d.name === "log-reader").length} entries`,
  );

  // A registry definition named after a builtin must win over it — that is what
  // "copy as my definition" is for.
  await call("agents.create", {
    name: "explorer",
    description: "My own explorer.",
    tools: ["Read", "Glob"],
    body: "You are my explorer.\n",
  });
  const merged2 = await loadSubagentDefinitions(projectB, {
    userDocuments: await readActive(projectB),
  });
  const explorer = merged2.definitions.find((d) => d.name === "explorer");
  check(
    "a registry copy of a builtin outranks the builtin",
    explorer?.source === "user" && explorer?.description === "My own explorer.",
    `source=${explorer?.source}`,
  );
  check(
    "the loader reports no diagnostics for well-formed documents",
    merged2.diagnostics.length === 0,
    merged2.diagnostics.join(" / "),
  );

  // 10. A malformed registry document degrades to a diagnostic.
  const broken = await loadSubagentDefinitions(projectB, {
    userDocuments: [{ id: "broken", document: "no frontmatter at all\n" }],
  });
  check(
    "a malformed document becomes a diagnostic without losing the builtins",
    broken.diagnostics.length === 1 && broken.definitions.length === 3,
    `${broken.diagnostics.length} diagnostic(s), ${broken.definitions.length} definitions: ${broken.diagnostics[0]}`,
  );
} catch (error) {
  check("the run completed", false, String(error));
} finally {
  host.stdin.end();
  host.kill();
  for (const dir of [dataDir, projectA, projectB]) {
    rmSync(dir, { recursive: true, force: true });
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
