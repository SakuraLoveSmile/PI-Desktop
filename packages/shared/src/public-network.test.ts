import { describe, expect, it } from "vitest";
import { isSafePublicHttpsUrl } from "./public-network.js";

describe("isSafePublicHttpsUrl", () => {
  const rejected = [
    "https://localhost./x/catalog.json",
    "https://[::1]/catalog.json",
    "https://[::ffff:127.0.0.1]/catalog.json",
    "https://[::ffff:7f00:1]/catalog.json",
    "https://[fd00::1]/catalog.json",
    "https://[fe80::1]/catalog.json",
    "https://127.0.0.1/catalog.json",
    "https://10.0.0.8/catalog.json",
    "https://192.168.1.1/catalog.json",
    "https://169.254.169.254/x",
    "http://skills.example/catalog.json",
    "https://evil.localhost/x",
    "https://metadata.google.internal/x",
  ];

  it("rejects loopback, private, mapped, ULA, link-local, and non-https forms", () => {
    for (const url of rejected) {
      expect(isSafePublicHttpsUrl(url), url).toBe(false);
    }
  });

  it("accepts public https hosts", () => {
    expect(isSafePublicHttpsUrl("https://cdn.jsdelivr.net/gh/x")).toBe(true);
    expect(isSafePublicHttpsUrl("https://github.com/anthropics/skills")).toBe(true);
  });
});
