import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Resolution hooks for loading `bootstrap/shutdown.ts` alone: Electron becomes
 * a stand-in and the remote-host boot module (a large unrelated graph) becomes
 * an empty registry.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") {
    return {
      url: pathToFileURL(join(here, "shutdown-electron-stub.mjs")).href,
      shortCircuit: true,
    };
  }
  if (specifier === "./remote-hosts" && context.parentURL?.endsWith("/bootstrap/shutdown.ts")) {
    return {
      url: pathToFileURL(join(here, "shutdown-remote-hosts-stub.mjs")).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
