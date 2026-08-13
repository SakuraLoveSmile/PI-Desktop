# 14. 密钥存储

> **翻译说明：** 本页是与 [英文源规格](/spec/03-runtime/14-secrets-storage) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


## 1. Goal

在 Rust 主机所有权下安全地存储提供商凭据和未来敏感令牌，渲染器 logs/UI 持久性的原始秘密泄漏为零。

## 2. 所有权

| 关注 | 业主 |
|---|---|
| 秘密 write/read/delete | Rust host-core |
| 秘密元数据索引 | SQLite `secrets_meta` |
| 操作系统安全存储集成 | Rust host-core |
| 渲染器知识 | `hasSecret` 仅布尔值 |

Node pi sidecar 可能会通过主机 RPC 接收**临时内存中**的秘密，但从未由 sidecar 保留。

## 3. 后端

### 小学
- **Electron/OS 安全存储风格后端** 由主机介导
- macOS：第一个版本首选钥匙串支持的路径

### 后备
如果主后端不可用：
1. 使用机器本地密钥材料加密秘密 blob
2.将密文存储在app data下
3.在元数据中标记`backend=file_fallback`
4.设置中出现安全警告

MVP 必须实现两条路径的自动选择。

## 4. 数据模型

```ts
type SecretMeta = {
  secretRef: string
  providerId?: string
  kind: "api_key" | "bearer_token" | "azure_api_key" | "custom"
  backend: "safeStorage" | "file_fallback"
  updatedAt: string
}

// raw value never appears in SQLite tables
// raw value never appears in IPC list/get provider responses
```

`secretRef` 格式：

```text
secret:provider:<providerId>:api_key
```

## 5. 托管 RPC

- `secrets.set` `{ secretRef, value, meta }`
- `secrets.delete` `{ secretRef }`
- `secrets.has` `{ secretRef } -> boolean`
- `secrets.getForRuntime` `{ secretRef, reason, runId }` **仅限内部**（main/host → 不暴露给渲染器）

### 面向渲染器的表面
Renderer 使用接受 create/update 上的可选 `secretValue` 的提供程序方法，并且仅读取 `hasSecret`。

## 6. 访问规则

1. Renderer 无法列出原始机密
2. 日志编辑：与秘密模式/已知秘密引用匹配的掩码值
3. `getForRuntime` 需要活动运行上下文并经过审核
4.导出默认排除机密
5. Uninstall/reset 应用程序会删除机密，除非未来的显式迁移工具另有说明
6. 提供商删除默认删除链接的秘密

## 7. 编辑政策

切勿写入日志：
- 授权标头
- API 密钥
- 不记名代币
- 名为 `secretValue`/`hasSecret`/create/update 的查询参数

替换为：
```text
***REDACTED***
```

## 8. 故障模式

| 案例 | 行为 |
|---|---|
| 设置失败 | 如果需要机密，提供程序更新会自动失败 |
| 后端降级为后备 | 在设置中每个会话警告一次 |
| 运行时丢失秘密 | `PROVIDER_SECRET_MISSING` |
| 解密失败 | 视为缺失+提示重新输入 |

## 9. 验收标准

- [ ] set/has/delete 适用于 macOS arm64 主路径
- [ ] 渲染器永远不会收到提供商 list/get 上的原始机密
- [ ] 运行时可以暂时获取一个回合的秘密
- [ ] 日志在正常故障测试中不包含原始密钥材料
- [ ] 后备后端在主后端不可用时工作（dev/test 线束）
