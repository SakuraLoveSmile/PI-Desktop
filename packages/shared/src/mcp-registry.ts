/**
 * Adapter from the official MCP Registry (registry.modelcontextprotocol.io)
 * server records to market catalog templates.
 *
 * Pure mapping only — the network lives in the Electron main process, the
 * same split models.dev uses. A record the registry lists but that carries no
 * runnable form (no npm/pypi package and no https remote) maps to null: the
 * market never saves a template it could not start.
 */
import { isSafePublicHttpsUrl } from "./public-network.js";
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

/** Same public-HTTPS classifier as the skill market (ADR 0243). */
export function isSafeMarketSourceUrl(url: string): boolean {
  return isSafePublicHttpsUrl(url);
}

export { isPublicHostname, isPublicIpLiteral } from "./public-network.js";

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
