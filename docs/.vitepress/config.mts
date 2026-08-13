import { defineConfig } from 'vitepress'

const enSidebar = {
  '/spec/': [
    {
      text: 'Start here',
      items: [
        { text: 'Spec overview', link: '/spec/README' },
        { text: 'Frozen baseline', link: '/spec/00-baseline' },
        { text: 'Product overview', link: '/spec/01-product/00-overview' },
      ],
    },
    {
      text: 'Product',
      items: [
        { text: 'Product & scope', link: '/spec/01-product/README' },
        { text: 'Product scope', link: '/spec/01-product/01-product-scope' },
        { text: 'Non-goals', link: '/spec/01-product/02-non-goals' },
      ],
    },
    {
      text: 'Architecture',
      items: [
        { text: 'Architecture & engineering', link: '/spec/02-architecture/README' },
        { text: 'System architecture', link: '/spec/02-architecture/01-architecture' },
        { text: 'Application stack', link: '/spec/02-architecture/02-tech-stack' },
        { text: 'Repository structure', link: '/spec/02-architecture/03-repo-structure' },
        { text: 'Documentation site', link: '/spec/02-architecture/04-documentation-site' },
      ],
    },
    {
      text: 'Runtime',
      collapsed: true,
      items: [
        { text: 'Runtime core', link: '/spec/03-runtime/README' },
        { text: 'IPC protocol', link: '/spec/03-runtime/01-ipc-protocol' },
        { text: 'Agent runtime', link: '/spec/03-runtime/02-agent-runtime' },
        { text: 'Tools & permissions', link: '/spec/03-runtime/03-tools-and-permissions' },
        { text: 'Rust host core', link: '/spec/03-runtime/05-host-core-rust' },
        { text: 'Host RPC protocol', link: '/spec/03-runtime/06-host-rpc-protocol' },
        { text: 'Provider & model system', link: '/spec/03-runtime/11-provider-model-system' },
      ],
    },
    {
      text: 'Experience & security',
      collapsed: true,
      items: [
        { text: 'UX', link: '/spec/04-ux/README' },
        { text: 'Information architecture', link: '/spec/04-ux/01-ui-ia' },
        { text: 'Internationalization', link: '/spec/04-ux/02-i18n-english-first' },
        { text: 'UI design system', link: '/spec/04-ux/07-ui-design-system' },
        { text: 'Security', link: '/spec/05-security/README' },
        { text: 'Security model', link: '/spec/05-security/01-security' },
      ],
    },
    {
      text: 'Delivery',
      collapsed: true,
      items: [
        { text: 'Delivery & acceptance', link: '/spec/06-delivery/README' },
        { text: 'MVP milestones', link: '/spec/06-delivery/01-mvp-milestones' },
        { text: 'Acceptance criteria', link: '/spec/06-delivery/02-acceptance-criteria' },
        { text: 'E2E test plan', link: '/spec/06-delivery/04-e2e-test-plan' },
        { text: 'Change checklist', link: '/spec/06-delivery/05-change-checklist' },
        { text: 'Release runbook', link: '/spec/06-delivery/06-release-runbook' },
      ],
    },
    {
      text: 'Plugins',
      collapsed: true,
      items: [
        { text: 'Plugin system', link: '/spec/07-plugins/README' },
        { text: 'Plugin authoring', link: '/plugin-development' },
        { text: 'Manifest schema', link: '/spec/07-plugins/02-plugin-manifest-schema' },
        { text: 'Plugin API', link: '/spec/07-plugins/03-plugin-api' },
        { text: 'Security & lifecycle', link: '/spec/07-plugins/04-plugin-security' },
        { text: 'Developer experience', link: '/spec/07-plugins/10-plugin-devex' },
      ],
    },
    {
      text: 'Decisions & metadata',
      collapsed: true,
      items: [
        { text: 'Meta', link: '/spec/08-meta/README' },
        { text: 'Decisions log', link: '/spec/08-meta/decisions-log' },
        { text: 'Open questions', link: '/spec/08-meta/open-questions' },
      ],
    },
  ],
  '/adr/': [
    {
      text: 'Architecture decisions',
      items: [
        { text: 'ADR index', link: '/adr/README' },
        { text: 'Documentation site', link: '/adr/0079-vitepress-documentation-site' },
        { text: 'Latest decisions', link: '/spec/08-meta/decisions-log' },
      ],
    },
  ],
}

const zhSidebar = {
  '/zh-CN/spec/': [
    {
      text: '开始阅读',
      items: [
        { text: '规格总览', link: '/zh-CN/spec/' },
        { text: '冻结基线', link: '/spec/00-baseline' },
        { text: '产品概览', link: '/spec/01-product/00-overview' },
      ],
    },
    {
      text: '产品',
      items: [
        { text: '产品与范围', link: '/zh-CN/spec/product/' },
        { text: '产品范围', link: '/spec/01-product/01-product-scope' },
        { text: '非目标', link: '/spec/01-product/02-non-goals' },
      ],
    },
    {
      text: '架构',
      items: [
        { text: '架构与工程', link: '/zh-CN/spec/architecture/' },
        { text: '系统架构', link: '/spec/02-architecture/01-architecture' },
        { text: '应用技术栈', link: '/spec/02-architecture/02-tech-stack' },
        { text: '仓库结构', link: '/spec/02-architecture/03-repo-structure' },
        { text: '文档站', link: '/spec/02-architecture/04-documentation-site' },
      ],
    },
    {
      text: '运行时',
      collapsed: true,
      items: [
        { text: '运行时核心', link: '/zh-CN/spec/runtime/' },
        { text: 'IPC 协议', link: '/spec/03-runtime/01-ipc-protocol' },
        { text: 'Agent 运行时', link: '/spec/03-runtime/02-agent-runtime' },
        { text: '工具与权限', link: '/spec/03-runtime/03-tools-and-permissions' },
        { text: 'Rust host core', link: '/spec/03-runtime/05-host-core-rust' },
        { text: 'Host RPC 协议', link: '/spec/03-runtime/06-host-rpc-protocol' },
        { text: 'Provider 与模型', link: '/spec/03-runtime/11-provider-model-system' },
      ],
    },
    {
      text: '体验与安全',
      collapsed: true,
      items: [
        { text: '用户体验', link: '/zh-CN/spec/ux/' },
        { text: '信息架构', link: '/spec/04-ux/01-ui-ia' },
        { text: '国际化', link: '/spec/04-ux/02-i18n-english-first' },
        { text: 'UI 设计系统', link: '/spec/04-ux/07-ui-design-system' },
        { text: '安全', link: '/zh-CN/spec/security/' },
        { text: '安全模型', link: '/spec/05-security/01-security' },
      ],
    },
    {
      text: '交付',
      collapsed: true,
      items: [
        { text: '交付与验收', link: '/zh-CN/spec/delivery/' },
        { text: 'MVP 里程碑', link: '/spec/06-delivery/01-mvp-milestones' },
        { text: '验收标准', link: '/spec/06-delivery/02-acceptance-criteria' },
        { text: 'E2E 测试计划', link: '/spec/06-delivery/04-e2e-test-plan' },
        { text: '变更清单', link: '/spec/06-delivery/05-change-checklist' },
        { text: '发布手册', link: '/spec/06-delivery/06-release-runbook' },
      ],
    },
    {
      text: '插件',
      collapsed: true,
      items: [
        { text: '插件系统', link: '/zh-CN/spec/plugins/' },
        { text: '插件开发', link: '/plugin-development' },
        { text: 'Manifest schema', link: '/spec/07-plugins/02-plugin-manifest-schema' },
        { text: '插件 API', link: '/spec/07-plugins/03-plugin-api' },
        { text: '安全与生命周期', link: '/spec/07-plugins/04-plugin-security' },
        { text: '开发体验', link: '/spec/07-plugins/10-plugin-devex' },
      ],
    },
    {
      text: '决策与元数据',
      collapsed: true,
      items: [
        { text: '元数据', link: '/zh-CN/spec/meta/' },
        { text: '决策日志', link: '/spec/08-meta/decisions-log' },
        { text: '开放问题', link: '/spec/08-meta/open-questions' },
      ],
    },
  ],
  '/zh-CN/adr/': [
    {
      text: '架构决策记录',
      items: [
        { text: 'ADR 索引', link: '/zh-CN/adr/' },
        { text: '文档站决策', link: '/adr/0079-vitepress-documentation-site' },
        { text: '最新决策', link: '/spec/08-meta/decisions-log' },
      ],
    },
  ],
}

const enNav = [
  { text: 'Guide', link: '/guide/' },
  { text: 'Specs', link: '/spec/README' },
  { text: 'ADRs', link: '/adr/README' },
  { text: 'Plugin guide', link: '/plugin-development' },
  { text: 'GitHub', link: 'https://github.com/vastsa/PI-Desktop' },
]

const zhNav = [
  { text: '快速开始', link: '/zh-CN/guide/' },
  { text: '规格', link: '/zh-CN/spec/' },
  { text: 'ADR', link: '/zh-CN/adr/' },
  { text: '插件开发', link: '/plugin-development' },
  { text: 'GitHub', link: 'https://github.com/vastsa/PI-Desktop' },
]

export default defineConfig({
  title: 'PI-Desktop',
  description: 'Local-first AI coding agent documentation',
  appearance: true,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap' }],
  ],
  locales: {
    root: { label: 'English', lang: 'en' },
    'zh-CN': {
      label: '简体中文',
      lang: 'zh-CN',
      title: 'PI-Desktop 文档',
      description: '本地优先的 AI 编程代理文档',
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
        outline: { level: 'deep', label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        footer: { message: '为本地优先开发而构建。', copyright: 'Copyright © 2026 PI-Desktop 贡献者' },
      },
    },
  },
  markdown: {
    html: false,
    lineNumbers: true,
    theme: { light: 'github-light', dark: 'github-dark' },
  },
  themeConfig: {
    logo: '/brand-mark.svg',
    siteTitle: 'PI-Desktop',
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/vastsa/PI-Desktop' }],
    editLink: { pattern: 'https://github.com/vastsa/PI-Desktop/edit/main/docs/:path' },
    outline: { level: 'deep', label: 'On this page' },
    docFooter: { prev: 'Previous', next: 'Next' },
    footer: { message: 'Built for local-first development.', copyright: 'Copyright © 2026 PI-Desktop contributors' },
    nav: enNav,
    sidebar: enSidebar,
  },
})
