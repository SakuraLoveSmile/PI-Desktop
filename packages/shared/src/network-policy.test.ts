import { describe, expect, it } from "vitest";
import {
  DEFAULT_NETWORK_POLICY,
  allowInsecureUserEndpoints,
  normalizeNetworkPolicy,
  validateNetworkPolicy,
} from "./network-policy.js";

describe("normalizeNetworkPolicy", () => {
  it("keeps the opt-in and drops everything else", () => {
    expect(normalizeNetworkPolicy({ allowInsecureUserEndpoints: true })).toEqual({
      allowInsecureUserEndpoints: true,
    });
    expect(normalizeNetworkPolicy({ allowInsecureUserEndpoints: false })).toEqual({});
    expect(normalizeNetworkPolicy({ allowInsecureUserEndpoints: "yes" })).toEqual({});
    expect(normalizeNetworkPolicy({ somethingElse: true })).toEqual({});
    expect(normalizeNetworkPolicy(null)).toEqual({});
    expect(normalizeNetworkPolicy(undefined)).toEqual({});
  });

  it("defaults to refusing the plaintext case", () => {
    expect(DEFAULT_NETWORK_POLICY.allowInsecureUserEndpoints).toBe(false);
  });
});

describe("validateNetworkPolicy", () => {
  it("accepts an absent section, a boolean and an empty object", () => {
    expect(validateNetworkPolicy(undefined)).toEqual({
      ok: true,
      value: { allowInsecureUserEndpoints: false },
    });
    expect(validateNetworkPolicy({})).toEqual({ ok: true, value: {} });
    expect(validateNetworkPolicy({ allowInsecureUserEndpoints: true })).toEqual({
      ok: true,
      value: { allowInsecureUserEndpoints: true },
    });
  });

  it("refuses a non-object or a non-boolean flag", () => {
    expect(validateNetworkPolicy([]).ok).toBe(false);
    expect(validateNetworkPolicy("networkPolicy").ok).toBe(false);
    expect(validateNetworkPolicy({ allowInsecureUserEndpoints: 1 }).ok).toBe(false);
    expect(validateNetworkPolicy({ allowInsecureUserEndpoints: null }).ok).toBe(false);
  });
});

describe("allowInsecureUserEndpoints", () => {
  it("reads the networkPolicy section of a settings object", () => {
    expect(
      allowInsecureUserEndpoints({ networkPolicy: { allowInsecureUserEndpoints: true } }),
    ).toBe(true);
    expect(
      allowInsecureUserEndpoints({ networkPolicy: { allowInsecureUserEndpoints: false } }),
    ).toBe(false);
    expect(allowInsecureUserEndpoints({})).toBe(false);
    expect(allowInsecureUserEndpoints(null)).toBe(false);
    expect(allowInsecureUserEndpoints({ networkPolicy: "yes" })).toBe(false);
  });

  it("ignores a top-level lookalike key", () => {
    // Only the section is read: the host validates that one on write, and a
    // stray top-level field is not something any surface sets.
    expect(allowInsecureUserEndpoints({ allowInsecureUserEndpoints: true })).toBe(false);
    expect(allowInsecureUserEndpoints({ networkPolicy: { allowInsecure: true } })).toBe(false);
  });
});
