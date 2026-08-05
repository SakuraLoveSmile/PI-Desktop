import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const terminalSource = await readFile(
  new URL("../electron/main/terminal.ts", import.meta.url),
  "utf8",
);
test("PTY shell policy remains independent from the agent Bash tool", () => {
  assert.match(terminalSource, /independent PTY shell policy/);
  assert.doesNotMatch(terminalSource, /process\.env\.SHELL \|\| "\/bin\/zsh"/);
  assert.match(terminalSource, /export function resolveShell\(\)/);
  assert.match(terminalSource, /const \{ shell, args \} = resolveShell\(\);/);
  // macOS/Linux resolve bash from well-known locations, then PATH.
  assert.match(terminalSource, /"\/bin\/bash",\s*"\/usr\/bin\/bash"/s);
  // PI_DESKTOP_BASH override works on any platform, matching host-core.
  assert.match(terminalSource, /process\.env\.PI_DESKTOP_BASH/);
});

test("Windows PTY resolves Git Bash, skipping the WSL launcher", () => {
  const winBranch = terminalSource.slice(
    terminalSource.indexOf("function findWindowsGitBash"),
    terminalSource.indexOf("export function resolveShell"),
  );
  // Preferred: bash.exe shipped with Git for Windows, located from git.exe.
  assert.match(winBranch, /searchPath\("git\.exe"\)/);
  assert.match(winBranch, /bin", "bash\.exe"/);
  // System32 bash.exe is the WSL launcher, not a Win32 bash.
  assert.match(winBranch, /system32/i);
  // Without Git for Windows the panel still opens via cmd.exe.
  assert.match(terminalSource, /process\.env\.COMSPEC \|\| "cmd\.exe"/);
});
