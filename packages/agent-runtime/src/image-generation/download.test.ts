import { lookup } from "node:dns/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const { downloadGeneratedImage } = await import("./download.js");
const lookupMock = vi.mocked(lookup);
const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1,
]);

describe("generated image URL downloads", () => {
  const fakeIpAnswer = [{ address: "198.18.0.10", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>;
  const privateAnswer = [{ address: "10.0.0.4", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>;

  beforeEach(() => lookupMock.mockReset());

  it("uses the proxy-aware fetch for an explicitly allowed fake-IP answer", async () => {
    lookupMock.mockResolvedValue(fakeIpAnswer);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(png, { headers: { "content-length": String(png.length) } }),
    );
    await expect(
      downloadGeneratedImage("https://images.example.test/result.png", new AbortController().signal, {
        allowFakeIp: true,
        fetchImpl,
      }),
    ).resolves.toEqual(Buffer.from(png));
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://images.example.test/result.png");
    expect(init?.redirect).toBe("error");
  });

  it("keeps fake-IP answers blocked without the explicit opt-in", async () => {
    lookupMock.mockResolvedValue(fakeIpAnswer);
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      downloadGeneratedImage("https://images.example.test/result.png", new AbortController().signal, {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ errorCode: "IMAGE_UNSAFE_URL" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps real private answers blocked even when fake-IP is allowed", async () => {
    lookupMock.mockResolvedValue(privateAnswer);
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      downloadGeneratedImage("https://images.example.test/result.png", new AbortController().signal, {
        allowFakeIp: true,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ errorCode: "IMAGE_UNSAFE_URL" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
