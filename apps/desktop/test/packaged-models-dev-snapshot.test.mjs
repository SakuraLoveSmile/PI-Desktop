import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const mainRoot = new URL("../electron/main/", import.meta.url);

async function mainSources() {
  const names = await readdir(mainRoot, { recursive: true });
  const sources = [];
  for (const name of names.filter((entry) => entry.endsWith(".ts"))) {
    sources.push({ name, text: await readFile(new URL(name, mainRoot), "utf8") });
  }
  return sources;
}

// The packaged main process loads the bundled models.dev snapshot from below
// process.resourcesPath. A build that does not copy the checked-in directory
// there boots with an empty catalog while every unpackaged run, which reads
// the snapshot from the source tree, keeps working.
test("a packaged build ships the models.dev snapshot main reads from resourcesPath", async () => {
  const readers = (await mainSources()).filter(({ text }) =>
    /process\.resourcesPath,\s*"models\.dev",\s*"api\.json"/.test(text),
  );
  assert.ok(readers.length > 0, "main must resolve the packaged snapshot below process.resourcesPath");

  assert.ok(
    packageJson.build.extraResources.some(
      (resource) => resource.from === "resources/models.dev" && resource.to === "models.dev",
    ),
    "extraResources must copy resources/models.dev to resources/models.dev",
  );

  const snapshot = await stat(new URL("../resources/models.dev/api.json", import.meta.url));
  assert.ok(snapshot.isFile() && snapshot.size > 0, "the checked-in snapshot must exist and be non-empty");
});
