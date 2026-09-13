/**
 * Shared vocabulary for the skill market surface.
 *
 * A skill entry points at one markdown document (SKILL.md-style: optional
 * frontmatter over an instruction body). Installing resolves the document and
 * feeds it through the existing `skills.create` write path — the host renders
 * its own frontmatter, so the market only ever needs to split, never to
 * reformat. Nothing here performs I/O; catalog JSON sources and the built-in
 * picks share these rules.
 */
import type { UserSkillInput } from "./types.js";

export type SkillCatalogCategory = "workflow" | "writing" | "coding" | "data" | "docs";

export type SkillCatalogEntry = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** Absolute https URL of the raw markdown document. */
  url: string;
  categories?: SkillCatalogCategory[];
  verified?: boolean;
  version?: string;
  notes?: string;
};

export type SkillCatalogFile = {
  schemaVersion: 1;
  updatedAt: string;
  source: "builtin";
  skills: SkillCatalogEntry[];
};

export function skillEntryError(entry: SkillCatalogEntry): string | null {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(entry.id)) return `bad id: ${entry.id}`;
  if (!entry.url) return `${entry.id}: url is required`;
  try {
    const parsed = new URL(entry.url);
    if (parsed.protocol !== "https:") return `${entry.id}: catalog documents must be https`;
  } catch {
    return `${entry.id}: url does not parse`;
  }
  return null;
}

/** Lenient parse: bad entries become warnings instead of a failed load. */
export function validateSkillCatalogFile(value: unknown): {
  catalog: SkillCatalogFile;
  warnings: string[];
} {
  const warnings: string[] = [];
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawSkills = Array.isArray(root.skills) ? root.skills : [];
  if (!Array.isArray(root.skills)) warnings.push("catalog has no skills array");
  const skills: SkillCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of rawSkills.entries()) {
    const entry = candidate as SkillCatalogEntry;
    if (!entry || typeof entry !== "object") {
      warnings.push(`entry ${index} is not an object`);
      continue;
    }
    if (seen.has(entry.id)) {
      warnings.push(`duplicate id: ${entry.id}`);
      continue;
    }
    const error = skillEntryError(entry);
    if (error) {
      warnings.push(error);
      continue;
    }
    seen.add(entry.id);
    skills.push(entry);
  }
  return {
    catalog: {
      schemaVersion: 1,
      updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : "",
      source: "builtin",
      skills,
    },
    warnings,
  };
}

/**
 * Split a fetched document into frontmatter metadata and the instruction body.
 *
 * `skills.create` renders its own frontmatter from name/description, so the
 * body this returns must NOT include the original block — passing it through
 * would produce double frontmatter.
 */
export function splitSkillDocument(text: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (!match) return { body: text };
  let name: string | undefined;
  let description: string | undefined;
  for (const line of match[1].split("\n")) {
    const m = /^(name|description):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (m[1] === "name" && value) name = value;
    if (m[1] === "description" && value) description = value;
  }
  return { name, description, body: text.slice(match[0].length) };
}

/** A user-configurable catalog source. */
export type SkillMarketSource = {
  id: string;
  name: string;
  url: string;
};

/**
 * Guard for user-entered source/document URLs: https only, never a loopback
 * or private-network host — trailing dots, IPv4-mapped/compatible and ULA /
 * link-local IPv6 included. Syntactic only; DNS resolution is the main
 * process's per-hop job.
 */
export function isSafeSkillSourceUrl(url: string): boolean {
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


export type SourcedSkillEntry = SkillCatalogEntry & { sourceId: string };
/** Built-in picks first; catalog source entries fill the tail without id collisions. */
export function mergeSkillEntries(
  builtin: SkillCatalogEntry[],
  remote: SkillCatalogEntry[],
): SkillCatalogEntry[] {
  const seen = new Set(builtin.map((entry) => entry.id));
  const merged = [...builtin];
  for (const entry of remote) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

/** Repair whatever the renderer persisted into a usable source list. */
export function sanitizeSkillSources(value: unknown): SkillMarketSource[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const sources: SkillMarketSource[] = [];
  for (const item of raw) {
    const candidate = item as SkillMarketSource;
    if (
      !candidate ||
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.url !== "string" ||
      !isSafeSkillSourceUrl(candidate.url) ||
      seen.has(candidate.id)
    ) {
      continue;
    }
    seen.add(candidate.id);
    sources.push({
      id: candidate.id.slice(0, 64),
      name: candidate.name.slice(0, 64) || candidate.id,
      url: candidate.url,
    });
  }
  return sources;
}

export type SkillResource = { path: string; body: string };

/**
 * Inline adjacent skill files into the document body as fenced appendices.
 * The user-skill model is a single markdown file, so a multi-file skill
 * directory is expanded instead of stored beside an unreachable reference.
 */
export function expandSkillResources(doc: { body: string }, resources: SkillResource[]): string {
  if (!resources.length) return doc.body;
  return (
    doc.body.replace(/\s*$/, "") +
    resources
      .map(
        (resource) =>
          `\n\n---\n\n# Attached resource: ${resource.path}\n\n\`\`\`\n${resource.body.replace(/\s*$/, "")}\n\`\`\``,
      )
      .join("") +
    "\n"
  );
}

/** Assemble the input for the existing `skills.create` write path. */
export function toSkillInput(
  entry: SkillCatalogEntry,
  document: { name?: string; description?: string; body: string },
): UserSkillInput {
  return {
    id: entry.id,
    name: document.name || entry.name,
    description: document.description || entry.description,
    body: document.body,
    enabled: true,
  };
}
