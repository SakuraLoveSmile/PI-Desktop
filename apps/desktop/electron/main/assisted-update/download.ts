import { createHash } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { AssistedUpdateError, isAbortError } from "./errors";
import {
  ASSISTED_MAX_DOWNLOAD_BYTES,
  ASSISTED_MAX_REDIRECTS,
  isAllowedAssetUrl,
  type AssistedAsset,
} from "./release-asset";

export type HttpResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
};

/**
 * Minimal GET transport. `allowRedirect` is called synchronously for every
 * redirect target and decides whether the transport may follow it; Electron
 * requires that decision inside the redirect event.
 */
export type HttpTransport = {
  get(
    url: string,
    options: { signal: AbortSignal; allowRedirect: (target: string) => boolean },
  ): Promise<HttpResponse>;
};

export type DownloadOptions = {
  asset: AssistedAsset;
  /** Final path; the bytes are written to `<destination>.part` first. */
  destination: string;
  transport: HttpTransport;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
  /** No bytes for this long aborts the download. */
  stallTimeoutMs?: number;
};

const DEFAULT_STALL_TIMEOUT_MS = 60_000;

/**
 * Streams the asset to disk, hashing as it writes. The file appears at
 * `destination` only when its size and SHA-512 match the release; any other
 * outcome deletes the partial file.
 */
export async function downloadAsset(options: DownloadOptions): Promise<void> {
  const { asset, destination, transport, signal } = options;
  const part = `${destination}.part`;
  const stallMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  const inner = new AbortController();
  // Closures record the first failure; a holder object keeps TypeScript from
  // narrowing the field to `null` at the checks below.
  const failed: { error: AssistedUpdateError | null } = { error: null };
  const fail = (error: AssistedUpdateError) => {
    failed.error ??= error;
    inner.abort();
  };
  const onOuterAbort = () => fail(new AssistedUpdateError("aborted", "download cancelled"));
  if (signal.aborted) onOuterAbort();
  else signal.addEventListener("abort", onOuterAbort, { once: true });
  // Rejects as soon as anything aborts the download, even when the transport
  // itself never notices (every await below races it).
  const aborted = new Promise<never>((_, reject) => {
    const onInnerAbort = () =>
      reject(failed.error ?? new AssistedUpdateError("aborted", "download cancelled"));
    if (inner.signal.aborted) onInnerAbort();
    else inner.signal.addEventListener("abort", onInnerAbort, { once: true });
  });
  aborted.catch(() => undefined);
  let stallTimer: NodeJS.Timeout | null = null;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(
      () => fail(new AssistedUpdateError("stalled", "the download stopped receiving data")),
      stallMs,
    );
  };

  await rm(part, { force: true });
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    armStall();
    let redirects = 0;
    const response = await Promise.race([
      transport.get(asset.url, {
        signal: inner.signal,
        allowRedirect: (target) => {
          redirects += 1;
          if (redirects > ASSISTED_MAX_REDIRECTS || !isAllowedAssetUrl(target)) {
            fail(
              new AssistedUpdateError(
                "redirect-rejected",
                "the download redirected to a host that is not allowed",
              ),
            );
            return false;
          }
          return true;
        },
      }),
      aborted,
    ]);
    if (failed.error) throw failed.error;
    if (response.statusCode !== 200) {
      throw new AssistedUpdateError("http-status", `the download answered HTTP ${response.statusCode}`);
    }
    const declared = headerValue(response.headers["content-length"]);
    if (declared !== undefined && Number(declared) !== asset.size) {
      throw new AssistedUpdateError("size-mismatch", "the download size differs from the release");
    }
    handle = await open(part, "wx", 0o600);
    const hash = createHash("sha512");
    let received = 0;
    let lastPercent = -1;
    const iterator = response.body[Symbol.asyncIterator]();
    try {
      for (;;) {
        const step = await Promise.race([iterator.next(), aborted]);
        if (step.done) break;
        const chunk = step.value;
        armStall();
        received += chunk.byteLength;
        if (received > asset.size || received > ASSISTED_MAX_DOWNLOAD_BYTES) {
          throw new AssistedUpdateError("too-large", "the download is larger than the release says");
        }
        hash.update(chunk);
        await handle.write(chunk);
        const percent = Math.min(99, Math.floor((received / asset.size) * 100));
        if (percent !== lastPercent) {
          lastPercent = percent;
          options.onProgress?.(percent);
        }
      }
    } finally {
      // A stream that ignores the abort may still be open.
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    }
    if (failed.error) throw failed.error;
    if (received !== asset.size) {
      throw new AssistedUpdateError("size-mismatch", "the download ended before the full size arrived");
    }
    if (hash.digest("base64") !== asset.sha512) {
      throw new AssistedUpdateError("hash-mismatch", "the download does not match the release SHA-512");
    }
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(part, destination);
  } catch (error) {
    // A transport that dies on abort reports its own error; the first recorded
    // reason (cancel, stall, rejected redirect) is the real one.
    const reason: unknown = failed.error ?? error;
    throw isAbortError(reason) || reason instanceof AssistedUpdateError
      ? reason
      : new AssistedUpdateError("http-status", `the download failed: ${String(reason)}`);
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    signal.removeEventListener("abort", onOuterAbort);
    await handle?.close().catch(() => undefined);
    await rm(part, { force: true }).catch(() => undefined);
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
