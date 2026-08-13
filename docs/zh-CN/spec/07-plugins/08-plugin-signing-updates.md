# 08. 插件签名和更新

> **翻译说明：** 本页是与 [英文源规格](/spec/07-plugins/08-plugin-signing-updates) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


## 1. 目标

为插件分发提供完整性和来源保证。

层数：

1. **校验和**：防止传输损坏/篡改（首先执行）
2. **签名**：防止伪造出处（稍后进行）
3. **更新通道**：受控升级

## 2. 验证级别

| 级别 | 条件 | 政策 |
|---|---|---|
| L0 | 无校验和 | 仅允许用于 dev/local 目录 |
| L1 | sha256 校验和 | 市场下载的最低要求 |
| L2 | 校验和+签名 | 官方/验证插件所需（稍后） |

## 3. 校验和流程

下载后：

```text
sha256(file) == downloadInfo.shasum
```

失败时：
- 请勿安装
- 显示“完整性检查失败”
- 记录审核条目

## 4. 签名方案（具体实现稍后冻结）

推荐：

- 算法：`Ed25519`
- 发布者密钥对
- 由市场或发布者分发的公钥
- 签名对象：`pluginId + version + shasum`

示例：

```ts
type PluginSignature = {
 alg: "ed25519"
 publisherId: string
 signedAt: string
 payload: {
 pluginId: string
 version: string
 shasum: string
 }
 signature: string // base64
}
```

验证失败将拒绝安装/更新。

## 5. 发布者信任

```ts
type PublisherTrust = {
 publisherId: string
 displayName: string
 publicKey: string
 level: "official" | "verified" | "community"
}
```

楼主坚持：
- 内置官方公钥
- 用户添加的自定义可信发布者（高级）

## 6. 更新频道

```ts
type UpdateChannel = "stable" | "beta" | "dev"
```

规则：
- 默认稳定
- beta/dev 需要明确的用户选择加入
- 不同渠道的版本不得盲目降级

## 7. 更新政策

### 手动更新（首先执行）
- 检查更新
- 显示变更日志
- 用户确认后升级

### 自动更新（稍后进行）
可配置：
- 关闭
- 仅通知
- 官方自动
- 自动全部（不推荐作为默认值）

自动更新仍需经过验证和权限更改审核。

## 8. 权限变更审核

如果新版本增加了升级权限：

1.阻止静默升级
2.显示权限差异
3. 用户确认后继续

示例：

```text
+ net.fetch
+ fs.write.workspace
+ fs.delete.workspace
```

## 9. 回滚

P2目标：

- 保留以前版本的备份
- 升级失败时自动回滚
- 允许用户手动恢复（相同的ID，旧版本）

## 10. 安全事件响应

如果发现恶意插件版本：

- 市场方可以将其标记为已拉出
- 主机在检查更新/安装期间拒绝它
- 已安装的用户会收到风险警告并一键禁用

## 11. 验收

1. 校验和不匹配无法安装
2.增加权限的升级提示用户
3. 官方插件签名策略有可配置切换（开发期间）
4. 更新检查结果可以显示在UI中


## 12. 实施情况

现已发货：

- marketplace/package 安装时的 sha256 校验和验证
- 通过 `market.checkUpdates` 更新发现
- 插件 UI 中的手动更新操作
- 每个插件自动更新选择加入 + `market.applyUpdates`
- 在添加功能的升级之前进行权限差异审查

仍计划：

- 强制 ed25519 签名
- 发布者密钥管理用户界面
- yank/incident 响应自动化
