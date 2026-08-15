---
title: 架构决策记录
description: 与英文 ADR 一一对应的 PI-Desktop 架构决策阅读入口。
---

# 架构决策记录

ADR 记录那些不应被静默改变的架构选择。中文入口与英文索引保持相同结构；完整记录、状态和决策编号继续以英文页面为源事实。

## 重点决策

| 决策 | 说明 |
|---|---|
| [ADR 0001：Electron 桌面壳](/adr/0001-use-electron) | 桌面窗口与平台能力的承载层 |
| [ADR 0005：本地插件系统](/adr/0005-user-installable-plugin-system) | 用户安装插件的第一阶段边界 |
| [ADR 0009：English-first 全球化](/adr/0009-english-first-globalization) | 源语言、术语和协作规则 |
| [ADR 0010：Rust host core](/adr/0010-rust-backend-host-core) | 特权进程、RPC 与持久化的宿主边界 |
| [ADR 0053：Plan checkpoint](/adr/0053-plan-checkpoint-artifact-and-execution-epoch) | 计划审批、artifact 和执行 epoch |
| [ADR 0079：VitePress 文档站](/adr/0079-vitepress-documentation-site) | 双语文档站的结构与部署方式 |
| [ADR 0083：自定义全局界面字体](/adr/0083-custom-global-ui-font) | 设置字体选择器、内置开源字体与系统字体枚举 |
| [ADR 0089：主动后台子代理委托](/adr/0089-proactive-background-subagent-delegation) | 非阻塞 Task、TaskWait/TaskList/TaskStop 生命周期与权限作用域 |
| [ADR 0090：用户可配置的关闭行为](/adr/0090-user-configurable-close-behavior-close-to-tray) | 首次关闭只问一次，关闭到托盘或退出，设置里可改 |

## 什么时候看 ADR

- 规格告诉你系统应该怎样工作。
- ADR 告诉你为什么选择这个边界，以及哪些替代方案被放弃。
- 决策日志记录更细的冻结条款和后续修订。

前往 [英文 ADR 索引](/adr/README) 查看完整记录，或打开 [中文决策日志](/zh-CN/spec/08-meta/decisions-log) 按编号检索。
