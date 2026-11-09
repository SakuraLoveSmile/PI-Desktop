import { AssistedUpdateError } from "./errors";

/** Fixed release repository; the lane never downloads from anywhere else. */
export const ASSISTED_REPOSITORY = {
  owner: "SakuraLoveSmile",
  repo: "PI-Desktop",
} as const;

export const ASSISTED_MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
export const ASSISTED_MAX_REDIRECTS = 5;

const RELEASE_HOST = "github.com";
/** Hosts GitHub serves release assets from after the redirect from github.com. */
const ASSET_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const STABLE_VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

export type AssistedAsset = {
  version: string;
  name: string;
  /** Built from the fixed repository and tag, never taken from the feed. */
  url: string;
  /** Base64 SHA-512 from the same release's feed. */
  sha512: string;
  size: number;
};

/** The subset of electron-updater's `UpdateInfo` the lane reads. */
export type FeedInfo = { version?: unknown; files?: unknown };

export function assistedAssetName(version: string, arch: string): string {
  return `Pi-Desktop-Plus-${version}-${arch}-mac.zip`;
}

/**
 * Picks the one ZIP of this version and architecture from the feed. The feed
 * supplies the version, hash and size; the URL is rebuilt from the fixed
 * repository so a feed cannot point the download elsewhere.
 */
export function selectAssistedAsset(info: FeedInfo, arch: string): AssistedAsset {
  const version = typeof info.version === "string" ? info.version : "";
  if (!STABLE_VERSION.test(version)) {
    throw new AssistedUpdateError("asset-missing", `unsupported release version "${version}"`);
  }
  const name = assistedAssetName(version, arch);
  const files = Array.isArray(info.files) ? (info.files as unknown[]) : [];
  const matches = files.filter((file): file is Record<string, unknown> => {
    if (typeof file !== "object" || file === null) return false;
    const url = (file as { url?: unknown }).url;
    return typeof url === "string" && feedFileName(url) === name;
  });
  if (matches.length !== 1) {
    throw new AssistedUpdateError(
      "asset-missing",
      matches.length === 0 ? `${name} is not listed in the release` : `${name} is listed more than once`,
    );
  }
  const { sha512, size } = matches[0];
  if (typeof sha512 !== "string" || !SHA512_BASE64.test(sha512)) {
    throw new AssistedUpdateError("asset-integrity", `${name} has no valid SHA-512 in the release`);
  }
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > ASSISTED_MAX_DOWNLOAD_BYTES
  ) {
    throw new AssistedUpdateError("asset-integrity", `${name} has no usable size in the release`);
  }
  const { owner, repo } = ASSISTED_REPOSITORY;
  return {
    version,
    name,
    url: `https://${RELEASE_HOST}/${owner}/${repo}/releases/download/v${version}/${name}`,
    sha512,
    size,
  };
}

/** The final path segment of a feed entry, whether it is a bare name or a URL. */
function feedFileName(entry: string): string | null {
  try {
    const segment = new URL(entry, "https://feed.invalid/").pathname.split("/").pop();
    return segment ? decodeURIComponent(segment) : null;
  } catch {
    return null;
  }
}

/** Initial URL and every redirect target must stay on GitHub's HTTPS asset hosts. */
export function isAllowedAssetUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    ASSET_HOSTS.has(url.hostname) &&
    (url.port === "" || url.port === "443") &&
    url.username === "" &&
    url.password === ""
  );
}
