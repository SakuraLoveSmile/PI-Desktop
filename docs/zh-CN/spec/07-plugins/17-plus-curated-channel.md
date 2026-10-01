# 17. Plus 精选渠道

> **翻译说明：** 本页是与 [英文源规格](/spec/07-plugins/17-plus-curated-channel) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

状态：契约已冻结，激活等待目录发布。

Plus 渠道是一个"精选"市场来源。它存在的意义是：让维护者对某个确切
`(pluginId, version, shasum)` 的审核成为"该版本出现在用户面前"的唯一条件，
同时不改变现有四个来源的行为。

这个标签的含义是"维护者审核过这个确切版本"。它**不**表示维护者编写了该插件，
也**不**是该代码安全的保证。每个条目的上游作者信息与许可证都会保留。

## 渠道标识

| 字段 | 值 |
| --- | --- |
| `PluginMarketSource` | `plus` |
| 目录地址（固定） | `https://raw.githubusercontent.com/SakuraLoveSmile/Pi-Desktop-Plus-Plugins/main/catalog.json` |
| 目录 `providerId` | `pi-desktop-plus-curated` |
| 已安装记录的 `marketplace.providerId` | `plus` |
| 策略版本 | `plus-curated-v1` |
| 下载解析 | 无——目录用相对路径解析包地址，与 `github`、`mirror` 渠道完全一致 |

该端点由宿主构建提供，而不是用户填写的字段。未设置时，选项显示为禁用并给出本地化的
"尚未配置"说明，且不发出任何请求。已持久化 `plus` 选择但端点缺失时报告配置错误，
绝不会回退到上游目录。

`is_trusted_channel()` **不得**列出这个地址。精选目录不能把自己提升为 `verified`；
除非既有上游权威确立了分级，条目默认 `trust: "unknown"`。

## 仓库结构

```
catalog.json                     generated; never edited by hand
packages/<pluginId>-<version>.piplug
approved/<pluginId>/<version>.json
scripts/generate-catalog.mjs
```

`catalog.json` 由 `approved/` 生成，因此审核记录就是白名单。目录不得是上游目录的副本。

## 审核记录

由维护者撰写，一个确切版本一个文件：

```json
{
  "schemaVersion": 1,
  "pluginId": "acme.todo",
  "version": "1.2.0",
  "shasum": "<64 位小写十六进制>",
  "sizeBytes": 40960,
  "decision": "approved",
  "reviewedAt": "<UTC ISO-8601 时间戳>",
  "policyVersion": "plus-curated-v1",
  "sourceRepository": "<原始 HTTPS 仓库>",
  "sourceCommit": "<40 位十六进制>",
  "license": "<允许再分发的许可证>",
  "notes": "<维护者审核摘要>",
  "catalog": {
    "name": "<来自包清单的显示名>",
    "description": "<来自包清单的简短描述>",
    "author": "<清单作者，保留上游署名>",
    "publishedAt": "<该包构建的 UTC ISO-8601 时间戳>",
    "minPiDesktop": "<可选的最低宿主版本>",
    "permissions": ["<该包声明的权限 id>"]
  }
}
```

`catalog` 块在审核时从包清单抄录，因此生成器无需解包。CI 可以对照已发布的 `.piplug`
校验它；目录条目 schema 要求 `id`、`name`、`description`、`author` 与 `versions`，
每个版本要求 `publishedAt`、`shasum`、`url`、`sizeBytes` 与 `permissions`。

`yanked` 记录用于撤回某个版本：它不得再被提供安装，已安装的副本保持原样，且其撤回
提示在之后从其他来源刷新时仍然保留。

字节变化或新版本都需要一次新的真人审核。CI 只校验记录与包，**从不由 CI 批准**。包、
其审核记录与重新生成的目录在同一个提交中发布，包地址使用相对路径，且不存在跨 provider
的下载基址。

## 客户端规则

- 新鲜元数据检查、SHA-256 与大小校验、下载主机白名单、ZIP 与路径检查、manifest 检查、
  权限复核与升级前备份全部保持现状。
- 安装在市场 IPC 输入中记录被审核的来源钉（`expectedMarketplace: {source, catalogUrl,
  version, shasum}`）。若与生效渠道、端点或刚解析出的元数据不一致，则以
  `PLUGIN_MARKET_CHANGED` 失败，且已安装副本保持不变。
- 合法但空的目录等于"精选列表为空"。抓取失败时只回退到**同一来源**的快照，并给出过期
  或错误提示。
- 审核徽标始终描述当前显示的确切版本，绝不代表该插件 id 的所有未来版本。

## 激活清单

1. 发布 schema v2 目录，`providerId: "pi-desktop-plus-curated"`，`plugins` 为空数组。
2. 审核至少一个许可允许再分发的确切版本，并发布其包、审核记录与重新生成的目录。
3. 确认仓库保持公开：客户端以未认证方式读取它。
4. 之后才在发布构建中固定端点，并重跑精选渠道的验收路径。

## Preflight 说明

`scripts/check-marketplace-catalog.mjs` 要求 `plugins` 为非空数组，因此刚建立的精选仓库在
第一个审核通过之前会卡在这道门禁上。客户端本身能正常反序列化空列表，并将其视为空精选
列表。在第一个审核包出现之前，要么只对部署目录运行该 preflight 工具，要么在接入该渠道
的同一次改动中给检查器加一个显式的"精选空目录"豁免。
