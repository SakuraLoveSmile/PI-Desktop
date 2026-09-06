import assert from "node:assert/strict";
import test from "node:test";

export function isAllowedExternalUrl(rawUrl) {
  try {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
      return false;
    }
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function safeOpenExternal(rawUrl, openExternalImpl) {
  if (!isAllowedExternalUrl(rawUrl)) {
    return false;
  }
  if (openExternalImpl) {
    await openExternalImpl(rawUrl);
  }
  return true;
}

test("safeOpenExternal permits valid http and https URLs", async () => {
  const calls = [];
  const mockOpen = async (url) => {
    calls.push(url);
  };

  const validUrls = [
    "https://github.com/pi-desktop/pi-desktop",
    "https://claude.ai",
    "http://localhost:3000/docs",
    "http://127.0.0.1:8080/api?query=hello#test",
  ];

  for (const url of validUrls) {
    const result = await safeOpenExternal(url, mockOpen);
    assert.equal(result, true, `Expected URL to be allowed: ${url}`);
  }

  assert.equal(calls.length, validUrls.length);
  assert.deepEqual(calls, validUrls);
});

test("safeOpenExternal blocks dangerous local file protocols", async () => {
  const calls = [];
  const mockOpen = async (url) => {
    calls.push(url);
  };

  const dangerousFileUrls = [
    "file:///etc/passwd",
    "file:///C:/Windows/System32/cmd.exe",
    "file://localhost/Users/admin/.ssh/id_rsa",
    "FILE:///path/to/script.sh",
  ];

  for (const url of dangerousFileUrls) {
    const result = await safeOpenExternal(url, mockOpen);
    assert.equal(result, false, `Expected file protocol to be blocked: ${url}`);
  }

  assert.equal(calls.length, 0, "No external handler should be called for file URLs");
});

test("safeOpenExternal blocks dangerous system scheme and execution protocols", async () => {
  const calls = [];
  const mockOpen = async (url) => {
    calls.push(url);
  };

  const dangerousSchemes = [
    "ms-msdt:/id%20PCWDiagnostic",
    "search-ms:query=calc.exe",
    "custom-scheme://execute?cmd=calc",
    "ssh://user@attacker.com",
    "telnet://attacker.com:23",
  ];

  for (const url of dangerousSchemes) {
    const result = await safeOpenExternal(url, mockOpen);
    assert.equal(result, false, `Expected custom scheme to be blocked: ${url}`);
  }

  assert.equal(calls.length, 0);
});

test("safeOpenExternal blocks script injection and data URLs", async () => {
  const calls = [];
  const mockOpen = async (url) => {
    calls.push(url);
  };

  const scriptUrls = [
    "javascript:alert(1)",
    "JAVASCRIPT:console.log('xss')",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox('hi')",
  ];

  for (const url of scriptUrls) {
    const result = await safeOpenExternal(url, mockOpen);
    assert.equal(result, false, `Expected script URL to be blocked: ${url}`);
  }

  assert.equal(calls.length, 0);
});

test("safeOpenExternal rejects malformed, empty or invalid inputs", async () => {
  const calls = [];
  const mockOpen = async (url) => {
    calls.push(url);
  };

  const invalidInputs = [
    "",
    "   ",
    null,
    undefined,
    ":::invalid",
    "not-a-url",
    12345,
  ];

  for (const input of invalidInputs) {
    const result = await safeOpenExternal(input, mockOpen);
    assert.equal(result, false, `Expected invalid input to be rejected: ${input}`);
  }

  assert.equal(calls.length, 0);
});
