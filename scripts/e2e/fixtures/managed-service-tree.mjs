// Local, harness-owned descendants for the production service runner.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [directory, token, behavior, role = "parent"] = process.argv.slice(2);
if (!directory || !token || !["friendly", "ignore"].includes(behavior) ||
    !["parent", "child", "grandchild"].includes(role)) {
  throw new Error("Invalid managed service fixture arguments");
}
function atomic(name, content) {
  const target = join(directory, name);
  writeFileSync(`${target}.tmp`, content);
  renameSync(`${target}.tmp`, target);
}
atomic(`${role}.json`, JSON.stringify({ pid: process.pid, token, role }));
appendFileSync(join(directory, "starts"), `${role}:${process.pid}\n`);
let sequence = 0;
atomic(`${role}.heartbeat`, String(++sequence));
setInterval(() => atomic(`${role}.heartbeat`, String(++sequence)), 40);

process.on("SIGTERM", () => {
  appendFileSync(join(directory, "signals"), `${role}:TERM:${Date.now()}\n`);
  if (behavior === "ignore") return;
  // Children exit first, allowing their parent to reap them before it exits.
  setTimeout(() => process.exit(0), { parent: 150, child: 80, grandchild: 10 }[role]);
});
if (role !== "grandchild") {
  const next = role === "parent" ? "child" : "grandchild";
  const child = spawn(process.execPath,
    [fileURLToPath(import.meta.url), directory, token, behavior, next],
    { stdio: "ignore", windowsHide: true });
  child.on("error", error => { console.error(error.message); process.exit(2); });
}
if (role === "parent") {
  const ready = setInterval(() => {
    if (!existsSync(join(directory, "grandchild.json"))) return;
    clearInterval(ready);
    process.stdout.write(`SERVICE_READY:${token}\n`);
  }, 20);
}
