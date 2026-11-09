import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { downloadAsset } = await import("../electron/main/assisted-update/download.ts");

const PAYLOAD = Buffer.alloc(100_000, 7);
const sha = (buffer) => createHash("sha512").update(buffer).digest("base64");
const asset = (overrides = {}) => ({
  version: "0.16.1",
  name: "Pi-Desktop-Plus-0.16.1-arm64-mac.zip",
  url: "https://github.com/SakuraLoveSmile/PI-Desktop/releases/download/v0.16.1/Pi-Desktop-Plus-0.16.1-arm64-mac.zip",
  sha512: sha(PAYLOAD),
  size: PAYLOAD.length,
  ...overrides,
});

async function* chunks(buffer, size = 16_384) {
  for (let offset = 0; offset < buffer.length; offset += size) {
    yield buffer.subarray(offset, offset + size);
  }
}

/** A transport that follows a scripted redirect chain and then serves `body`. */
function transport({ redirects = [], status = 200, headers = {}, body = chunks(PAYLOAD) } = {}) {
  const seen = [];
  return {
    seen,
    async get(url, { signal, allowRedirect }) {
      seen.push(url);
      for (const target of redirects) {
        if (!allowRedirect(target)) throw new Error("refused by the caller");
        seen.push(target);
      }
      if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return { statusCode: status, headers, body };
    },
  };
}

async function workdir() {
  return mkdtemp(join(tmpdir(), "assisted-download-"));
}

const never = () => new Promise(() => {});

test("a matching download lands at the destination with no partial file left", async () => {
  const dir = await workdir();
  const destination = join(dir, "update.zip");
  const progress = [];
  await downloadAsset({
    asset: asset(),
    destination,
    transport: transport({
      redirects: ["https://release-assets.githubusercontent.com/x"],
      headers: { "content-length": String(PAYLOAD.length) },
    }),
    signal: new AbortController().signal,
    onProgress: (p) => progress.push(p),
  });
  assert.deepEqual(await readFile(destination), PAYLOAD);
  assert.deepEqual(await readdir(dir), ["update.zip"]);
  assert.ok(progress.length > 1 && progress.every((p, i) => i === 0 || p >= progress[i - 1]));
  assert.ok(progress.every((p) => p <= 99), "100 is reserved for the staged result");
  await rm(dir, { recursive: true });
});

test("a body that does not match the release SHA-512 is deleted", async () => {
  const dir = await workdir();
  const tampered = Buffer.from(PAYLOAD);
  tampered[10] ^= 1;
  await assert.rejects(
    downloadAsset({
      asset: asset(),
      destination: join(dir, "update.zip"),
      transport: transport({ body: chunks(tampered) }),
      signal: new AbortController().signal,
    }),
    { code: "hash-mismatch" },
  );
  assert.deepEqual(await readdir(dir), []);
  await rm(dir, { recursive: true });
});

test("size is enforced while streaming, not only at the end", async () => {
  const dir = await workdir();
  let pulled = 0;
  async function* endless() {
    for (;;) {
      pulled += 1;
      yield Buffer.alloc(40_000);
      if (pulled > 50) return;
    }
  }
  await assert.rejects(
    downloadAsset({
      asset: asset(),
      destination: join(dir, "update.zip"),
      transport: transport({ body: endless() }),
      signal: new AbortController().signal,
    }),
    { code: "too-large" },
  );
  assert.ok(pulled <= 4, `stopped after ${pulled} chunks`);
  assert.deepEqual(await readdir(dir), []);

  await assert.rejects(
    downloadAsset({
      asset: asset(),
      destination: join(dir, "update.zip"),
      transport: transport({ body: chunks(PAYLOAD.subarray(0, 50_000)) }),
      signal: new AbortController().signal,
    }),
    { code: "size-mismatch" },
  );
  assert.deepEqual(await readdir(dir), []);
  await rm(dir, { recursive: true });
});

test("a Content-Length that disagrees with the release is refused before any byte is written", async () => {
  const dir = await workdir();
  await assert.rejects(
    downloadAsset({
      asset: asset(),
      destination: join(dir, "update.zip"),
      transport: transport({ headers: { "content-length": "999" } }),
      signal: new AbortController().signal,
    }),
    { code: "size-mismatch" },
  );
  assert.deepEqual(await readdir(dir), []);
  await rm(dir, { recursive: true });
});

test("redirects to other hosts, too many redirects and non-200 answers are refused", async () => {
  const dir = await workdir();
  const run = (t) =>
    downloadAsset({
      asset: asset(),
      destination: join(dir, "update.zip"),
      transport: t,
      signal: new AbortController().signal,
    });
  await assert.rejects(run(transport({ redirects: ["https://evil.example/x"] })), {
    code: "redirect-rejected",
  });
  await assert.rejects(run(transport({ redirects: ["http://objects.githubusercontent.com/x"] })), {
    code: "redirect-rejected",
  });
  const hop = "https://objects.githubusercontent.com/x";
  await assert.rejects(run(transport({ redirects: Array(6).fill(hop) })), {
    code: "redirect-rejected",
  });
  await run(transport({ redirects: Array(5).fill(hop) }));
  await rm(join(dir, "update.zip"));
  await assert.rejects(run(transport({ status: 404 })), { code: "http-status" });
  await assert.rejects(run(transport({ status: 206 })), { code: "http-status" });
  assert.deepEqual(await readdir(dir), []);
  await rm(dir, { recursive: true });
});

test("cancelling mid-download stops it, reports a cancellation and deletes the partial file", async () => {
  const dir = await workdir();
  const controller = new AbortController();
  async function* slow() {
    yield PAYLOAD.subarray(0, 10_000);
    controller.abort();
    yield PAYLOAD.subarray(10_000, 20_000);
    await never();
  }
  await assert.rejects(
    downloadAsset({
      asset: asset(),
      destination: join(dir, "update.zip"),
      transport: transport({ body: slow() }),
      signal: controller.signal,
    }),
    { code: "aborted" },
  );
  assert.deepEqual(await readdir(dir), []);

  const already = new AbortController();
  already.abort();
  await assert.rejects(
    downloadAsset({
      asset: asset(),
      destination: join(dir, "update.zip"),
      transport: transport(),
      signal: already.signal,
    }),
    { code: "aborted" },
  );
  await rm(dir, { recursive: true });
});

test("a stalled download is abandoned", async () => {
  const dir = await workdir();
  async function* stalls() {
    yield PAYLOAD.subarray(0, 1_000);
    await never();
  }
  await assert.rejects(
    downloadAsset({
      asset: asset(),
      destination: join(dir, "update.zip"),
      transport: transport({ body: stalls() }),
      signal: new AbortController().signal,
      stallTimeoutMs: 50,
    }),
    { code: "stalled" },
  );
  assert.deepEqual(await readdir(dir), []);
  await rm(dir, { recursive: true });
});

test("a leftover partial file from an earlier run never leaks into a new download", async () => {
  const dir = await workdir();
  await writeFile(join(dir, "update.zip.part"), "stale bytes from a dead run");
  await downloadAsset({
    asset: asset(),
    destination: join(dir, "update.zip"),
    transport: transport(),
    signal: new AbortController().signal,
  });
  assert.deepEqual(await readFile(join(dir, "update.zip")), PAYLOAD);
  await rm(dir, { recursive: true });
});
