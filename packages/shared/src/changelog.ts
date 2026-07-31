/**
 * Dual-locale product changelog for PI-Desktop app releases.
 *
 * English is the source of truth (ADR 0009). The zh-CN catalog mirrors the
 * same versions and bullet counts so in-app "what's new" can follow the
 * active UI locale without a network fetch or renderer-supplied feed URL.
 *
 * Update this file before cutting a release tag. GitHub release bodies may
 * still be auto-generated for the web; they are not the in-app source.
 * Stable product versions only — omit pre-releases.
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
    version: "0.4.0",
    date: "2026-08-01",
    highlights: [
      "Plugins can now contribute skills, themes, MCP servers, resident services, and an inter-plugin message bus.",
      "The plugin SDK declares all new capability types so authors can activate them from manifest.",
      "Host core validates capability contributions and derives per-plugin permissions automatically.",
      "Agent system prompt now includes plugin-declared skills for tool-aware conversations.",
      "Plugins page redesigned with a template picker, hot reload on save, and authoring tools.",
      "Creating a plugin from a template now opens the scaffolded folder as the project.",
      "Unified work panel header menu with cleaner controls and context actions.",
      "Styles split into per-surface partials; duplicate and dead CSS removed.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-07-31",
    highlights: [
      "Settings project archive now shows grouped sections (Pinned / All / Archived) with per-section counts, live search, and sort controls.",
      "Work panel dock width is narrower for better layout proportions.",
      "Fix switch on-track styling in light theme.",
    ],
  },
  {
    version: "0.2.11",
    date: "2026-07-31",
    highlights: [
      "Global Search now finds chats, pages, Settings, and built-in or plugin commands in one place.",
      "Appearance controls now use theme and language preview cards, with automatic language correctly following the OS locale.",
      "Settings now has dedicated AI and Shortcuts sections for clearer navigation.",
      "The agent now loads layered AGENTS.md/CLAUDE.md project instructions, with editors for global and project AGENTS.md.",
      "Project archive now searches session titles and shows newest-first activity, session counts, timestamps, and expandable history.",
      "Fix a desktop startup failure caused by the sandboxed preload regression.",
      "Reduce the audited macOS unpacked app footprint by about 55% while retaining offline syntax highlighting and native terminal support.",
    ],
  },
  {
    version: "0.2.10",
    date: "2026-07-30",
    highlights: [
      "Add Codex/WorkBuddy-style conversation top bar with improved controls.",
      "Refresh chat transcript and markdown prose styling for better readability.",
      "Unify work panel header with context menu and animate sidebar collapse.",
      "Combine tool launchers into one create dropdown for cleaner interface.",
      "Dock work panel inside fixed window instead of expanding it.",
      "Polish top bar controls: de-duplicate toggle, protect controls, macOS alignment.",
    ],
  },
  {
    version: "0.2.8",
    date: "2026-07-29",
    highlights: [
      "Update prompts and Settings now open complete localized release notes.",
      "Work panel expansion and collapse animations feel smoother.",
      "Long conversations compact oversized tool-result batches more reliably.",
    ],
  },
  {
    version: "0.2.7",
    date: "2026-07-28",
    highlights: [
      "Markdown replies can render images, audio, and video inline.",
      "Remote images display with updated content security policy.",
      "Media markup is sanitized so only safe tags are allowed.",
    ],
  },
  {
    version: "0.2.6",
    date: "2026-07-28",
    highlights: [
      "Turn-boundary context checkpoints compact long chats without hiding history.",
      "Smoother conversation switching with cached transcripts and a stable frame.",
      "Docked tools keep a fixed width so chat stays readable beside the work panel.",
      "Project menu can open the folder in your system file manager.",
      "Composer prompt rows no longer show a leading brand icon.",
    ],
  },
  {
    version: "0.2.5",
    date: "2026-07-28",
    highlights: [
      "Work panel navigation redesigned with a clearer tool rail.",
      "Window resizing is panel-aware so layout stays predictable.",
      "Streaming renders are isolated for snappier interaction.",
      "New reasoning sessions default to maximum thinking when available.",
      "Transcript stays pinned to the latest message after you send.",
    ],
  },
  {
    version: "0.2.4",
    date: "2026-07-28",
    highlights: [
      "Composer chips keep descenders fully visible.",
      "Updated pi-ai for newer Claude models including Opus 5 support.",
    ],
  },
  {
    version: "0.2.3",
    date: "2026-07-28",
    highlights: [
      "Shell copy rewritten in plain user language across locales.",
      "Selection, CJK labels, and hover motion polish.",
      "Work panel and Settings light surfaces refined.",
      "Prerelease installs now discover newer stable GitHub releases.",
    ],
  },
  {
    version: "0.2.2",
    date: "2026-07-27",
    highlights: [
      "Plugin marketplace with official remote catalog and detail panes.",
      "Isolated plugin panels and gated high-risk APIs.",
      "Right-click section toolbars to create projects or sessions.",
      "Startup splash, smoother motion, and i18n polish.",
      "Work panel top nav supports right-click to open tools.",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-07-27",
    highlights: [
      "Work panel tools are retained per conversation.",
      "Review entry is scoped to the session that made the edits.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-07-27",
    highlights: [
      "Sidebar separates projects and sessions with clearer task status.",
      "Fork or edit assistant replies; icon-only message toolbars.",
      "Workspace review entry after successful file edits.",
      "Keyboard shortcut mappings and developer mode for DevTools.",
      "pi model catalog is the authority for provider models.",
      "Thinking control sits beside mode in the composer.",
    ],
  },
  {
    version: "0.1.1",
    date: "2026-07-26",
    highlights: [
      "First public release: local-first AI coding agent desktop client.",
      "Chat and Agent modes with streaming, thinking levels, and model management.",
      "Workspace tools with permission gating, terminal, browser, and git review.",
      "Rust host core for storage, secrets, sessions, and notifications.",
      "Plugin foundation plus dual English / 简体中文 UI.",
      "Update checks against GitHub Releases (in-app where supported).",
    ],
  },
];

const zhCNEntries: ChangelogEntry[] = [
  {
    version: "0.4.0",
    date: "2026-08-01",
    highlights: [
      "插件现可贡献技能、主题、MCP 服务器、常驻服务以及插件间消息总线。",
      "插件 SDK 声明所有新增能力类型，作者可通过清单激活。",
      "宿主核心校验能力贡献并自动派生每插件权限。",
      "智能体系统提示词现包含插件声明的技能，支持工具感知对话。",
      "插件页面重新设计，新增模板选择器、保存时热重载与开发工具。",
      "从模板创建插件后会自动将脚手架文件夹作为项目打开。",
      "统一工作面板头部菜单，控件与上下文操作更清晰。",
      "样式拆分为按表面分文件，清理重复与无用 CSS。",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-07-31",
    highlights: [
      "设置页项目归档改用分组布局（置顶 / 全部 / 已归档），每组显示计数，并支持实时搜索与排序。",
      "工作面板停靠宽度收窄，布局更协调。",
      "修复浅色主题下开关控件样式异常。",
    ],
  },
  {
    version: "0.2.11",
    date: "2026-07-31",
    highlights: [
      "全局搜索现可同时查找聊天、页面、设置，以及内置和插件命令。",
      "外观设置改用主题与语言预览卡片，自动语言会正确跟随操作系统。",
      "设置页新增独立的“全局 AI”和“快捷键”分区，导航更清晰。",
      "智能体可自动加载分层的 AGENTS.md/CLAUDE.md 项目指令，并支持编辑全局与项目 AGENTS.md。",
      "项目归档支持按会话标题搜索，并按最新活动展示会话数量、更新时间和更多历史。",
      "修复沙箱化预加载回归导致的桌面应用启动故障。",
      "将审计后的 macOS 应用解压体积缩减约 55%，同时保留离线语法高亮与原生终端能力。",
    ],
  },
  {
    version: "0.2.10",
    date: "2026-07-30",
    highlights: [
      "添加 Codex/WorkBuddy 风格对话顶栏，改进控制按钮。",
      "刷新聊天记录和 Markdown 样式，提升可读性。",
      "统一工作面板头部，添加上下文菜单并动画化侧边栏折叠。",
      "合并工具启动器为单个创建下拉菜单，界面更简洁。",
      "工作面板在固定窗口内停靠，不再扩展窗口。",
      "优化顶栏控制：去重切换按钮、保护控件、macOS 对齐。",
    ],
  },
  {
    version: "0.2.8",
    date: "2026-07-29",
    highlights: [
      "更新提示与设置页现可打开完整的本地化发布说明。",
      "工作面板展开与收起动画更加顺滑。",
      "长对话可更可靠地压缩超大工具结果批次。",
    ],
  },
  {
    version: "0.2.7",
    date: "2026-07-28",
    highlights: [
      "助手 Markdown 回复可内联渲染图片、音频与视频。",
      "远程图片可正常显示（内容安全策略已更新）。",
      "媒体标记经消毒过滤，仅允许安全标签。",
    ],
  },
  {
    version: "0.2.6",
    date: "2026-07-28",
    highlights: [
      "在回合边界做上下文检查点压缩，长对话不再隐藏历史。",
      "会话切换更顺畅：缓存最近对话，并保持稳定过渡帧。",
      "停靠工具保持固定宽度，聊天区域在工作面板旁仍可读。",
      "项目菜单可在系统文件管理器中打开项目文件夹。",
      "输入框提示行不再显示品牌图标。",
    ],
  },
  {
    version: "0.2.5",
    date: "2026-07-28",
    highlights: [
      "工作面板导航重做，工具轨更清晰。",
      "窗口缩放感知面板布局，尺寸变化更可预期。",
      "流式渲染隔离，交互更跟手。",
      "具备推理能力的新会话默认使用最高思考级别。",
      "发送后对话列表保持贴在最新消息。",
    ],
  },
  {
    version: "0.2.4",
    date: "2026-07-28",
    highlights: [
      "输入框芯片的下行字母完整可见。",
      "更新 pi-ai，支持包括 Claude Opus 5 在内的新模型。",
    ],
  },
  {
    version: "0.2.3",
    date: "2026-07-28",
    highlights: [
      "界面文案改为更直白的用户语言（含多语言）。",
      "选中态、中文标签与悬停动效打磨。",
      "工作面板与设置页浅色表面细化。",
      "预发布安装现可发现更新的正式版 GitHub Release。",
    ],
  },
  {
    version: "0.2.2",
    date: "2026-07-27",
    highlights: [
      "插件市场支持官方远程目录与详情页。",
      "插件面板隔离，高风险 API 受权限门控。",
      "分区工具栏支持右键新建项目或会话。",
      "启动闪屏、更顺滑动效与 i18n 打磨。",
      "工作面板顶栏支持右键打开工具。",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-07-27",
    highlights: [
      "工作面板工具按会话保留。",
      "“审查更改”入口仅属于产生编辑的那次会话。",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-07-27",
    highlights: [
      "侧边栏区分项目与会话，任务状态更清晰。",
      "可分支或编辑助手回复；消息工具栏改为图标按钮。",
      "文件编辑成功后提供工作区审查入口。",
      "键盘快捷键映射，以及用于 DevTools 的开发者模式。",
      "以 pi 模型目录作为提供商模型的权威来源。",
      "思考级别控件放在输入区模式旁。",
    ],
  },
  {
    version: "0.1.1",
    date: "2026-07-26",
    highlights: [
      "首次公开发布：本地优先的 AI 编程助手桌面客户端。",
      "Chat / Agent 模式，支持流式回复、思考级别与模型管理。",
      "工作区工具含权限确认、终端、浏览器与 Git 审查。",
      "Rust 宿主负责存储、密钥、会话与通知。",
      "插件基础能力，界面支持 English / 简体中文。",
      "可检查 GitHub Releases 更新（支持的平台可应用内更新）。",
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
