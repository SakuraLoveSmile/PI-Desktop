<div align="center">

<img src="docs/image/readme/logo.png" alt="PI-Desktop logo" width="120" />

# PI-Desktop

**本地优先的 AI 编程智能体桌面应用。**

自带模型，代码、密钥与会话全部留在你自己的电脑上。

[![Release](https://img.shields.io/github/v/release/vastsa/PI-Desktop?include_prereleases&label=release)](https://github.com/vastsa/PI-Desktop/releases/latest)
[![CI](https://github.com/vastsa/PI-Desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/vastsa/PI-Desktop/actions/workflows/ci.yml)
![Platforms](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-4c8dd8)

[下载](#下载) · [快速上手](#快速上手) · [功能亮点](#功能亮点) · [工作原理](#工作原理) · [参与开发](#参与开发) · [English](README.md)

<br/>

<img src="docs/image/readme/home.webp" alt="PI-Desktop 主页 — 选择任务开始" width="88%" />

</div>

## PI-Desktop 是什么？

PI-Desktop 把 AI 编程智能体装进原生桌面应用：打开一个项目，说出你想做的事——探索并理解代码、构建新功能、审查代码、修复问题——然后看着它干活。每一次文件修改、每一条 shell 命令都会摆到你面前，由你批准。

不需要注册账号，没有订阅，中间也没有任何云服务：接上你已经在用的模型服务商即可，其余的一切——会话、设置、API 密钥——都保存在本地。

## 功能亮点

- **任意模型，自带密钥。** Anthropic、OpenAI，或任何兼容 OpenAI API 的服务——托管中转站可以，Ollama、LM Studio 这类本地网关也可以。模型 ID 自由填写（没有硬编码白名单），并支持按模型配置上下文窗口、输出上限、温度和思考模式。
- **智能体与规划两种模式。** 智能体模式可以读写文件、执行命令，把事情做完；规划模式让同一个智能体在宿主权威的规划状态中检查项目，禁止文件修改和插件工具，并在实施前提交不可变检查点供你明确批准。
- **每一次改动都由你批准。** 文件写入和 shell 命令先询问再执行，支持会话级授权和可配置的默认策略；超时未回应一律拒绝。
- **真正的工作台。** 在侧边工作面板中以 diff 形式审阅智能体的改动、打开终端、用浏览器预览、浏览项目文件——全程不用离开对话。
- **项目与会话。** 侧边栏按项目组织会话，支持多项目、置顶、归档、排序，还有用完即弃的临时会话。
- **本地优先，注重隐私。** 会话记录以 JSONL 纯文本存盘并配 SQLite 索引，随时备份、检索或删除；API 密钥存入系统钥匙串；日志只留在本地，没有任何遥测上报。
- **插件扩展。** 安装 `.piplug` 插件包（或在开发模式加载本地目录），为应用添加命令、面板、智能体工具和技能。插件独立进程运行，权限默认拒绝。
- **用得舒服。** 简体中文与 English 双语界面，浅色/深色/跟随系统主题，命令面板，新手引导清单，打包版本自动检查更新。

<table>
  <tr>
    <td width="50%"><img src="docs/image/readme/config_model.webp" alt="添加模型提供方 — API 风格、接口地址、模型 ID、密钥、思考模式" /></td>
    <td width="50%"><img src="docs/image/readme/config_base.webp" alt="基础设置 — 语言、主题、默认模式、权限模式" /></td>
  </tr>
  <tr>
    <td align="center"><sub>自带提供方 — 任何 OpenAI 兼容接口，密钥安全存入系统钥匙串</sub></td>
    <td align="center"><sub>语言、主题、默认模式，以及智能体必须遵守的权限策略</sub></td>
  </tr>
</table>

## 下载

前往 [Releases 页面](https://github.com/vastsa/PI-Desktop/releases/latest)获取最新版本。

| 平台 | 安装包 | 状态 |
|---|---|---|
| macOS（Apple Silicon） | `.dmg` | ✅ 随版本发布 |
| Windows（x64） | NSIS 安装程序 | 🚧 CI 已构建，安装包即将发布 |
| Linux（x64） | `.AppImage` / `.deb` | 🚧 CI 已构建，安装包即将发布 |

> **macOS 提示：** 当前构建尚未签名与公证。如果 macOS 拒绝打开应用，请右键点击应用选择**打开**，或清除隔离标记：
>
> ```bash
> xattr -cr /Applications/PI-Desktop.app
> ```

打包版本会检查 GitHub Releases 上的新版本，并在应用内显示更新横幅。

## 快速上手

1. **添加模型提供方。** 打开 **设置 → 模型配置 → 添加提供方**：选择 API 风格，填入接口地址和 API 密钥，再选择或输入模型 ID。密钥会存入系统钥匙串，保存后不再显示。
2. **打开项目。** 在侧边栏添加项目文件夹——会话、工具与权限都以项目为边界。
3. **描述任务。** 想直接实施就用智能体模式；希望先检查项目并审批实施方案时切换到规划模式。批准后的工作可在**审阅**面板里核对 diff，再决定是否提交。

## 工作原理

PI-Desktop 把特权操作隔离在 UI 进程之外：

- **Electron 外壳** — 沙箱化的 React 渲染进程，主进程只做轻量编排。
- **Rust 宿主核心** — 通过 stdio JSON-RPC 独占管理 SQLite、密钥、权限与工作区访问。
- **pi 智能体 sidecar** — 独立 Node 进程，运行 pi 引擎（`pi-ai` + `pi-agent-core`），承载真正的智能体循环。

完整设计见[架构规格](docs/spec/02-architecture/01-architecture.md)。

## 状态与路线图

PI-Desktop 处于活跃开发中的早期预览阶段。已交付：应用外壳、流式智能体运行时、宿主权威的智能体/规划工作流、带权限系统的工作区工具、插件基础设施，以及带更新检查的跨平台打包。

接下来：macOS 签名与公证、Windows/Linux 安装包正式发布、插件市场协议。详见[里程碑](docs/spec/06-delivery/01-mvp-milestones.md)与[项目看板](docs/project/BOARD.md)。

## 参与开发

环境要求：Node.js（LTS）+ pnpm，以及 stable Rust 工具链。

```bash
# 构建 Rust 宿主核心
cargo build -p host-core

# 安装 JS 依赖并构建 packages + 应用
pnpm install
pnpm -r --if-present build

# 开发模式
pnpm dev

# 协议级 e2e 冒烟测试
PI_DESKTOP_TEST_API_KEY=... pnpm test:e2e

# 规划模式宿主验收（包含真实的 60 秒默认超时）
PI_DESKTOP_E2E_LONG_TIMEOUT=1 pnpm test:e2e:plan

# 通过 Electron CDP 验收英文与简体中文规划界面
pnpm test:e2e:plan-ui
```

CI 会在每个 PR 上运行 JS 构建 / 类型检查 / lint / 单元测试及 `cargo test`。发布通过打 tag 完成：

```bash
node scripts/release.mjs 0.2.0 --tag   # 升版本 + 提交 + 打 v0.2.0 标签
git push origin main v0.2.0            # Release 工作流自动构建并发布
```

### 文档

- [规格索引](docs/spec/README.md) — 从这里开始
- [基线决策](docs/spec/00-baseline.md)
- [架构](docs/spec/02-architecture/01-architecture.md)
- [插件系统](docs/spec/07-plugins/01-plugin-system.md)
- [ADR](docs/adr/) · [里程碑](docs/spec/06-delivery/01-mvp-milestones.md) · [智能体指南](AGENTS.md)

## 许可证

待定 — 将在首个正式版本发布前确定。
