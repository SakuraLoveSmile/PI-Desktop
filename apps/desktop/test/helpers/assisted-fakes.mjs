import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ARM64 = Buffer.alloc(64);
ARM64.writeUInt32LE(0xfeedfacf, 0);
ARM64.writeUInt32LE(0x0100000c, 4);
const X64 = Buffer.alloc(64);
X64.writeUInt32LE(0xfeedfacf, 0);
X64.writeUInt32LE(0x01000007, 4);

export const MACHO = { arm64: ARM64, x64: X64 };

/**
 * A scripted stand-in for ditto / plutil / codesign / xattr that builds the
 * extracted app on `ditto -x -k <zip> <dir>` and answers the checks from
 * `options`.
 */
export function fakeToolRunner(options = {}) {
  const config = {
    entries: ["Pi-Desktop-Plus.app"],
    bundleId: "cn.sakura.pi-desktop",
    version: "0.16.1",
    executable: "Pi-Desktop-Plus",
    exe: ARM64,
    dittoCode: 0,
    plutilCode: 0,
    plutilOutput: undefined,
    codesignCode: 0,
    quarantined: false,
    xattrFailure: false,
    runningBundleId: "cn.sakura.pi-desktop",
    ...options,
  };
  const calls = [];
  const run = async (command, args) => {
    const tool = command.split("/").pop();
    calls.push([tool, ...args]);
    if (tool === "ditto") {
      if (config.dittoCode !== 0) return { code: config.dittoCode, stdout: "", stderr: "ditto: failed" };
      const stagingDir = args[args.length - 1];
      for (const entry of config.entries) {
        if (entry.endsWith(".app")) {
          const exe = join(stagingDir, entry, "Contents", "MacOS");
          await mkdir(exe, { recursive: true });
          if (config.exe) await writeFile(join(exe, config.executable.split("/").pop()), config.exe);
        } else if (entry.endsWith("/")) {
          await mkdir(join(stagingDir, entry), { recursive: true });
        } else {
          await writeFile(join(stagingDir, entry), "x");
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    }
    if (tool === "plutil") {
      if (config.plutilCode !== 0) return { code: config.plutilCode, stdout: "", stderr: "plutil: error" };
      const target = args[args.length - 1];
      const staged = target.includes(".pi-desktop-plus-update-");
      const stdout =
        config.plutilOutput ??
        JSON.stringify({
          CFBundleIdentifier: staged ? config.bundleId : config.runningBundleId,
          CFBundleShortVersionString: config.version,
          CFBundleExecutable: config.executable,
        });
      return { code: 0, stdout, stderr: "" };
    }
    if (tool === "codesign") {
      return { code: config.codesignCode, stdout: "", stderr: config.codesignCode ? "a sealed resource is missing" : "" };
    }
    if (tool === "xattr") {
      if (config.xattrFailure) return { code: 2, stdout: "", stderr: "xattr: Permission denied" };
      return config.quarantined
        ? { code: 0, stdout: "0081;00000000;Safari;", stderr: "" }
        : { code: 1, stdout: "", stderr: "xattr: No such xattr: com.apple.quarantine" };
    }
    throw new Error(`unexpected command ${command}`);
  };
  return { run, calls, config };
}
