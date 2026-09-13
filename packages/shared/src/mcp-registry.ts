/**
 * Adapter from the official MCP Registry (registry.modelcontextprotocol.io)
 * server records to market catalog templates.
 *
 * Pure mapping only — the network lives in the Electron main process, the
 * same split models.dev uses. A record the registry lists but that carries no
 * runnable form (no npm/pypi package and no https remote) maps to null: the
 * market never saves a template it could not start.
 */
import {
  catalogEntryError,
  type McpCatalogCategory,
  type McpCatalogEntry,
  type McpCatalogRequiredEnv,
} from "./mcp-catalog.js";

export type RegistryEnvVar = {
  name?: string;
  description?: string;
  isRequired?: boolean;
  /** Registry-side fixed value / default: becomes the install form's prefilled value. */
  value?: string;
  default?: string;
};

export type RegistryArgument = {
  type?: string;
  name?: string;
  value?: string;
};

export type RegistryPackage = {
  registryType?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  runtimeArguments?: RegistryArgument[];
  packageArguments?: RegistryArgument[];
  environmentVariables?: RegistryEnvVar[];
};

export type RegistryRemote = {
  type?: string;
  url?: string;
  headers?: Array<{ name?: string; value?: string }>;
};

export type RegistryServer = {
  name?: string;
  title?: string;
  description?: string;
  homepage?: string;
  repository?: { url?: string } | string;
  packages?: RegistryPackage[];
  remotes?: RegistryRemote[];
};

export type RegistryRecord = { server?: RegistryServer };

/** reverse-DNS registry name → id-safe slug (`com.pulsemcp/foo` → `com-pulsemcp-foo`). */
export function registryIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .split("/")
    .map((part) => part.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug) return "mcp-server";
  return /^[a-z]/.test(slug) ? slug : `mcp-${slug}`.slice(0, 64);
}

function envSpecs(pkg: RegistryPackage): McpCatalogRequiredEnv[] {
  return (pkg.environmentVariables ?? [])
    .filter((variable): variable is RegistryEnvVar & { name: string } => !!variable.name)
    .map((variable) => ({
      name: variable.name,
      ...(variable.description ? { description: variable.description } : {}),
      ...(variable.isRequired ? {} : { optional: true }),
      ...(variable.value !== undefined
        ? { defaultValue: variable.value }
        : variable.default !== undefined
          ? { defaultValue: variable.default }
          : {}),
    }));
}

/**
 * Registry arguments split into launcher-level (runtime) and package-level.
 * `named` arguments keep their name (and value); `positional` keep values —
 * so `--port 8080` style flags survive the mapping.
 */
export function argumentValues(
  args?: RegistryArgument[],
): string[] {
  const out: string[] = [];
  for (const argument of args ?? []) {
    const named = argument.type === "named" || (!!argument.name && argument.type !== "positional");
    if (named) {
      if (argument.name) out.push(argument.name);
      if (argument.value) out.push(argument.value);
    } else if (argument.value) {
      out.push(argument.value);
    }
  }
  return out;
}

function envTemplates(pkg: RegistryPackage): Record<string, string> | undefined {
  const names = (pkg.environmentVariables ?? [])
    .filter((variable): variable is RegistryEnvVar & { name: string } => !!variable.name)
    .map((variable) => variable.name);
  return names.length ? Object.fromEntries(names.map((name) => [name, `\${${name}}`])) : undefined;
}

/*
 * The registry publishes no taxonomy, but the market's category filters are
 * useless if every remote entry lands in "all" only. This keyword pass is a
 * deliberately cheap guess — wrong-guessing a handful of entries costs less
 * than hiding them from every filter. Order matters: specific families first,
 * docs last because "docker"/"docs" share a prefix.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [McpCatalogCategory, string[]]> = [
  ["data", ["database", "sql", "postgres", "mysql", "mongo", "redis", "sqlite", "dataset", "warehouse", "analytics", "supabase", "snowflake"]],
  ["productivity", ["todo", "task", "calendar", "email", "mail", "remind", "schedule", "slack", "notion", "jira", "linear", "asana", "habit", "time"]],
  ["web", ["search", "scrape", "crawl", "browser", "fetch", "playwright", "puppeteer", "seo", "web", "surf"]],
  ["devtools", ["github", "gitlab", "git ", "docker", "kubernetes", "k8s", "deploy", "terminal", "shell", "code", "repo", "issue", "build", "lint", "test", "ci ", "ide", "api", "sentry", " observability"]],
  ["docs", ["doc", "wiki", "knowledge", "context", "reference", "manual", "library", "framework", "changelog", "arxiv", "paper"]],
];

export function guessCategory(server: RegistryServer): McpCatalogCategory {
  const haystack = `${server.name ?? ""} ${server.title ?? ""} ${server.description ?? ""}`.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return category;
  }
  return "devtools";
}

/**
 * Map one registry record to an installable template.
 * npm wins over pypi over remote; oci-only records are dropped because this
 * app has no docker runner for user servers.
 */
export function mapRegistryServer(record: RegistryRecord): McpCatalogEntry | null {
  const server = record?.server;
  if (!server?.name) return null;
  const id = registryIdFromName(server.name);
  const displayName = server.title?.trim() || server.name.split("/").pop() || server.name;
  const repositoryUrl =
    typeof server.repository === "string" ? server.repository : server.repository?.url;
  const homepage = server.homepage?.trim() || repositoryUrl || undefined;
  const base = {
    id,
    name: displayName,
    description: server.description?.trim() || undefined,
    homepage,
    categories: [guessCategory(server)],
  };

  const npm = server.packages?.find((pkg) => pkg.registryType === "npm" && pkg.identifier);
  if (npm) {
    const runtimeArgs = argumentValues(npm.runtimeArguments);
    const packageArgs = argumentValues(npm.packageArguments);
    const args = [...runtimeArgs];
    if (npm.identifier && !args.includes(npm.identifier) && !packageArgs.includes(npm.identifier)) {
      args.push(npm.identifier);
    }
    args.push(...packageArgs);
    const entry: McpCatalogEntry = {
      ...base,
      transport: "stdio",
      command: npm.runtimeHint?.trim() || "npx",
      args,
      ...(envTemplates(npm) ? { env: envTemplates(npm) } : {}),
      ...(npm.environmentVariables?.length
        ? { requiredEnv: envSpecs(npm) }
        : {}),
    };
    return catalogEntryError(entry) ? null : entry;
  }

  const pypi = server.packages?.find(
    (pkg) => pkg.registryType?.toLowerCase() === "pypi" && pkg.identifier,
  );
  if (pypi) {
    const entry: McpCatalogEntry = {
      ...base,
      transport: "stdio",
      command: pypi.runtimeHint?.trim() || "uvx",
      args: [pypi.identifier!],
      prerequisites: ["Requires uv/uvx on PATH"],
      ...(envTemplates(pypi) ? { env: envTemplates(pypi) } : {}),
      ...(pypi.environmentVariables?.length ? { requiredEnv: envSpecs(pypi) } : {}),
    };
    return catalogEntryError(entry) ? null : entry;
  }

  const remote = server.remotes?.find((candidate) => /^https:/i.test(candidate.url ?? ""));
  if (remote) {
    const headers = Object.fromEntries(
      (remote.headers ?? [])
        .filter((header) => header.name && header.value !== undefined)
        .map((header) => [header.name!, header.value!]),
    );
    const entry: McpCatalogEntry = {
      ...base,
      transport: "http",
      url: remote.url!,
      ...(Object.keys(headers).length ? { headers } : {}),
    };
    return catalogEntryError(entry) ? null : entry;
  }

  return null;
}

/** Built-in picks first; registry entries fill the tail without id collisions. */
export function mergeRegistryEntries(
  builtin: McpCatalogEntry[],
  remote: McpCatalogEntry[],
): McpCatalogEntry[] {
  const seen = new Set(builtin.map((entry) => entry.id));
  const merged = [...builtin];
  for (const entry of remote) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

/** One user-configurable market source. */
export type MarketSourceKind = "registry" | "catalog";

export type MarketSource = {
  id: string;
  name: string;
  url: string;
  kind: MarketSourceKind;
  /** The shipped default; the UI does not offer a remove button for it. */
  builtin?: boolean;
};

export const DEFAULT_MARKET_SOURCE: MarketSource = {
  id: "official",
  name: "Official registry",
  url: "https://registry.modelcontextprotocol.io/v0/servers",
  kind: "registry",
  builtin: true,
};

/**
 * Guard for user-entered source URLs: https only, and never a loopback or
 * private-network host — the main process fetches whatever it is told here, so
 * the check runs on both sides of the IPC boundary.
 */
export function isSafeMarketSourceUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return isPublicHostname(parsed.hostname);
}

/**
 * Syntactic hostname check used by renderer and main. DNS resolution is
 * additional and lives in the main process (shared stays I/O-free): a name
 * that passes here can still resolve to a private address.
 */
export function isPublicHostname(hostname: string): boolean {
  // Trailing-dot FQDN smuggling: `https://localhost./` normalizes to
  // `localhost.` and previously slipped past the localhost check.
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return false;
  if (host.startsWith("[")) {
    return isPublicIpLiteral(host.slice(1, -1));
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isPublicIpLiteral(host);
  }
  return true;
}

/** False for loopback, unspecified, v4-mapped/compatible, ULA, link-local, multicast and private/reserved IPv4. */
export function isPublicIpLiteral(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return false;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  const halves = lower.split("::");
  if (halves.length > 2) return false;
  let groups: number[];
  if (halves.length === 2) {
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves[1] ? halves[1].split(":") : [];
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return false;
    groups = [...head, ...Array.from({ length: fill }, () => "0"), ...tail].map((g) =>
      /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : -1,
    );
  } else {
    groups = lower.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : -1));
  }
  if (groups.length !== 8 || groups.some((n) => n < 0)) return false;
  if (groups.every((n) => n === 0)) return false; // unspecified ::
  // ::ffff:a.b.c.d (v4-mapped) and ::a.b.c.d (v4-compatible) inherit v4 rules.
  if (groups.slice(0, 5).every((n) => n === 0)) {
    if (groups[5] === 0xffff || groups[5] === 0) {
      const v4 = `${(groups[6] >> 8) & 255}.${groups[6] & 255}.${(groups[7] >> 8) & 255}.${groups[7] & 255}`;
      return isPublicIpLiteral(v4);
    }
  }
  const first = groups[0];
  const second = groups[1];
  if (first === 0x7f00) return false; // ::7f00:... loopback variants
  if (first >= 0xfe80 && first <= 0xfebf) return false; // fe80::/10 link-local
  if (first >>> 8 === 0xfc || first >>> 8 === 0xfd) return false; // fc00::/7 ULA
  if (first >>> 8 === 0xff) return false; // multicast
  if (first === 0x2001 && second === 0x0db8) return false; // documentation
  return true;
}

/** A catalog entry tagged with the source that produced it. */
export type SourcedCatalogEntry = McpCatalogEntry & { sourceId: string };

/** Repair whatever the renderer persisted into a usable source list. */
export function sanitizeMarketSources(value: unknown): MarketSource[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const sources: MarketSource[] = [];
  for (const item of raw) {
    const candidate = item as MarketSource;
    if (
      !candidate ||
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.url !== "string" ||
      (candidate.kind !== "registry" && candidate.kind !== "catalog") ||
      !isSafeMarketSourceUrl(candidate.url) ||
      seen.has(candidate.id)
    ) {
      continue;
    }
    seen.add(candidate.id);
    sources.push({
      id: candidate.id.slice(0, 64),
      name: candidate.name.slice(0, 64) || candidate.id,
      url: candidate.url,
      kind: candidate.kind,
      ...(candidate.builtin ? { builtin: true } : {}),
    });
  }
  if (!sources.some((source) => source.id === DEFAULT_MARKET_SOURCE.id)) {
    sources.unshift(DEFAULT_MARKET_SOURCE);
  }
  return sources;
}
