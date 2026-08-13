import { defineConfig } from 'vitepress'

const enSidebar = {
  '/spec/': [
    {
      text: 'Foundation',
      items: [
        { text: 'Spec overview', link: '/spec/README' },
        { text: 'Baseline', link: '/spec/00-baseline' },
        { text: 'Product overview', link: '/spec/01-product/00-overview' },
        { text: 'Product scope', link: '/spec/01-product/01-product-scope' },
        { text: 'Non-goals', link: '/spec/01-product/02-non-goals' },
      ],
    },
    {
      text: 'Architecture',
      items: [
        { text: 'System architecture', link: '/spec/02-architecture/01-architecture' },
        { text: 'Application stack', link: '/spec/02-architecture/02-tech-stack' },
        { text: 'Documentation site', link: '/spec/02-architecture/04-documentation-site' },
        { text: 'Repository structure', link: '/spec/02-architecture/03-repo-structure' },
      ],
    },
    {
      text: 'Runtime',
      collapsed: true,
      items: [
        { text: 'IPC protocol', link: '/spec/03-runtime/01-ipc-protocol' },
        { text: 'Agent runtime', link: '/spec/03-runtime/02-agent-runtime' },
        { text: 'Tools & permissions', link: '/spec/03-runtime/03-tools-and-permissions' },
        { text: 'Rust host core', link: '/spec/03-runtime/05-host-core-rust' },
        { text: 'Host RPC protocol', link: '/spec/03-runtime/06-host-rpc-protocol' },
        { text: 'Provider & model system', link: '/spec/03-runtime/11-provider-model-system' },
        { text: 'Error codes', link: '/spec/03-runtime/08-error-codes' },
      ],
    },
    {
      text: 'Experience',
      collapsed: true,
      items: [
        { text: 'Information architecture', link: '/spec/04-ux/01-ui-ia' },
        { text: 'Internationalization', link: '/spec/04-ux/02-i18n-english-first' },
        { text: 'UI design system', link: '/spec/04-ux/07-ui-design-system' },
        { text: 'Component spec', link: '/spec/04-ux/08-component-spec' },
        { text: 'Interaction patterns', link: '/spec/04-ux/09-interaction-patterns' },
      ],
    },
    {
      text: 'Delivery & extensions',
      collapsed: true,
      items: [
        { text: 'Security', link: '/spec/05-security/01-security' },
        { text: 'Milestones', link: '/spec/06-delivery/01-mvp-milestones' },
        { text: 'E2E test plan', link: '/spec/06-delivery/04-e2e-test-plan' },
        { text: 'AI development workflow', link: '/spec/06-delivery/03-ai-development-workflow' },
        { text: 'Plugin system', link: '/spec/07-plugins/01-plugin-system' },
        { text: 'Plugin authoring', link: '/plugin-development' },
        { text: 'Decisions log', link: '/spec/08-meta/decisions-log' },
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
        { text: '产品概览', link: '/spec/01-product/00-overview' },
        { text: '产品范围', link: '/spec/01-product/01-product-scope' },
        { text: '基线与冻结决策', link: '/spec/00-baseline' },
      ],
    },
    {
      text: '核心主题',
      items: [
        { text: '系统架构', link: '/spec/02-architecture/01-architecture' },
        { text: '运行时与协议', link: '/spec/03-runtime/01-ipc-protocol' },
        { text: '安全模型', link: '/spec/05-security/01-security' },
        { text: '插件系统', link: '/spec/07-plugins/01-plugin-system' },
        { text: 'E2E 测试计划', link: '/spec/06-delivery/04-e2e-test-plan' },
      ],
    },
  ],
  '/zh-CN/adr/': [
    {
      text: '架构决策记录',
      items: [
        { text: 'ADR 索引', link: '/zh-CN/adr/' },
        { text: 'VitePress 文档站', link: '/adr/0079-vitepress-documentation-site' },
        { text: '完整决策日志（英文）', link: '/spec/08-meta/decisions-log' },
      ],
    },
  ],
}

const enNav = [
  { text: 'Guide', link: '/guide/' },
  { text: 'Specs', link: '/spec/README' },
  { text: 'ADRs', link: '/adr/README' },
  { text: 'GitHub', link: 'https://github.com/vastsa/PI-Desktop' },
]

const zhNav = [
  { text: '快速开始', link: '/zh-CN/guide/' },
  { text: '规格', link: '/zh-CN/spec/' },
  { text: 'ADR', link: '/zh-CN/adr/' },
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
