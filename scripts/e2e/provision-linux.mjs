import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mirrorPath = "/etc/apt/apt-mirrors.txt";
const packages = [
  "xvfb", "openbox", "libnss3", "libatk-bridge2.0-0t64", "libgtk-3-0t64",
  "libgbm1", "libasound2t64", "openssl", "zip", "fonts-noto-cjk",
];

/** Preserve the official image's HTTPS entries and their priority metadata. */
export function officialUbuntuMirrors(source) {
  const lines = source.split("\n");
  const expected = [
    /^http:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/[\t ]+priority:1$/,
    /^https:\/\/archive\.ubuntu\.com\/ubuntu\/[\t ]+priority:2$/,
    /^https:\/\/security\.ubuntu\.com\/ubuntu\/[\t ]+priority:3$/,
  ];
  if (lines.length !== 4 || lines[3] !== "" ||
    expected.some((pattern, index) => !pattern.test(lines[index]))) {
    throw new Error("Unexpected Ubuntu mirror list; refusing to replace runner sources");
  }
  return lines.slice(1).join("\n");
}

/** I/O and privileged commands are boundaries; tests use disposable files. */
export async function provisionLinux({ readMirrors, writeMirrors, run, report }) {
  const mirrors = officialUbuntuMirrors(await readMirrors());
  await writeMirrors(mirrors);
  report(`Ubuntu fixture mirrors:\n${mirrors}`);
  await run("sudo", ["apt-get", "update", "--error-on=any"]);
  await run("sudo", ["apt-get", "install", "-y", ...packages]);
  // Enable Electron's own user-namespace sandbox on this ephemeral CI VM.
  // No --no-sandbox or renderer sandbox bypass is used.
  await run("sudo", ["sysctl", "-w", "kernel.apparmor_restrict_unprivileged_userns=0"]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" ||
      process.env.RUNNER_ENVIRONMENT !== "github-hosted") {
      throw new Error("Fixture provisioning requires a GitHub-hosted Linux runner");
    }
    await provisionLinux({
      readMirrors: async () => {
        if (!(await lstat(mirrorPath)).isFile()) throw new Error("Ubuntu mirror list must be a regular file");
        return readFile(mirrorPath, "utf8");
      },
      writeMirrors: source => execFileSync("sudo", ["tee", "--", mirrorPath], {
        input: source, stdio: ["pipe", "ignore", "inherit"],
      }),
      run: (command, args) => execFileSync(command, args, { stdio: "inherit" }),
      report: message => console.log(message),
    });
  } catch (error) {
    console.error(`Fixture provisioning failed: ${error.message}`);
    process.exitCode = 1;
  }
}
