/**
 * Dual-locale product changelog for PI-Desktop app releases.
 *
 * English is the source of truth (ADR 0009). The zh-CN catalog mirrors the
 * same versions and bullet counts so in-app "what's new" can follow the
 * active UI locale without a network fetch or renderer-supplied feed URL.
 *
 * Update this file before cutting a release tag. GitHub release bodies may
 * still be auto-generated for the web; they are not the in-app source.
 */

export type ChangelogLocale = "en" | "zh-CN";

export type ChangelogEntry = {
  /** Semver without a leading `v`, matching apps/desktop package version. */
  version: string;
  /** Optional ISO date (YYYY-MM-DD) of the release. */
  date?: string;
  /** Short user-facing highlights; keep each line one idea. */
  highlights: string[];
};

const enEntries: ChangelogEntry[] = [
  {
    version: "0.2.7",
    date: "2026-07-29",
    highlights: [
      "Keep chat readable beside the work panel by reserving native window width for docked tools.",
      "Smoother conversation switching with cached transcripts and a stable deferred frame.",
      "Project overflow can open the folder in your system file manager.",
      "Markdown can render audio and video media in assistant replies.",
    ],
  },
  {
    version: "0.2.6",
    date: "2026-07-28",
    highlights: [
      "Turn-boundary context checkpoints compact long chats without hiding transcript history.",
      "Composer prompt rows no longer show a leading brand icon.",
      "Sidebar session titles use a denser type scale that matches project groups.",
    ],
  },
];

const zhCNEntries: ChangelogEntry[] = [
  {
    version: "0.2.7",
    date: "2026-07-29",
    highlights: [
      "停靠工作面板时为工具预留原生窗口宽度，聊天区域保持可读。",
      "会话切换更顺畅：缓存最近对话，并在加载时保持稳定过渡帧。",
      "项目溢出菜单可在系统文件管理器中打开项目文件夹。",
      "助手回复中的 Markdown 可渲染音频与视频。",
    ],
  },
  {
    version: "0.2.6",
    date: "2026-07-28",
    highlights: [
      "在回合边界做上下文检查点压缩，长对话不再隐藏历史记录。",
      "输入框提示行不再显示品牌图标。",
      "侧边栏会话标题字号更紧凑，与项目分组层级一致。",
    ],
  },
];

/** Locale → newest-first product notes. */
export const CHANGELOG: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: enEntries,
  "zh-CN": zhCNEntries,
};

/** Normalize `v0.2.7` / whitespace to the catalog key form. */
export function normalizeChangelogVersion(
  version: string | null | undefined,
): string {
  return String(version ?? "")
    .trim()
    .replace(/^v/i, "");
}

export function resolveChangelogLocale(
  input?: string | null,
): ChangelogLocale {
  const value = (input || "").toLowerCase();
  if (value.startsWith("zh")) return "zh-CN";
  return "en";
}

export function getChangelogEntry(
  version: string | null | undefined,
  locale: ChangelogLocale = "en",
): ChangelogEntry | undefined {
  const key = normalizeChangelogVersion(version);
  if (!key) return undefined;
  const catalog = CHANGELOG[locale] ?? CHANGELOG.en;
  return catalog.find((entry) => entry.version === key);
}

/**
 * Format highlights as plain multi-line text for UpdateState / compact UI.
 * Returns undefined when the version has no catalog entry or empty highlights.
 */
export function formatChangelogNotes(
  version: string | null | undefined,
  localeInput?: string | null,
): string | undefined {
  const locale = resolveChangelogLocale(localeInput);
  const entry =
    getChangelogEntry(version, locale) ??
    (locale === "en" ? undefined : getChangelogEntry(version, "en"));
  if (!entry?.highlights.length) return undefined;
  return entry.highlights.map((line) => `• ${line}`).join("\n");
}
