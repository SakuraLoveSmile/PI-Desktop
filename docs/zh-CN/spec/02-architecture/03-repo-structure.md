# 03. 仓库结构

> **翻译说明：** 本页是与 [英文源规格](/spec/02-architecture/03-repo-structure) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


## 1. 目标结构

```text
PI-Desktop/
├── apps/
│ └── desktop/ # Electron app
│ ├── electron/ # main + preload (TS)
│ ├── src/ # React renderer
│ ├── locales/
│ │ └── en/ # English source locale
│ ├── package.json
│ └── electron.vite.config.ts
├── crates/
│ └── host-core/ # Rust backend host core
│ ├── Cargo.toml
│ └── src/
├── packages/
│ ├── agent-runtime/ # Node pi runtime wrapper
│ ├── plugin-sdk/ # plugin author types/sdk
│ ├── shared/ # shared contracts (TS)
│ └── i18n/ # shared i18n utilities/catalog
├── examples/
│ └── plugins/hello/
├── docs/
│ ├── adr/
│ ├── project/
│ └── spec/
├── scripts/
├── package.json
├── pnpm-workspace.yaml
├── Cargo.toml # rust workspace (optional root)
└── README.md
```

## 2. 包职责

### `apps/desktop`
产品入口：
- Electron 生命周期
- 用户界面
- IPC 接线
- 包装配置

### `crates/host-core`
Rust 主机服务：
- 工具执行
- 权限网关
- 插件主机服务
- 持久性适配器
- 审计日志记录

### `packages/agent-runtime`
Node 对 pi 的包装：
- 模型引导
- 代理回合控制
- 事件标准化
- 主机工具桥客户端

### `packages/shared`
跨边界契约：
- IPC 通道名称
- DTO类型
- 错误代码
- 协议版本控制

### `packages/i18n`
- 英文留言目录来源
- 区域设置加载助手
- 消息ID约定

### `packages/plugin-sdk`
- 清单类型
- 主机 API 类型
- 验证器

## 3. 运行时数据（不在git中）

```text
~/.pi-desktop/
 ├── pi.sqlite            # single DB, host-core owned (03-runtime/04, D086)
 ├── secrets/
 ├── attachments/
 ├── logs/
 │    ├── app/<category>.log
 │    ├── host/<category>.log
 │    └── agent/<category>.log
 ├── cache/
 ├── workspaces/
 └── plugins/
 ├── installed/
 ├── data/
 ├── logs/
 └── cache/
```

## 4. 命名约定

| 对象 | 公约 |
|---|---|
| JS 包 | `@pi-desktop/*` |
| Rust 箱子 | `pi-desktop-host-core`（或 `host-core`） |
| IPC 频道 | `pi-desktop/<domain>/<action>` |
| i18n 键 | `domain.section.key` |
| 插件 ID | 反向域风格 |
