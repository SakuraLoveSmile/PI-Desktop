#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(process.env.PI_UI_PYTHON || "python3", [
  fileURLToPath(new URL("./compare.py", import.meta.url)),
  ...process.argv.slice(2).filter(value => value !== "--"),
], { stdio: "inherit", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
