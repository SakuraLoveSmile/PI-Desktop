# 06. 桌面发布手册

> **翻译说明：** 本页是与 [英文源规格](/spec/06-delivery/06-release-runbook) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


> 范围：macOS arm64、Windows x64 和 Linux x64 的 D126 标记工件；
> macOS signing/notarization 保留下面的详细资格通道。
> 交叉引用：[里程碑](/zh-CN/spec/06-delivery/01-mvp-milestones) · [进程模型](/zh-CN/spec/03-runtime/07-process-model) · [安全性](/zh-CN/spec/05-security/01-security)

## 1. 修建车道

| 巷 | 命令 | 签约 | 使用 |
|---|---|---|---|
| 开发者 | `pnpm dev` | 无 | 日常发展 |
| 本地套餐 | `pnpm --filter @pi-desktop/desktop pack` | 未签名（`identity: null`） | 包装烟雾（`--dir` 输出） |
| 局部DMG | `pnpm --filter @pi-desktop/desktop dist` | 未签名 | 本地安装测试 |
| 发布 | `scripts/release-macos.sh` | 开发者 ID + 可选公证 | 可分发的工件 |

静态电子构建器配置保持未签名友好（`identity: null`）
因此没有证书的贡献者可以随时打包。发布脚本
在构建时通过 `-c.mac.identity` 注入真实身份。

在 macOS 上，`pnpm dev` 创建并重用带有指纹的品牌 Electron 主机
捆绑在 `.cache/electron-dev/` 下。它的包名称、可执行文件、标识符、
和 ICNS 资源是仅用于开发的 PI-Desktop 值，因此 AppKit 显示
应用程序菜单中的 PI-Desktop 并使用本机中的规范图标
关于面板。运行时还将 `build/icon_1024.png` 应用于 Dock。库存
`node_modules` 下的文件永远不会被修改。 Windows/Linux 不断发展
正常的 electro-vite 可执行文件。尽管如此，Windows Main 还是注册了
之前 NSIS 包使用的相同 `com.pi-desktop.app` AppUserModelID
Electron 准备就绪，防止库存主机身份拥有本机
通知或任务栏组。 Windows 封装另外引脚
`PI-Desktop` 可执行文件和“开始”菜单快捷方式名称。启动器设置
`PI_DESKTOP_DEV=1` 因此运行时打包检查会禁用更新传送
并保留开发人员工作区默认值，尽管有品牌可执行文件名称。
打包车道使用
`build/icon.icns`通过电子构建器，渲染器导入相同的
PNG 通过 `BrandLogo`。 PNG 是规范的；
`scripts/make-icon.py` 在每个上派生出 512px Windows/Linux 包 PNG
平台和 iconset/ICNS（当 macOS `iconutil` 可用时），无需
覆盖规范来源。

## 2. 先决条件（发布通道）

1. Apple 开发者帐户，具有 **开发者 ID 应用程序** 证书
   登录钥匙串。
2、环境变量：
   - `MAC_SIGNING_IDENTITY` — 例如`Developer ID Application: <Name> (<TEAMID>)`
   - `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` — 仅必需
     办理公证；该脚本在没有它们的情况下构建签名但未公证的。
3. 安装 Rust 工具链 (arm64) 和 pnpm 工作区。

## 3. 构建内容

- Electron 应用程序具有强化的运行时 + 权利
  (`build/entitlements.mac.plist`: JIT + 无符号可执行内存 +
  库验证禁用 — 标准 Electron 设置）。
- `Resources/bin/pi-desktop-host-core` — Rust 主机二进制文件（发布版本）。
- `Resources/agent-runtime/` — 捆绑的 sidecar，执行
  `ELECTRON_RUN_AS_NODE=1`（未发货单独的 Node）。
- `Resources/licenses/` — 通知必须在以下情况下保持可分发：
  相应依赖项的仅构建源树被修剪。
- `Resources/app.asar` — Electron Main、preload、渲染器输出以及仅
  运行时解析的生产模块。 Renderer 库已存在
  在 Vite 输出中，并且不会再次复制为原始包树。
- `app.asar.unpacked` 下的目标原生 `node-pty` 资产；其他平台和
当包布局支持时，架构预构建被排除
  可靠的目标过滤器。
- Chromium 语言环境包仅适用于英语和简体中文。产品展示
  `en`/`zh-CN` 目录保持捆绑状态，独立于 Chromium 区域设置。
- 应用程序图标 `build/icon.icns`（源自规范 `build/icon_1024.png`，作者：
  `scripts/make-icon.py`）。

## 4. 发布步骤

### 4. 1 强制应用内变更日志门 (D164)

**每个提升稳定应用程序版本并削减标签的产品版本都必须
首先更新双区域设置应用内产品变更日志。** 标记稳定版
版本中没有匹配的 EN + zh-CN 条目
`packages/shared/src/changelog.ts` 是**发布过程失败**：已打包
如果没有网络获取，构建无法显示“新增内容”，并且 GitHub
自动生成的发布体**不是**替代品（扩展 D120 /
ADR 0022）。

封锁步骤：

1. **之前**编辑 `packages/shared/src/changelog.ts`
   `node scripts/release.mjs <version>` / `git tag`：
   - 在 `en` 和 `zh-CN` 下添加 **最新优先** 条目。
   - 相同的 `version` 字符串（semver **没有** 前导 `v`，匹配
     `apps/desktop` / `APP_VERSION`）。
   - 可选 ISO `date` (`YYYY-MM-DD`)。
   - 匹配亮点计数；英语是真理的来源（ADR 0009）。
   - 每个项目符号都是一个简短的面向用户的想法（不是原始的公关标题）。
2. **不要**对仅预发布版本 (`x.y.z-rc.*`) 进行编录，除非产品
   明确发布该频道的应用内注释。
3. 运行 `pnpm --filter @pi-desktop/shared test` 并确认目录对齐
   （版本集+亮点计数）仍然通过。
4. 提交目录更新，以便标记的提交包含该更新的注释
   版本（单独或与版本凹凸相邻）。
5. GitHub 发布机构仍可能使用 `generate_release_notes: true`
   网页；它们仍然仅限于网络，并且**不是**应用内注释源。

预标记清单：

- [ ] `packages/shared/src/changelog.ts` 具有该版本的 EN + zh-CN 条目
      即将被标记
- [ ] 突出显示跨区域设置匹配的计数
- [ ] 共享变更日志测试通过
- [ ] `release.mjs` / 标记仅在目录提交发布后运行
      分行

### 4. 2 构建/打包

```bash
export MAC_SIGNING_IDENTITY="Developer ID Application: ... (TEAMID)"
export APPLE_ID=...
export APPLE_APP_SPECIFIC_PASSWORD=...
export APPLE_TEAM_ID=...
scripts/release-macos.sh
```

工件落在 `apps/desktop/release/`（DMG + 块图）中。

### 4. 3 GitHub 标签工作流程

GitHub Release 工作流程启动所有本机平台运行程序，无需
单独的验证作业障碍。每个跑步者都会验证推送的标签
结账后、打包前立即匹配 `apps/desktop/package.json`
输入已准备好。

在每个平台上，发布准备步骤都会启动锁定的 Rust 主机
与 pnpm 安装和本机依赖项重建并行构建。它
然后仅构建由选择的工作区依赖项
`@pi-desktop/desktop^...`，如果该依赖项选择意外则失败
空的。平台 `dist:*` 命令仍然负责捆绑代理
运行时，验证主机构建，构建一次桌面应用程序，以及
调用电子构建器。这避免了多余的桌面构建，而无需
更改包脚本或发布工件。

DMG、ZIP、NSIS、AppImage、deb、块图和更新程序提要输出已
压缩或压缩不敏感。因此，工作流程会上传它们的
发布作业之前压缩级别为零的临时操作工件
组装 GitHub 版本。

## 5. 验证门

每次发布版本后运行：

```bash
APP="apps/desktop/release/mac-arm64/PI-Desktop.app"
codesign -dv --verbose=2 "$APP"          # identity + hardened runtime flags
codesign --verify --deep --strict "$APP" # signature integrity
spctl -a -vv "$APP"                      # Gatekeeper assessment (notarized builds)
xcrun stapler validate "$APP"            # notarization staple (if notarized)
```

### 5. 1 封装封装门

在发布之前检查每个本机运行程序包并记录所有内容
压缩工件格式、解压应用程序、ASAR、Electron
framework/runtime、区域设置和未打包的本机大小。将它们与
之前的稳定版本；原因不明的增加超过 15% 阻止发表
直至审核。

包裹库存必须确认：

- 正好一个 `Resources/agent-runtime/sidecar.js` 和一个目标本机 Rust
  主机二进制文件
- 没有原始渲染器包，例如 Mermaid、Shiki、React、KaTeX 或 Lucide
  封装后的 `node_modules`
- 无依赖性 `*.map`、测试、示例、声明或第二个代理运行时
ASAR 中的树
- 所需的第三方许可和通知文件保留在 ASAR 中或
  `Resources/licenses` 当其非运行时包树被修剪时
- 仅配置的英语和简体中文 Chromium 语言环境包
- 可加载的目标本地 `node-pty` 二进制文件，并且没有可靠的排他性
  非目标预构建

第一个经过审核的优化包建立了平台基线。保留
针对每个平台进行测量，而不是将一项预算应用于不同的平台
Electron 目标布局。

第一个 macOS arm64 基线于 2026 年 7 月 30 日从未签名的
`electron-builder --dir` 包。大小低于常规文件字节总和，因此它们
跨文件系统保持可比性；压缩的工件不是
适用于此仅目录验证构建。

| 库存 | 字节 | 米布 |
|---|---:|---:|
| 解压后的应用程序 | 251,724,810 | 240.1 |
| `Contents/Frameworks` | 218,567,792 | 208.4 |
| `Contents/Resources` | 33,102,807 | 31.6 |
| `Resources/app.asar` | 20,944,962 | 20.0 |
| `Resources/app.asar.unpacked` 本机负载 | 137,336 | 0.1 |
| 英语和简体中文 Chromium 语言环境包 | 1,033,673 | 1.0 |
| Agent sidecar | 3,258,983 | 3.1 |
| Rust 主机 | 7,160,000 | 6.8 |

优化前解压的常规文件总数为 559,355,716 字节
(533.4 MiB)。审计后的包小了 307,630,906 字节，减少了 55.0%
减少。其策划的渲染器输出为 14.1 MiB，低于 20.5 MiB。

在干净的轮廓上手动烟雾 (`PI_DESKTOP_DATA_DIR=$(mktemp -d)`)：

1. `pnpm dev` 与 `PI-Desktop` 一起在 macOS 应用程序菜单中启动，
   Dock 和本机“关于”面板中的规范图标；没有 Electron 品牌
   可见。
2. 应用程序从 DMG 安装启动，出现窗口，然后出现应用程序菜单，
   关于面板和 Dock 品牌与开发路线相匹配。
3. 空首页和 expanded/collapsed 侧边栏显示规范的 PI-Desktop
   标志；输入框提示行没有领先的品牌图标；新任务和
project/Temporary 使用消息加会话图标创建控件。
4. 出现新手引导清单；配置提供商；一轮流式聊天。
5. 一种授权工具调用（写入）允许 + 拒绝路径。
6. Quit/relaunch → 恢复会话历史记录，恢复窗口边界。
7. `~/.pi-desktop/logs/` 包含 `app/`、`host/` 下分类的 NDJSON、
   和 `agent/`；计时记录位于 `host/timing.log` 和
   `agent/timing.log`。
8. 禁用网络访问后，shell 仍然启动； English/Chinese
   切换、语法高亮、KaTeX、Mermaid fallback/rendering、终端、
   主机运行状况和 sidecar 运行状况继续使用打包的本地资产。

## 6. Windows/Linux 发布包

该存储库公开了用于本机运行程序构建的 `dist:win` 和 `dist:linux`。
每个打包命令首先运行 `build:host-release`，然后捆绑代理
运行时和 Electron 应用程序。 D126 标签工作流程发布这些输出及其
电子更新程序清单。在该目标操作系统上运行目标命令：

```text
Windows: pnpm --filter @pi-desktop/desktop dist:win
Linux:   pnpm --filter @pi-desktop/desktop dist:linux
```

Windows 软件包包括 `bin/pi-desktop-host-core.exe`； Linux 包括
`bin/pi-desktop-host-core`。 `node-pty` 还必须通过以下方式重建
原生运行器上的电子构建器。签名、回滚和安装程序
升级资质仍保持发布硬化工作；出版物本身是
在 D126 下有效。

Native-runner 输出矩阵：

- Windows x64：NSIS 安装程序
- Linux x64：AppImage 和 deb

每个本地跑步者身上都冒着贝壳烟：

1. 确认窗口中没有出现 File/Edit/View/Window/Help 菜单。
2. 验证 F10 和 Shift+F10 对焦点内容仍然可用。
3. 从焦点编辑器执行应用程序和编辑快捷方式。
4. 最小化、最大化、恢复和关闭自定义控件。
5. 使用 `PI_DESKTOP_START_MAXIMIZED=1` 重新启动；确认初始
   maximize/restore 字形与查询的本机状态匹配。
6. 验证未知的 menu/window IPC 操作在窗口打开和关闭时失败。

## 7. 已知限制

- macOS 和 Linux deb 仍保持通知和链接更新模式。
- 签名的应用内 macOS 交付、回滚、分阶段部署和预发布
  渠道政策仍保持公开发布工作。
