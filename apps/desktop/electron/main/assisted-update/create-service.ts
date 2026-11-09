import { join } from "node:path";
import { runCommand } from "./commands";
import { HELPER_NAME, assistedPaths } from "./job-store";
import { spawnDetachedHelper } from "./helper-process";
import { createElectronNetTransport, type ElectronNet } from "./net-transport";
import type { AssistedEligibility } from "./eligibility";
import { AssistedUpdateService, type AssistedUpdateLane } from "./service";
import type { Logger } from "../logger";


/** Production wiring: Electron's network stack, system tools, the bundled helper. */
export function createAssistedUpdateService(args: {
  logger: Logger;
  cacheBasePath: string;
  bundlePath: string;
  runningVersion: string;
  resourcesPath: string;
  arch: string;
}): AssistedUpdateService {
  return new AssistedUpdateService({
    paths: assistedPaths(args.cacheBasePath),
    bundlePath: args.bundlePath,
    runningVersion: args.runningVersion,
    arch: args.arch,
    helperSource: join(args.resourcesPath, "bin", HELPER_NAME),
    // Loaded on first use so modules that import this file never need Electron.
    transport: async () => {
      const { net } = await import("electron");
      return createElectronNetTransport(net as unknown as ElectronNet);
    },
    run: runCommand,
    spawnHelper: spawnDetachedHelper,
    log: (level, message, data) =>
      args.logger.app("updater", level, message, data ? { data } : undefined),
  });
}

/** The lane for an eligible install: the test override when given, else the real service. */
export function resolveAssistedLane(args: {
  override?: AssistedUpdateLane;
  eligibility: AssistedEligibility;
  logger: Logger;
  cacheBasePath: string;
  runningVersion: string;
}): AssistedUpdateLane | null {
  if (!args.eligibility.eligible) return null;
  return (
    args.override ??
    createAssistedUpdateService({
      logger: args.logger,
      cacheBasePath: args.cacheBasePath,
      bundlePath: args.eligibility.bundlePath,
      runningVersion: args.runningVersion,
      resourcesPath: process.resourcesPath,
      arch: process.arch,
    })
  );
}
