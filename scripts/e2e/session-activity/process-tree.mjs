// Owned, local-only descendants for production shell-runner lifecycle checks.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [directory, token, role = "parent"] = process.argv.slice(2);
if (!directory || !token || !["parent", "child", "grandchild"].includes(role)) {
  throw new Error("Invalid process-tree fixture arguments");
}
const pidFile = join(directory, `${role}.json`);
writeFileSync(`${pidFile}.tmp`, JSON.stringify({ pid: process.pid, token, role }));
renameSync(`${pidFile}.tmp`, pidFile);
appendFileSync(join(directory, "starts"), `${role}:${process.pid}\n`);
let sequence = 0;
const beat = () => {
  const target = join(directory, `${role}.heartbeat`);
  writeFileSync(`${target}.tmp`, String(++sequence));
  renameSync(`${target}.tmp`, target);
};
beat();
setInterval(beat, 40);

if (role !== "grandchild") {
  const next = role === "parent" ? "child" : "grandchild";
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), directory, token, next], {
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => process.exit(2));
}
if (role === "parent") {
  const ready = setInterval(() => {
    if (!existsSync(join(directory, "grandchild.json"))) return;
    clearInterval(ready);
    process.stdout.write(`TREE_READY:${token}\n中🙂\u2028\u2029\n`);
    process.stderr.write(`TREE_STDERR:${token}\n错误🙂\n`);
  }, 20);
}
