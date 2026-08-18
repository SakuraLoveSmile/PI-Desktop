# 07. 插件市场

> **翻译说明：** 本页是与 [英文源规格](/spec/07-plugins/07-plugin-marketplace) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


## 1. 定位

插件市场是一个**分发层**，而不是运行时核心。

原理：

> 首先让本地插件系统运行，然后集成市场。

市场负责：
- 发现
- 搜索
- 显示元数据
- 下载
- 更新检查

主办方负责：
- 验证
- 授权
- 安装
- 运行
- 安全隔离

## 2. 阶段策略

### A阶段✅
- 协议和数据模型
- 当地官方市场提供商（`plugins/market/catalog.json`）

### B阶段✅
- Browse/search + 下载安装是针对官方提供商实施的
- 官方提供商是专用的 GitHub 存储库 `vastsa/pi-desktop-plugins`
- 默认目录 URL：`https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json`
- 包 URL 可以是绝对 `https://` / `http://` / `file://`，或根据目录 URL 解析的相对路径
- HTTPS 获取在 host-core 中使用 `curl`

### 目录来源选择

「扩展 → 市场」决定目录从哪里获取。host-core 解析 URL 时把环境变量放在最高
优先级，这样开发构建和测试可以指向本地目录，而不必改动已持久化的设置：

| 优先级 | 来源 | 取值 |
| --- | --- | --- |
| 1 | `PI_DESKTOP_PLUGIN_MARKET_URL` | 任意 URL |
| 2 | `pluginMarketSource: "mirror"` | `https://cnb.cool/aixk/pi-desktop-plugins/-/git/raw/main/catalog.json` |
| 2 | `pluginMarketSource: "custom"` | `pluginMarketCustomUrl` |
| 3 | `pluginMarketSource: "official"`（默认） | 上面的默认目录 URL |

镜像用于无法访问 `raw.githubusercontent.com` 的网络环境。镜像提供的目录与官方
逐字节一致，且目录中的包路径是相对路径，因此 `resolve_package_url` 会让安装包
下载跟随提供该目录的来源，切换来源不影响 shasum 校验。

缓存目录会通过 `plugins/market/cache-meta.json` 记录其来源。来自其他来源的快照
只被忽略而不删除——它的包 URL 指向用户刚切走的那个提供商——所以切回去时无需
重新请求即可恢复该目录。`settings.set` 只在内存中重新指定来源；在那里发起抓取
会让 host RPC 状态锁卡在市场超时上，因此切换后由渲染进程触发 `market.refresh`。

### 客户端可见的目录策略

保留稳定 ID 以 `demo.` 开头的仅开发示例条目
可用作插件开发的离线装置和直接安装目标，
但桌面客户端会在更新其市场状态之前过滤它们。他们
不显示为卡片、类别或搜索结果。一个已经安装好的
示例在已安装中仍然可见，因此仍然可以禁用或卸载它。

### C阶段（部分✅）
- 自动更新策略+实施权限差异门控
- 评级/强制签名仍在计划中

## 3. 市场提供商抽象

```ts
interface MarketProvider {
 id: string
 list(query: MarketQuery): Promise<MarketSearchResult>
 get(pluginId: string): Promise<MarketPluginDetail>
 getDownloadInfo(pluginId: string, version?: string): Promise<MarketDownloadInfo>
 checkUpdates(installed: InstalledPluginRef[]): Promise<MarketUpdateInfo[]>
}
```

支持多个提供商：
- `official`
- `custom`（企业私有源）
- `local-mock`（开发）

## 4. 数据模型

### MarketPluginSummary
```ts
type MarketPluginSummary = {
 id: string
 name: string
 description: string
 author: string
 iconUrl?: string
 latestVersion: string
 downloads?: number
 updatedAt: string
 categories?: string[]
 permissionSummary: string[]
 verified?: boolean
 installable?: boolean
}
```

### 市场插件详细信息
```ts
type MarketPluginDetail = MarketPluginSummary & {
 readmeMarkdown?: string
 versions: Array<{
 version: string
 publishedAt: string
 changelog?: string
 minPiDesktop?: string
 }>
 screenshots?: string[]
 homepage?: string
 repository?: string
 permissions: string[]
 safetyNotes?: string
}
```

`installable` 表示 `latestVersion` 是否带有安装所需的包元数据（`url` 与
`shasum`）。发布者可以先登记版本、稍后再上传安装包；这样的版本仍然可以被发现，
但市场列表和详情面板会禁用安装按钮并标注「尚未发布安装包」，而不是发起一个
host 必然拒绝的下载。批量更新会跳过这类版本，而不是让整批更新失败。

### 目录发布闸门

发布或排查一次发布之前，先在仓库里跑预检：

```bash
pnpm check:marketplace -- \
  --url https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json \
  --plugin <plugin-id>
```

预检刻意比发现流程更严格：每个已发布版本都必须有合法且在该插件内唯一的语义化
版本号、64 位 SHA-256 校验和、包 URL、正数包大小以及权限数组。目录没过这道闸门
时，应当先在市场发布方修好，而不是去改客户端的更新行为。

### 市场下载信息
```ts
type MarketDownloadInfo = {
 pluginId: string
 version: string
 url: string
 sizeBytes: number
 shasum: string // sha256
 signature?: string // mandatory later
 signatureAlg?: "ed25519"
 publishedAt: string
}
```

## 5. 安装路径（市场）

```text
browse/search
 → detail
 → install
 → download to cache
 → verify shasum/(signature)
 → hand to local packaging installer
 → permission review
 → enable?
```

任何验证失败时：中止并可选择清理缓存。

`.piplug` 软件包现在可以在本地生产：`pnpm pi-plugin pack <dir>`
（同样，`PluginPack` 代理工具）写入 `dist/<id>-<version>.piplug` 和
打印其 sha256，插件页面通过相同的方式安装该文件
作为市场下载的验证和权限审查。分布通过
因此，市场是可选的——为个人使用而编写的插件永远不会
必须离开机器。参见
[插件开发者体验](/zh-CN/spec/07-plugins/10-plugin-devex)。

其插件声明 `contributes.skills` 的目录条目也必须声明
`permissions` 中的 `agent.prompt.inject`；没有它，技能就会变得惰性，
权限审查不会提及它们。 `pi-plugin check` 对此发出警告
组合。

## 6. 更新路径

1. 启动后或按计划执行 `checkUpdates`
2.将安装的版本与最新版本进行比较
3. UI显示可用更新列表
4、用户确认后下载升级

策略：
- MVP 之后的第一个版本：手动更新
- 稍后：可选自动更新（低风险插件或仅限官方插件）

## 7. Marketplace UI 信息架构

```text
Extensions
├─ Installed
│ ├─ Search + result count
│ └─ Groups: Needs attention · Updates available · Active · Turned off
├─ MCP
├─ Skills
├─ Marketplace
│ ├─ Search
│ ├─ Categories
│ └─ Card grid
├─ Detail sheet (shared by both tabs)
└─ Permission dialog (install / upgrade)
```

所有五个表面都处于一个分段控制之下，该控制承载相关的
每个选项卡计数。没有单独的数字概览带；更新警报，
选项卡计数和已安装组计数保留可操作状态，无需
将其复制到静态卡行 (D196) 中。标头保留单个
上下文主要操作（浏览市场/刷新市场）和移动
检查更新、应用自动更新、安装包和加载本地
插入溢出菜单（D169）。

安装的行故意默认为安静的两行摘要，其中包含
插件名称、可选的本地源标记、id 和版本。国家集团
标题包含“活动”/“已关闭”/“可用更新”/“需要注意”，以及
加载错误保持内联。能力、居民服务状况以及
带有风险色彩的权限芯片在折叠的本机详细信息中呈现
披露；扩展它可以暴露现有的完整读数，而无需进行每一个
排高。安装的行使用一个当前状态范围触发器；打开显示
三个范围选择及其解释，并选择此项目
打开现有的项目选择器。行图标操作在静止时保持可见，并且
在悬停和键盘焦点时显示其标签。这是一个仅渲染器
演示选择；插件
权限和激活合同不变。

详细信息表必须显示：
- 权限，按风险等级分组和标记
- 作者
- 版本（可选版本列表）
- 更新时间
- 风险描述（安全说明标注）
- 安装按钮

市场卡呈现字母组合字形，而不是获取 `iconUrl`；的
渲染器不执行远程图像加载（D169）。

## 8. 信任模型

| 级别 | 含义 |
|---|---|
| 已验证 | 官方或认证出版商 |
| 社区 | 社区插件 |
| 未知 | 定制来源/未经认证 |

UI 必须使信任级别可见。
社区不得伪装成经过验证的。

## 9. 私人来源（面向企业）

支持配置：

```json
{
 "marketProviders": [
 {
 "id": "official",
 "url": "https://market.example.com"
 },
 {
 "id": "corp",
 "url": "https://plugins.company.local",
 "tokenEnv": "PI_DESKTOP_MARKET_TOKEN"
 }
 ]
}
```

## 10. 远程 API 草稿 (HTTP)

> 选秀（后 MVP）。不是最终的实现绑定；仅协议草案。

- `GET /v1/plugins?query=&category=&page=`
- `GET /v1/plugins/:id`
- `GET /v1/plugins/:id/versions`
- `GET /v1/plugins/:id/download?version=`
- `POST /v1/updates/check`

所有下载元数据必须包含 `shasum`。

## 11. 明确不做（市场 v1）

- 应用内付费结账
- 远程插件代码热补丁
- 静默自动安装
- 未经验证的下载和执行
- Comment/social系统（可延期）

## 12. 接受（市场只读+安装）

1.可以浏览插件列表
2.可以查看权限和版本
3.可以下载安装
4. 验证失败无法安装
5.安装后出现Installed


## 12. 实施情况

桌面扩展页面现在包含一个市场选项卡，该选项卡调用：

- `market.search`
- `market.getDetail`
- `market.install`
- `market.checkUpdates`
- `market.applyUpdates`

安装在启用之前始终通过校验和验证和权限审查。


## 13. 官方市场存储库

存储库：[vastsa/pi-desktop-plugins](https://github.com/vastsa/pi-desktop-plugins)

```text
catalog.json
packages/*.piplug
plugins/<id>/
scripts/pack_plugin.py
scripts/rebuild_catalog.py
```

维护流程：

1.编辑`plugins/<id>`
2.`python3 scripts/pack_plugin.py plugins/<id>`
3.`python3 scripts/rebuild_catalog.py`
4. 提交 + 推送至 `main`
5. PI-Desktop 通过 `market.refresh`/市场 UI 刷新

使用 env 覆盖目录 URL：

```text
PI_DESKTOP_PLUGIN_MARKET_URL=https://raw.githubusercontent.com/<owner>/<repo>/<ref>/catalog.json
```


## 14. 市场细节用户体验

扩展目标将详细信息打开为右侧表（稀松布 + Escape + 外部
单击“dismiss”），加载 `market.getDetail` 并显示：

- 关于文本、作者和存储库/主页链接（在作品中打开
  面板浏览器，绝不是系统浏览器）
- 安全说明作为警告标注
- 按风险等级分组的权限，每个权限都有简单的语言解释
- 版本列表作为可选择的行，所选版本驱动粘性
  安装/更新操作
- 自述文件降价

从任一选项卡都可以通过权限对话框进行安装，该对话框将
请求进入高/中/低风险部分并标记新条目
相对于已安装的版本，因此升级不能默默地扩大访问范围
（D169）。

贡献文档位于官方仓库：

- https://github.com/vastsa/pi-desktop-plugins/blob/main/CONTRIBUTING.md
- 实用模板：`plugins/demo.workspace-summary`
