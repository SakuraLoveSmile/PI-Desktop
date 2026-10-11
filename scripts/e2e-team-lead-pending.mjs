#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { userInfo } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
for (const artifact of ["packages/agent-runtime/dist/index.js","packages/host-runtime/dist/index.js","packages/agent-host/dist/index.js","packages/shared/dist/index.js"]) {
  try { await access(join(root,artifact)); }
  catch { throw new Error(`Missing ${artifact}; prepare pnpm build:js with the existing host environment before this integration check.`); }
}
const testName="approved_goal_ask_timeout_replays_runtime_main_and_host_interruption";
// The suite runner isolates application HOME. Reuse installed Rust toolchains/stores by reference.
const toolHome=userInfo().homedir;
const child=spawn("cargo",["test","-p","host-core","--locked",testName,"--","--ignored","--nocapture"],{
  cwd:root,env:{...process.env,CARGO_HOME:process.env.CARGO_HOME??join(toolHome,".cargo"),RUSTUP_HOME:process.env.RUSTUP_HOME??join(toolHome,".rustup")},stdio:["ignore","pipe","pipe"],
});
let output="";
for (const stream of [child.stdout,child.stderr]) stream.on("data",chunk=>{output+=String(chunk);process.stdout.write(chunk);});
const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
if(code!==0||!output.includes(`test rpc::team_pending_tests::${testName} ... ok`)) throw new Error("Team Lead pending integration did not run successfully");
console.log("PASS E2E-TEAM-approved-lead-ask-interrupted: production runtime, Main finalization, Rust execution and token; no successful Goal report");
