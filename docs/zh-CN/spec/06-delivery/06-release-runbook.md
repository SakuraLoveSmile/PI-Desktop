# 06. 桌面发布手册

> Plus 更新源为 `SakuraLoveSmile/PI-Desktop`。签名身份与 Apple Team ID 必须显式配置，
> 不使用上游证书作为默认值。下文历史上游镜像自动化仍仅用于上游，未签名构建不代表已完成签名/公证。
> 打包元数据使用 `pi-desktop-plus`，更新缓存为独立的 `pi-desktop-plus-updater`。

> **翻译说明：** 本页是与 [英文源规格](/spec/06-delivery/06-release-runbook) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


> Current cloud release scope: macOS arm64 only for both manual candidates and
> formal tags. Intel macOS, Windows, Linux, and standalone pi-host release
> artifacts are not built by this workflow. Existing application and packaging
> support for those targets is unchanged; macOS signing/notarization remains the
> detailed qualification lane below.
> 交叉引用：[里程碑](/zh-CN/spec/06-delivery/01-mvp-milestones) · [进程模型](/zh-CN/spec/03-runtime/07-process-model) · [安全性](/zh-CN/spec/05-security/01-security)

## 1. 构建通道

安装包和 Release 包仅在 GitHub 托管的 Actions runner 中构建。
保留本地开发编译；安装包命令（包括 `pack --dir` 解包产物）及其包装器要求
`GITHUB_ACTIONS=true` 和 `RUNNER_ENVIRONMENT=github-hosted`。
自托管 runner 不属于打包通道，不得在本地设置这些值绕过检查。

| 通道 | 入口 | 签名 | 结果 |
|---|---|---|---|
| 开发 | `pnpm dev`、`pnpm build:js`、Cargo 开发命令 | 不要求 | 本地开发产物 |
| Cloud candidate | Manual `release.yml` dispatch | Unsigned by default; optional macOS signing | Verified macOS arm64 Actions bundle only |
| Formal release | Push `v<version>` after its preparation PR merges | macOS Developer ID + mandatory notarization | Verified, immutable GitHub Release with macOS arm64 assets only |

`scripts/release-macos.sh` 已退役，只输出云端操作提示并退出。
云端验证失败时，不存在本地安装包或发布兜底通道。

### 1.1 macOS 包使用独立身份的 Electron

所有云端 macOS 打包通道都使用独立组装的 Electron。
`scripts/package-macos-identity.mjs` 调用 `scripts/assemble-electron-dist.mjs`，
使用固定版本的官方框架编译 `apps/desktop/build/electron-main-stub.c`，
再把链接后的主程序换入该发行版的副本。随后带着
`-c.electronDist=<that copy>` 和
`-c.afterPack=scripts/macos-identity-gate.mjs` 调用 electron-builder。
若主程序的 `LC_UUID` 与官方 Electron 或 `PI_IDENTITY_REFERENCE` 相同、
应用标识或本地网络权限说明不正确、或缺少 host sidecar，门禁会使构建失败。
不能静默回退到官方发行版。

原因：electron-builder 只重命名 Electron 预编译主程序，而不重新链接。
Chromium 的 LLD 根据链接内容生成 `LC_UUID`，因此同一 Electron 版本的 fork
可能共享 UUID。macOS 将本地网络权限归属与代码签名和该 UUID 关联；共享 UUID
曾导致本应用没有权限弹窗、没有系统设置条目且局域网请求被丢弃
（ADR plus-independent-application-identity）。

macOS 打包因此需要可用的 `clang`。组装器离线使用固定依赖提供的
`node_modules/electron/dist`，不下载源码；必须先构建 Rust sidecar
（`pnpm run build:host-release`）。Windows/Linux 包装器保持原有参数转发。

macOS 的 `pnpm dev` 创建并复用 `.cache/electron-dev/` 下带指纹的品牌 Electron
宿主。包名、可执行文件、标识符和 ICNS 是仅用于开发的 Pi-Desktop-Plus 值。
应用菜单和原生关于面板使用产品身份；Dock 使用 `build/icon_1024.png`。
不会修改 `node_modules` 中的官方文件。Windows/Linux 开发继续使用普通
electron-vite 可执行文件。Windows Main 在 Electron 就绪前注册与 NSIS 相同的
`cn.sakura.pi-desktop` AppUserModelID；Windows 包固定产品可执行文件和快捷方式名。
启动器设置 `PI_DESKTOP_DEV=1`，禁用开发环境更新交付并保留开发工作区默认值。
Electron 43+ 首次 `pnpm dev` 按需下载 Electron 二进制，`pnpm install` 不再下载。
干净的云端 runner 在构建或 E2E 前显式获取该固定版本二进制。
未签名云端候选不请求安全时间戳；签名候选和正式发布必须使用公证所需时间戳。
打包使用 macOS `build/icon.icns` 和 Windows `build/icon.ico`；渲染器的
`BrandLogo` 使用相同规范 PNG。`scripts/make-icon.py` 从
`build/icon_1024.png` 生成多尺寸 ICO、512px Windows/Linux PNG、透明单色
`build/tray-icon-mac.png` 模板，以及可用时通过 `iconutil` 生成 iconset/ICNS。

## 2. 先决条件（发布通道）

1. 具有仓库 Actions 访问和候选构建触发权限；正式发布还需要版本标签推送授权。
2. 正式发布或签名候选配置 §4.6 的六个签名 Secret；证书和 TeamIdentifier
   属于本 fork 发布者，并与配置身份一致。
3. GitHub 托管的原生 runner，使用固定 Node/pnpm、Rust、Electron 和锁文件依赖。
   不使用本地产物作为发布输入。工作流检查架构并在相同 runner 上编译原生 host。

## 3. 构建内容

- Electron 应用程序具有强化的运行时 + 权利
  (`build/entitlements.mac.plist`: JIT + 无符号可执行内存 +
  库验证禁用 — 标准 Electron 设置），并在 Info.plist 中通过
  `apps/desktop/package.json` → `mac.extendInfo` 追加
  `NSLocalNetworkUsageDescription`，使 macOS 15+ 弹出本地网络授权，同时授予
  Chromium 主进程与 `ELECTRON_RUN_AS_NODE` 的 agent sidecar；否则主进程的
  Test Provider 能过，但 sidecar 走局域网请求会以 `EHOSTUNREACH` 失败
  （issue #573）。
- `Resources/bin/pi-desktop-host-core` — Rust 主机二进制文件（发布版本）。
- Windows NSIS 构建包含静态链接 MSVC CRT 的 x64
  `pi-desktop-host-core.exe`，因此全新的 Windows x64 或 Windows 11 ARM64
  （x64 模拟）安装无需在本地服务启动前单独安装 Visual C++ Redistributable。
- `Resources/agent-runtime/` — 捆绑的 sidecar，执行
  `ELECTRON_RUN_AS_NODE=1`（未发货单独的 Node）。
- `Resources/licenses/` — 通知必须在以下情况下保持可分发：
  相应依赖项的仅构建源树被修剪。
- `Resources/app.asar` — Electron Main、preload、渲染器输出以及仅
  运行时解析的生产模块。 Renderer 库已存在
  在 Vite 输出中，并且不会再次复制为原始包树。
- Chromium 语言环境包适用于英语、简体中文、繁体中文和土耳其语。产品目录
  保持捆绑状态，独立于 Chromium 区域设置。
- 应用程序图标 `build/icon.icns` 和 `build/icon.ico`（源自规范
  `build/icon_1024.png`，由 `scripts/make-icon.py` 生成）。

## 4. 发布步骤

### 4.1 强制发布版本面门禁 (D164 + D260)

**每个提升稳定应用版本并打标签的产品发布，都必须先更新所有带版本号的位置：
双语应用内产品更新日志，以及项目文档中声明的版本号。** 如果任一位置仍在描述
旧版本就打稳定标签，属于**发布过程失败**：打包版本在没有网络请求时无法显示
“新增内容”，README 会宣传过期的版本线，而 GitHub 自动生成的发布正文
**不是**替代品（扩展 D120 / ADR 0022）。

门禁覆盖的位置：

| 位置 | 要求 |
|---|---|
| `packages/shared/src/plus-changelog.ts` | Plus 稳定版本说明按最新优先排列，英文和所有已发货语言一致；保留上游目录 |
| `packages/shared/src/changelog.ts` 和 `changelog-*.ts` | 合并目录跨语言保持一致；新增语言在此注册 |
| `packages/shared/src/changelog.test.ts` | 预期版本列表首项为新稳定版本 |
| `package.json`、`apps/*/package.json`、`docs/package.json` | 应用版本一致 |
| `packages/*/package.json` | 保留上游版本线；各包版本彼此一致（ADR plus-version-line） |
| Cargo 工作区版本、Cargo.lock host-core、protocol.ts APP_VERSION | 与应用版本一致 |
| `README.md`、`README.zh-CN.md` | 当前 `<major>.<minor>.x` 版本线，以及准确的产品与开发说明 |
| `apps/desktop/electron/main/settings-operation-metadata.json` | 通过发布文档门禁验证的元数据 |

阻塞性的准备步骤：

1. 在 `plus-changelog.ts` 中增加稳定版本的简短用户说明；所有已发货语言具有
   相同版本和亮点条数。`changelog.ts` 合并 Plus 与上游历史，不覆盖上游目录记录 Plus 发布。
2. `x.y.z-rc.1` 等预览版本记录对应稳定版本 `x.y.z`，不单列预发布标识。
   同步 `changelog.test.ts` 和两份 README。
3. 在独立请求分支运行 `node scripts/release.mjs <version>` 准备版本文件。
   该命令不提交、不构建安装包、不推送，也不刷新 models.dev。资源更新需显式审查；
   工作流原样打包标签树中的 models.dev 快照。
4. 在准备后的源码上通过 `node scripts/check-release-docs.mjs <stable-version>`
   和 shared 更新日志测试。检查器会在临时目录编译 TypeScript 更新日志。
   若准备检查必须在云端运行，可仅在准备阶段使用 `--skip-docs-check`；
   复用的云端 CI 文档门禁仍须在合并前通过，`--tag` 不接受此选项。
5. 在请求分支提交准备，经过 PR 和云端门禁合并到 `main`。
   GitHub 网页自动生成说明不能替代应用内更新日志。

### 4.2 云端候选构建

构建当前 `main` 候选：

```bash
gh workflow run release.yml --ref main -f sign_macos=false
```

合并前也可使用 `--ref <request-branch>`。预检固定完整的 40 位提交 SHA，
后续所有 job 检出相同提交。验证记录保留 run URL、source/base SHA、各 job
结论与最终工件标识。已排队或已触发不代表构建成功。

Manual dispatch defaults to `sign_macos=false`. Set it to `true` only with the
six signing secrets configured. Both variants run the same shared CI barriers,
the macOS arm64 build and asset aggregation. They produce
`release-bundle-<version>-<source-sha>` in Actions only: no GitHub Release is
created and no public updater feed is published. Unsigned artifacts are debug
candidates and do not establish Gatekeeper/notarization qualification.

### 4.3 正式标签和发布

版本准备 PR 合并后，在干净工作树检出准确的合并提交，然后执行：

```bash
node scripts/release.mjs <version> --tag
git push origin v<version>
```

标签模式验证文档，刷新 `origin/main`，确认干净的当前提交已包含于远端 main，
并确认标签在本地和远端均不存在。只创建附注标签，不修改版本文件或提交。
网络验证失败会阻止打标签，不得替换已有标签或手动给未合并分支打发布标签。
推送标签后启动 `.github/workflows/release.yml`。

正式预检拒绝标签与应用/Cargo/协议版本不一致、标签指向其他提交或源码不属于
新获取的 `origin/main`。稳定 SemVer 使用 `latest`；`alpha`、`beta`、`rc`
等预发布使用独立更新渠道，并设置 `prerelease=true`、`make_latest=false`。
非法版本或不安全渠道会失败。正式标签始终要求六个签名 Secret，缺失即尽早失败。
不能将未签名候选提升为正式 Release。

门禁顺序：

1. **元数据：** 固定 source SHA、版本、渠道、发布类型和签名策略；
   获取 main 时不改变候选检出。
2. **共享验证：** 在相同源码复用 `ci.yml`：JS 构建、类型、lint、架构、测试质量、
   单元测试、运行时测试类型、Rust fmt/clippy/test、隔离 smoke 和发布脚本行为测试。
   安装依赖后运行完整发布文档门禁。
3. **Native build:** build Desktop for macOS arm64 on `macos-15`. Fetch the
   pinned Electron binary on the clean runner. Packaging uses `--publish never`;
   only the final publication job may write a Release.
4. **Aggregate:** require exactly `dist-mac-arm64` with its DMG and ZIP, both
   blockmaps, and `<channel>-mac-arm64.yml`; reject missing, unexpected,
   duplicate or unsafe paths. Check updater version and actual SHA512/size, then
   emit the canonical `<channel>-mac.yml`, `release-manifest.json` and
   `SHA256SUMS`. The manifest records source repository/SHA, run URL/id/attempt,
   version, channel, kind, signing policy and every asset's name/size/SHA256.
5. **正式发布：** `scripts/publish-release.mjs` 重新验证工件和远端 tag/main 身份，
   创建草稿、上传全部资产、验证远端 SHA256 与大小后才公开。
   已公开 Release 不可变，不覆盖资产。失败草稿保留供检查；重试须匹配准确的
   source/manifest 身份，只复用相同资产，身份不符则阻塞，不自动删除或替换草稿。

The sole packaging lane uses native `macos-15` arm64 and verifies `uname -m`
before building the Rust host on the same runner. Signed lanes pin `CSC_NAME`
to the configured certificate common name,
强制应用签名和公证，独立对 DMG 公证/装订，上传前验证代码、身份、Gatekeeper
和两份票据（§4.6–§5）。正式标签不能跳过这些检查。


每次 builder 调用都显式接收预检给出的 `-c.publish.channel=<channel>`，
包括预发布；不单凭版本字符串推断更新源名称。签名 DMG 经公证和装订改变字节后，
`scripts/refresh-macos-release-metadata.mjs` 在验证和上传前重新生成外置 DMG
blockmap，并刷新该渠道 macOS 更新源中的 SHA512 和大小。
它使用已安装的 electron-builder blockmap 实现并显式指定外置输出，
同时验证生成 blockmap 不改变已签名 DMG 字节。聚合随后检查最终装订产物的哈希。

The macOS arm64 lane has explicit DMG/ZIP names (§6), including blockmaps, and
rejects unlabelled or wrong-architecture artifacts.
DMG 保持品牌 720×440 拖入 Applications 布局，仅显示应用和 Applications 链接。
ZIP 根目录包含 `Pi-Desktop-Plus.app`，两者都不附首次启动说明或可执行辅助脚本。

The current release workflow does not build Linux, Windows, Intel macOS or
standalone pi-host artifacts. Existing platform-specific packaging and update
behavior described below remains application capability documentation, not a
claim that those artifacts are present in current candidate bundles or releases.
The macOS arm64 input and final bundle inventory are checked by
`scripts/release-assets.mjs`, rather than inferred from a successful build job.

### 4.4 文档站部署

发布工作流不部署文档站。`docs/vercel.json` 已关闭 Vercel Git Deployments，
文档源码变化不会自动更新生产站，需要时在 Vercel 手动发起部署。

### 4.5 CNB 镜像触发

上游 GitHub Release 发布或更新后，
`.github/workflows/mirror-to-cnb.yml` 会启动 `aixk/Pi-Desktop` 上的 CNB
流水线。GitHub Release 仍是权威产物源；CNB 只是同一标签的副本，供从
https://cnb.cool/aixk/Pi-Desktop 拉取的用户使用。

该作业：

- 仅在 `vastsa/PI-Desktop` 上运行
- 在 `release` 的 `published` / `edited` 时触发，也可通过
  `workflow_dispatch` 传入明确标签（例如 `v0.14.6`）
- 发送事件 `api_trigger_mirror`，并把 `MIRROR_TAGS` 设为该标签
- 使用仓库密钥 `CNB_MIRROR_TOKEN`；密钥为空时失败退出
- 用 `jq` 构造 JSON，避免手动运行时标签缺失导致空的 `MIRROR_TAGS`

若 CNB 流水线幂等，对同一标签重跑是安全的。它不会重新构建桌面产物，
也不会改写 electron-updater 更新源。

### 4.6 GitHub Actions 中的 macOS 签名密钥

在 GitHub → 仓库 `SakuraLoveSmile/PI-Desktop` → Settings → Secrets and variables →
Actions 中创建下列密钥。不要把 p12、密码、Apple ID 或应用专用密码提交进仓库。
不要在 CI 中 `echo` 这些值。

| Secret | Value |
|---|---|
| `CSC_LINK` | 导出的 Developer ID Application `.p12`（证书+私钥）的 Base64。electron-builder 也接受文件路径，但 CI 使用 Secret 正文。 |
| `CSC_KEY_PASSWORD` | 导出该 `.p12` 时设置的密码 |
| `APPLE_ID` | 属于团队 `${APPLE_TEAM_ID}` 的 Apple ID 邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 来自 https://appleid.apple.com → Sign-In and Security → App-Specific Passwords 的应用专用密码 |
| `APPLE_TEAM_ID` | 本 fork 发布者的 Apple Developer 团队 ID，与签名证书一致 |
| `MAC_SIGNING_IDENTITY` | 本 fork 的 Developer ID Application 证书通用名，包含团队后缀 |

在本地把 p12 编成 base64（不要把输出贴到聊天或仓库）：

```bash
base64 -i developer-id-application.p12 | pbcopy
```

Linux 使用 `base64 -w0 developer-id-application.p12`。绝不能进入 git 的文件：
`*.p12`、`*.cer`、`*.p8`、`*.mobileprovision`。

### 4.7 macOS 签名可观测性与超时

`electron-builder` 在开始签名前只打印一行 —— `signing
file=release/mac-arm64/Pi-Desktop-Plus.app platform=darwin type=distribution
identityName=...` —— 之后直到该阶段结束都没有任何输出。这段时间里隐藏了三种机制，
现在 macOS 通道把它们全部暴露出来：

| 阶段位置 | 发生什么 | 现在如何可见 |
|---|---|---|
| 遍历 | `@electron/osx-sign` 遍历 `Pi-Desktop-Plus.app/Contents`，收集所有 Mach-O 文件以及嵌套的 `.app` 与 `.framework` 包 | `DEBUG=electron-osx-sign*` 打印 `Walking... <dir>`；`scripts/macos-bundle-inventory.mjs` 在打包结束后打印同一个包的数量 |
| 逐文件签名 | `codesign --force --sign <identity> --timestamp --entitlements ... <file>` 串行执行，最深的文件优先，应用包最后签 | `DEBUG=electron-osx-sign*` 打印 `Signing... <file>` 与 `Executing... <file> codesign ...`；codesign shim 记录每次调用的耗时。若钥匙串拒绝把私钥交给被包裹的 `codesign`，可设置 `PI_SIGNING_NO_CODESIGN_SHIM=1` 在不使用 shim 的情况下运行该阶段 |
| 静默重试 | 一轮签名失败后最多再重试三次，退避 5s/10s/15s，且没有任何日志行 | 看门狗汇总中的 `codesign-calls` 与 `failures` 行会暴露重复的整轮签名 |
| 应用公证 | `@electron/notarize` 打包 zip、上传并等待 Apple 队列（`mac.notarize=true`） | `DEBUG=electron-notarize*` 打印 `zipping application to`、`attempting to upload file to Apple`、`notarization success`，随后 electron-builder 打印 `notarization successful` |
| DMG 公证 | DMG 有自己的签名，因此下一步会用 `xcrun notarytool submit --wait` 再提交一次 | 同一个看门狗让该等待过程可见并且有上限 |

`scripts/macos-signing-watchdog.mjs` 包裹这两个长时间阶段。它给子进程的每一行加上
`[sign] ` 前缀后转发，并保留子进程退出码，因此通道的失败语义不变；stdout 与 stderr 作为
两条独立流转发，二者相对顺序可能与直接运行不同，子进程也不会获得 stdin。子进程静默时它打印心跳
（已用时间、阶段、最后处理的文件、当前活动的 codesign 目标）；当阶段在
`PI_SIGNING_STALL_SECONDS` 内既无输出也无 codesign 活动时，它输出一次诊断（最后处理的
文件、签名相关进程的 `ps` 状态、codesign 日志尾部）；并在 `[sign] summary` 块中给出逐文件
codesign 耗时 —— 调用次数、总耗时、p50、p95、最大值以及最慢的几个文件。可调项：

| 设置 | 默认值 | 作用 |
|---|---|---|
| `PI_SIGNING_TIMEOUT_SECONDS` | 2400（CI：打包 1800，DMG 1200） | 被包裹阶段的硬上限：输出诊断、杀掉进程组，并以 124 退出而不是继续挂起 |
| `PI_SIGNING_STALL_SECONDS` | 300 | 无 codesign 活动的静默持续这么长时间就触发一次诊断输出；阶段继续运行，因为等待 Apple 公证队列是合法等待 |
| `PI_SIGNING_HEARTBEAT_SECONDS` | 60 | 子进程无输出时的心跳间隔 |
| `DEBUG` | `electron-osx-sign*,electron-notarize*` | 暴露遍历、逐文件签名与公证进度的命名空间 |

`DEBUG` 只列出两个会自行清洗命令行的命名空间，因为 `electron-builder` 的命名空间在这里
并不安全：builder-util 打印每条外部命令时所用的敏感词表并不覆盖
`security set-key-partition-list -k <p12 密码>`。在此之上，看门狗会把
`CSC_KEY_PASSWORD`、`APPLE_APP_SPECIFIC_PASSWORD` 的取值（不限长度）、`CSC_LINK` 与
`APPLE_ID` 的取值，以及任何 `--password` 或 `-k` 参数替换为 `[redacted]` —— 包括诊断
输出（进程视图只打印 `comm`，绝不打印 `argv`）与汇总（只有计数与已脱敏的目标路径）。
GitHub 本身也会屏蔽所有来自 secret 的值。

在维护者机器上实测：一个 macOS arm64 包需要 93 次 `codesign` 调用（91 次签名、
1 次校验、1 次 entitlement 显示），`codesign` 墙钟时间约 49s；其中只有 16 个文件是 Mach-O
代码、5 个是嵌套包。`@electron/osx-sign` 还会给二进制资源签名 —— 33 个 `.pak`，以及
`.nib`、`.dat`、`.bin`、`.png`、`.icns`、`app.asar` —— 因为它的遍历会选中所有"看起来是
二进制"的文件，而不只是 Mach-O。用 `mac.signIgnore` 精确排除这些数据文件可以去掉约四分之三
的调用，但这会改变发布工件所携带的内容，且需要一次真实公证发布来验证，因此这里有意不启用。

`scripts/macos-signing-diagnostics.sh` 在证书导入之前记录 runner 基线：系统版本、
`codesign --version`、钥匙串身份/列表/默认钥匙串、`xcrun --find notarytool`，以及
`http://timestamp.apple.com/ts01` 的可达性与延迟。此时 Developer ID 身份理应不存在，
因为 electron-builder 在打包过程中才从 `CSC_LINK` 导入；只有 `--require-identity`
才会在缺少身份时判定失败。

签名器现状：`@electron/osx-sign@1.3.3` 由 `app-builder-lib@26.15.3` 精确锁定，且没有任何
override 作用于它。它的 `signApplication()` 对每个文件 `await` 一次 `codesign`；没有批量或
并行路径，也没有任何选项或环境变量可以开启并发。因此更快的签名器只能通过 `mac.sign`
替换钩子实现，那是重写而不是配置开关；所以该通道继续使用锁定的签名器并保留上述诊断。

## 5. 验证门

未签名调试产物（`workflow_dispatch` 且 `sign_macos: false`）不视为通过 Gatekeeper。标签发布必须通过以下签名、公证和装订检查，否则工作流失败。

存在两次独立的公证提交，因为 Apple 每次公证一个工件，而 electron-builder 只覆盖应用：

| 工件 | 提交方 | 票据 |
|---|---|---|
| `Pi-Desktop-Plus.app`（ZIP 内） | electron-builder `-c.mac.notarize=true` | 由 electron-builder 装订 |
| `Pi-Desktop-Plus-<version>-<arch>.dmg` | `scripts/notarize-and-staple-macos-release-dmg.sh`（`notarytool submit --wait`） | 同一脚本在 `status: Accepted` 后装订 |

从未提交过的 DMG 没有票据，因此装订会失败并报 `Could not find base64 encoded ticket ... Error 65`。只有在 Apple 返回 `Accepted` 之后才允许重试装订。

GitHub 托管 runner 每次完成签名构建后执行以下验证：

```bash
for APP in apps/desktop/release/mac-*/Pi-Desktop-Plus.app; do
  codesign -dv --verbose=4 "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
  spctl --assess --type execute --verbose=4 "$APP"
  xcrun stapler validate "$APP"
done
xcrun stapler validate apps/desktop/release/*.dmg
```

当提交未被接受时，Release 工作流会自动打印 Apple 公证日志；手动查看方式：

```bash
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID"
```

### 5.1 安装包体积门禁

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
- 仅配置的英语、简体中文、繁体中文和土耳其语 Chromium 语言环境包

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
| 历史英语和简体中文 Chromium 语言环境包基线 | 1,033,673 | 1.0 |
| Agent sidecar | 3,258,983 | 3.1 |
| Rust 主机 | 7,160,000 | 6.8 |

优化前解压的常规文件总数为 559,355,716 字节
(533.4 MiB)。审计后的包小了 307,630,906 字节，减少了 55.0%
减少。其策划的渲染器输出为 14.1 MiB，低于 20.5 MiB。

#### 渲染器产物预算

渲染器包有三项长期控制。其中任意一项回退，都会在上面的表格中表现为渲染器
体积增长，并且必须在发布前给出解释：

- **压缩是显式开启的。** `electron-vite` 对渲染器预设硬性默认
  `minify: false`（与原生 Vite 不同），因此
  `apps/desktop/electron.vite.config.ts` 设置了 `minify: "esbuild"`。移除它会
  让产出的 JS 体积悄然翻倍。
- **旧字体格式被剔除。** `pi-drop-legacy-font-fallbacks` 插件会在 Vite 把
  `woff` 与 `truetype` 的 `src` 条目注册为资源之前移除它们。随包的 Chromium
  普遍支持 `woff2`，这些字形只会被产出而永远不会被使用。
- **品牌标识按渲染器尺寸提供。** `src/assets/brand/logo-{light,dark}.png` 是
  渲染器资源；`build/icon_1024.png` 与 `build/logo_dark.png` 是
  electron-builder 的安装包图标，渲染器不得引用。

应用这三项控制后于 2026-08-26 测得的渲染器产物，对照同一棵树在 `v0.10.8`
的状态：

| 渲染器分组 | 之前 | 之后 |
|---|---:|---:|
| JavaScript（120 个 chunk） | 12.53 MiB | 7.72 MiB |
| `woff2` | 15.71 MiB | 15.71 MiB |
| `woff` + `ttf` 旧格式回退（40 个文件） | 0.78 MiB | 0 |
| PNG 品牌资源 | 1.23 MiB | 0.27 MiB |
| CSS | 0.42 MiB | 0.35 MiB |
| **`out/renderer` 合计** | **31 MiB** | **24 MiB** |

渲染器不再产出任何应用字体面。D598 / ADR 0298 移除了四款内置字体（Geist、
Inter、Noto Sans SC、LXGW WenKai），因此 `out/renderer` 中只剩 KaTeX 的数学
字形 `woff2`。以下为本机实测，两次均在干净的 `pnpm install --frozen-lockfile`
之后构建：

| 渲染器分组 | 含内置字体 | 移除后（D598） |
|---|---:|---:|
| JavaScript（121 个 chunk） | 9.04 MiB | 9.04 MiB |
| `woff2`（23 → 19 个文件） | 15.71 MiB | 0.24 MiB |
| CSS（1 个文件） | 0.48 MiB | 0.48 MiB |
| PNG 品牌资源（4 个文件） | 0.08 MiB | 0.08 MiB |
| GIF（2 个文件） | 0.05 MiB | 0.05 MiB |
| **`out/renderer` 合计**（152 → 148 个文件） | **25.36 MiB** | **9.89 MiB** |

差异完全来自被删除的四个字体面，以下为构建报告的实际大小：
`lxgw-wenkai.woff2` 8,016.75 kB、`noto-sans-sc.woff2` 7,782.07 kB、
`inter.woff2` 352.24 kB、`geist.woff2` 69.65 kB，合计 16,220.71 kB，
即合计体积下降的全部 15.47 MiB。中文现在由系统字体层
（`PingFang SC`、`Hiragino Sans GB`、`Microsoft YaHei`）渲染，因此不存在因
子集化而丢失字形的问题：根本不再随包发布字体面。
开启，旧 `woff`/`truetype` 剔除仍然保留，因为 KaTeX 仍会声明这些来源。

上表是三控件的 `v0.10.8` 记录，早于本次移除，其 `woff2` 行已不再反映现状。

在干净的轮廓上手动烟雾 (`PI_DESKTOP_DATA_DIR=$(mktemp -d)`)：

1. `pnpm dev` 与 `Pi-Desktop-Plus` 一起在 macOS 应用程序菜单中启动，
   Dock 和本机“关于”面板中的规范图标；没有 Electron 品牌
   可见。
2. 应用程序从 DMG 安装启动，出现窗口，然后出现应用程序菜单，
   关于面板和 Dock 品牌与开发路线相匹配。
3. 空首页和 expanded/collapsed 侧边栏显示规范的 Pi-Desktop-Plus
   标志；输入框提示行没有领先的品牌图标；新任务和
project/Temporary 使用消息加会话图标创建控件。
4. 出现新手引导清单；配置提供商；一轮流式聊天。
5. 一种授权工具调用（写入）允许 + 拒绝路径。
6. Quit/relaunch → 恢复会话历史记录，恢复窗口边界。
7. `~/.pi-desktop-plus/logs/` 包含 `app/`、`host/` 和 `agent/` 下分类的 NDJSON；
   关键的生命周期、工具、provider、plugin 和错误记录可用，不再创建独立的计时文件。
8. 禁用网络访问后，shell 仍然启动； English/Chinese
   切换、语法高亮、shell 高亮、KaTeX、Mermaid fallback/rendering、
   主机运行状况和 sidecar 运行状况继续使用打包的本地资产。

## 6. Current cloud release artifacts

The Release workflow builds only the macOS arm64 target on GitHub-hosted Actions.
Installer commands remain guarded against local and self-hosted execution.

```text
Runner: macos-15 (native arm64)
Input group: dist-mac-arm64
Inputs: Pi-Desktop-Plus-<version>-arm64.dmg, its .blockmap,
        Pi-Desktop-Plus-<version>-arm64-mac.zip, its .blockmap,
        <channel>-mac-arm64.yml
Final bundle: those four assets plus <channel>-mac.yml,
              release-manifest.json, and SHA256SUMS
```

The macOS arm64 package includes the native `bin/pi-desktop-host-core` binary.
macOS signing and notarization are mandatory for formal tags. Rollback and
installer upgrade qualification remain separate release hardening work.

The application still contains Windows and Linux support, and the packaging
scripts retain their target implementations. Those targets are paused in the
cloud Release workflow: they are not built, attached, or published by candidate
runs or formal tags under the current scope.
Standalone pi-host bundles are also absent from new releases. Remote-host
bootstrap that downloads matching-version pi-host assets is therefore
unavailable from these releases; the runtime and source capability remain.

### 6.1 Existing platform behavior outside current release output

便携版 Windows ZIP 目标不会写入 `latest.yml`。Windows 发布脚本会分别构建 NSIS
和 ZIP，并给 ZIP 的应用元数据写入 `piDistribution = "zip"`；已打包的 ZIP 运行使用
通知加链接交付。旧便携版 exe 仍在存在 `PORTABLE_EXECUTABLE_FILE` 时保持手动更新。
NSIS 仍走应用内下载并在退出时安装。数据仍在现有应用数据目录。用户解压 ZIP 后
直接运行 `Pi-Desktop-Plus.exe`，不会启动自解压包装器，也不会请求管理员权限。

RPM 目标会向 FPM 传入 `_build_id_links none`。捆绑的 Electron 二进制文件位于
`/opt/PI-Desktop` 下；省略全局 `/usr/lib/.build-id` 链接，可以避免与其他捆绑相同
Electron 二进制文件的应用发生冲突。

该 ASAR 产物包含的是 Electron 应用归档，而不是完整的 Linux 发行包。
若要重新打包，请把它作为应用归档放入目标 Electron 的 resources 布局中，
与目标软件包内的本机主机及其他资源放在一起，然后用以下命令启动：

```bash
electron Pi-Desktop-Plus-<version>-linux-<arch>.asar
```

The following describes existing target behavior; it is not a current cloud
release build matrix. When those targets return to the release workflow, run the
corresponding platform smoke checks before publishing them.

Shell smoke checks for those platform targets:

1. 确认窗口中没有出现 File/Edit/View/Window/Help 菜单。
2. 验证 F10 和 Shift+F10 对焦点内容仍然可用。
3. 从焦点编辑器执行应用程序和编辑快捷方式。
4. 最小化、最大化、恢复和关闭自定义控件。
5. 使用 `PI_DESKTOP_START_MAXIMIZED=1` 重新启动；确认初始
   maximize/restore 字形与查询的本机状态匹配。
6. 验证未知的 menu/window IPC 操作在窗口打开和关闭时失败。

## 7. 已知限制

The following target-specific notes describe existing application and packaging
behavior; they do not indicate that these targets are included in current cloud
release bundles.

- Linux deb/rpm 和 Windows 便携版 ZIP 仍保持通知和链接更新模式。打包的 macOS、Windows NSIS 和 Linux AppImage 使用应用内 `electron-updater`。
- Linux x64 和 arm64 包在 Ubuntu 22.04 上构建（本机 `ubuntu-22.04` 和
  `ubuntu-22.04-arm` 运行器），因此 host-core 需要 glibc 2.35 或更高版本
  （Ubuntu 22.04、Debian 12、Fedora 36+）。每个标签作业都会运行
  `scripts/check-linux-host-glibc.mjs`，拒绝需要更新 glibc 的二进制文件。
- Linux arm64 的麦克风采集仅在 Raspberry Pi 板卡上可用：
  `@picovoice/pvrecorder-node` 按 `/proc/cpuinfo` 的 CPU part 判定 Linux
  arm64。语音转写（`transcribe-cpp` 随附 `linux-arm64-cpu-vulkan` 包）以及
  其余所有功能在任何 arm64 Linux 设备上都可用。
- 回滚和分阶段部署仍是开放工作。预发布具有独立命名更新源且不会成为 GitHub latest。
  现有未签名 macOS 安装可能需先手动安装一次云端发布的已签名 DMG，才能应用内更新。
