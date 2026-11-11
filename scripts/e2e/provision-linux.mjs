import { execFile, execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const mirrorPath = "/etc/apt/apt-mirrors.txt";
const packages = [
  "xvfb", "openbox", "libnss3", "libatk-bridge2.0-0t64", "libgtk-3-0t64",
  "libgbm1", "libasound2t64", "openssl", "zip", "fonts-noto-cjk",
];
const exec = promisify(execFile);

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
export async function provisionLinux({ readMirrors, writeMirrors, run, report, diagnose }) {
  const mirrors = officialUbuntuMirrors(await readMirrors());
  await writeMirrors(mirrors);
  report(`Ubuntu fixture mirrors:\n${mirrors}`);
  try {
    await run("sudo", ["apt-get", "update", "--error-on=any"]);
  } catch (error) {
    try { await diagnose(); }
    catch (diagnosticError) { report(`Ubuntu network diagnostics failed: ${diagnosticError.message}`); }
    throw error;
  }
  await run("sudo", ["apt-get", "install", "-y", ...packages]);
  // Enable Electron's own user-namespace sandbox on this ephemeral CI VM.
  // No --no-sandbox or renderer sandbox bypass is used.
  await run("sudo", ["sysctl", "-w", "kernel.apparmor_restrict_unprivileged_userns=0"]);
}

/** Public endpoints only; diagnostics never install, retry APT or change DNS. */
export async function diagnoseUbuntuNetwork({ probe, report }) {
  const checks = [
    ...["archive.ubuntu.com", "security.ubuntu.com", "packages.microsoft.com"].map(host => ({
      label: `system-dns:${host}`, command: "getent", args: ["ahostsv4", host],
    })),
    ...["archive.ubuntu.com", "security.ubuntu.com"].map(host => ({
      label: `https:${host}`, command: "curl", args: ["--silent", "--show-error", "--fail",
        "--connect-timeout", "10", "--max-time", "15", "--output", "/dev/null",
        "--write-out", "HTTP %{http_code}; remote %{remote_ip}",
        `https://${host}/ubuntu/dists/noble/InRelease`],
    })),
  ];
  const results = await Promise.all(checks.map(async ({ label, command, args }) => ({
    label, ...await probe(command, args),
  })));
  for (const result of results) report(`Ubuntu network diagnostic: ${JSON.stringify(result)}`);
}

async function probe(command, args) {
  try {
    const { stdout, stderr } = await exec(command, args, { timeout: 20_000, maxBuffer: 16_384 });
    return { code: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { code: error.code ?? error.signal, stdout: error.stdout?.trim() ?? "",
      stderr: error.stderr?.trim() || error.message };
  }
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
      diagnose: () => diagnoseUbuntuNetwork({ probe, report: message => console.log(message) }),
    });
  } catch (error) {
    console.error(`Fixture provisioning failed: ${error.message}`);
    process.exitCode = 1;
  }
}
