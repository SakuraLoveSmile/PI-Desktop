---
title: 规格文档
description: PI-Desktop 产品、架构、运行时、体验、安全、交付和插件规格的中文索引。
---

# 规格文档

规格文档是实现细节的主要来源。中文页面提供领域地图；技术正文保持英文，便于代码、提交和协议术语统一。

## 领域地图

- [产品](/spec/01-product/00-overview)：产品概览、范围和非目标。
- [架构](/spec/02-architecture/01-architecture)：Electron、Rust host、pi sidecar 与存储边界。
- [运行时](/spec/03-runtime/01-ipc-protocol)：IPC、Agent、权限、数据存储、模型和错误码。
- [体验](/spec/04-ux/01-ui-ia)：信息架构、国际化、设计系统和交互模式。
- [安全](/spec/05-security/01-security)：权限、路径、插件和进程隔离。
- [交付](/spec/06-delivery/01-mvp-milestones)：里程碑、验收、E2E、发布与变更清单。
- [插件](/spec/07-plugins/01-plugin-system)：插件包、API、生命周期、权限和开发体验。
- [元数据](/spec/08-meta/decisions-log)：决策日志和开放问题。

## 推荐阅读顺序

1. [基线](/spec/00-baseline)
2. [产品范围](/spec/01-product/01-product-scope)
3. [系统架构](/spec/02-architecture/01-architecture)
4. [Rust host core](/spec/03-runtime/05-host-core-rust)
5. [插件系统](/spec/07-plugins/01-plugin-system)
