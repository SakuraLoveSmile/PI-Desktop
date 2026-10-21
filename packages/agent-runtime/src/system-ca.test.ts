import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const ca = vi.hoisted(() => ({
  get: vi.fn<(source: string) => string[]>(),
  set: vi.fn<(certs: string[]) => void>(),
}));
vi.mock("node:tls", () => ({
  getCACertificates: ca.get,
  setDefaultCACertificates: ca.set,
}));
import { applyAdditiveDefaultCaCertificates } from "./system-ca.js";

const fixture = new URL("../../../scripts/e2e/fixtures/certificates/", import.meta.url);
const valid = readFileSync(new URL("localhost-cert.pem", fixture), "utf8");
const expired = readFileSync(new URL("expired-system-ca.crt", fixture), "utf8");
const now = new Date("2026-10-22T00:00:00.000Z");
let roots: Record<string, string[]>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  ca.get.mockReset();
  ca.set.mockReset();
  roots = { bundled: [], extra: [], system: [expired, valid], default: [] };
  ca.get.mockImplementation((source) => [...(roots[source] ?? [])]);
  ca.set.mockImplementation((certs) => { roots.default = [...certs]; });
});
afterEach(() => vi.useRealTimers());

it("excludes a deterministic expired OS anchor while retaining a valid OS anchor", () => {
  // Prove the fixture exercises both branches regardless of the host OS store.
  expect(Date.parse(new X509Certificate(expired).validTo)).toBeLessThan(now.getTime());
  expect(Date.parse(new X509Certificate(valid).validTo)).toBeGreaterThan(now.getTime());
  applyAdditiveDefaultCaCertificates();
  expect(roots.default).toEqual([valid]);
});

it("keeps the bundled and inherited extra roots even when expired", () => {
  roots.bundled = [expired];
  roots.extra = [valid];
  applyAdditiveDefaultCaCertificates();
  expect(new Set(roots.default)).toEqual(new Set([expired, valid]));
  roots.bundled = [valid];
  roots.extra = [expired];
  applyAdditiveDefaultCaCertificates();
  expect(new Set(roots.default)).toEqual(new Set([valid, expired]));
});

it("is idempotent and deduplicates bundled roots from the system merge", () => {
  roots.bundled = [valid];
  applyAdditiveDefaultCaCertificates();
  const once = [...roots.default];
  applyAdditiveDefaultCaCertificates();
  expect(roots.default).toEqual(once);
  expect(roots.default).toEqual([valid]);
});

it("leaves the existing runtime default alone when no OS roots are available", () => {
  roots.system = [];
  roots.default = [valid];
  applyAdditiveDefaultCaCertificates();
  expect(ca.set).not.toHaveBeenCalled();
  expect(roots.default).toEqual([valid]);
});

it("treats a root expiring exactly now as expired", () => {
  vi.setSystemTime(new Date(new X509Certificate(expired).validTo));
  applyAdditiveDefaultCaCertificates();
  expect(roots.default).toEqual([valid]);
});

it("leaves unparseable OS PEM validation to the runtime and reports merge rejection", () => {
  roots.system = ["malformed OS PEM"];
  const error = new Error("runtime rejected certificate");
  ca.set.mockImplementation(() => { throw error; });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    expect(() => applyAdditiveDefaultCaCertificates()).not.toThrow();
    expect(ca.set).toHaveBeenCalledWith(["malformed OS PEM"]);
    expect(stderr).toHaveBeenCalledWith("[agent-sidecar] default CA merge failed: runtime rejected certificate\n");
  } finally {
    stderr.mockRestore();
  }
});
