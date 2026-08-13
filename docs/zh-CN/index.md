---
layout: home
title: PI-Desktop 文档
titleTemplate: 本地优先的 AI 编程代理
hero:
  name: PI-Desktop
  text: 本地优先的 AI 编程代理
  tagline: 一个克制、可检查的桌面工作区。产品决策、运行时契约和插件模型，集中在这里阅读。
  actions:
    - theme: brand
      text: 从快速开始
      link: /zh-CN/guide/
    - theme: alt
      text: 浏览规格
      link: /zh-CN/spec/
features:
  - title: 先理解产品
    details: 了解已经交付的界面、运行状态、权限边界，以及它们背后的决策。
  - title: 再追踪契约
    details: 从 Rust host、pi sidecar、NDJSON RPC 到存储和模型系统，按领域深入。
  - title: 最后开始扩展
    details: 按照包格式、API、安全和生命周期文档，构建本地插件。
---

## 为贡献者准备的文档

快速开始帮助你建立整体模型，规格文档说明实现契约，ADR 记录每个重要边界为什么存在。

| 01 / ORIENTATION | 02 / CONTRACTS | 03 / CONTEXT |
|---|---|---|
| [**快速开始**](/zh-CN/guide/) — 先理解产品定位、运行时角色，以及进入代码库的最短路径。 | [**规格文档**](/zh-CN/spec/) — 按产品、架构、运行时、UX、安全、交付和插件领域浏览。 | [**架构决策**](/zh-CN/adr/) — 查看维持桌面客户端一致性的约束、取舍和冻结决策。 |

## 当前实现快照

| 当前应用版本线 | Host wire protocol | 存储 schema | 文档入口 |
|---|---|---|---|
| `0.5.8` | `v9` | `v11` | `EN / 中文` |
