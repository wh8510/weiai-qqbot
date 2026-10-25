# 架构

## 一句话

NapCat 负责把 QQ 变成 OneBot 11 事件流；本程序负责“这个人是谁、现在想不想说话、说什么、说完记住什么”。

```text
QQ ── NapCat ── OneBot 11 / WebSocket
                        │
                        ▼
                 ┌───────────────┐
                 │ 接入层         │ 鉴权 / 去重 / 名单 / 归一化 / 媒体
                 └──────┬────────┘
                        ▼
                 ┌───────────────┐
                 │ 会话运行时     │ 批量 / 注意力 / 概率 / 上下文 / 生成
                 └───┬───────┬───┘
                     │       │
              ┌──────▼──┐  ┌─▼─────────────┐
              │ 记忆系统 │  │ 模型网关       │ 目录 / 能力 / 预算 / 成本
              └────┬────┘  └─┬─────────────┘
                   ▼         ▼
              ┌───────────────────────────┐
              │ SQLite（字段级加密）       │
              └───────────────────────────┘
                     ▲
              ┌──────┴────────┐
              │ Web 管理端     │ 登录 / 模型 / 人格 / 名单 / 会话 / 用量
              └───────────────┘
```

## 设计原则

1. **协议层薄**：只依赖 OneBot 11 标准；NapCat 扩展可选。反向 WS 优先，正向 WS / HTTP 兜底。
2. **模型层是数据**：模型名、上下文、价格、能力在 catalog，不写死在业务代码。
3. **能力感知**：先知道模型能不能看图/发语音/用 JSON，再决定 prompt 和消息结构。
4. **默认沉默**：群聊里“不回复”是正常动作；私聊里“回复”是默认，但节奏、分条、延迟像人。
5. **上限优先**：名单 → 静默 → 概率 → 预算 → 模型；任何随机都不能越过硬上限。
6. **记忆是结构化的**：摘要 + 事实 + 日记 + 未闭环，而不是把全部历史反复塞进上下文。
7. **可恢复**：重启后从摘要/事实/日记恢复，不依赖完整消息历史。

## 模块

| 模块 | 职责 |
|---|---|
| `src/onebot` | 反向/正向 WS、token 校验、事件归一化、发送 API、状态 |
| `src/models` | Provider 适配（OpenAI 兼容 / Anthropic / Gemini / mock）、catalog、能力探测、计价、预算 |
| `src/chat` | 名单、群注意力、上下文预算、人格 prompt、回复计划、outbox |
| `src/memory` | 摘要/事实/事件/日记、记忆 worker |
| `src/proactive` | 主动消息调度、静默/上限/退避、日记定时 |
| `src/media` | 图片下载 + SSRF 防护、视觉旁路、Windows TTS、表情包 |
| `src/web` | Fastify API、登录/CSRF、SSE、静态管理端 |
| `src/db` | schema、迁移、SQLite 打开 |
| `src/security` | 主密钥、HKDF、AES-GCM、Argon2id |

## 消息处理流程

1. OneBot 反向 WS 或正向 WS 收到 `message` 事件。
2. 校验 token / self_id / 去重；忽略自己发的消息。
3. `checkAccess`：名单、Owner、群模式、@ / 引用判断。
4. `getOrCreateSession`：按 `(account, kind, peer)` 找会话。
5. 消息加密入库；取消该会话尚未发出的旧气泡。
6. 批处理窗口（私聊 1.2s，群聊 2.2s）：连续消息合并成一轮。
7. 群聊先算注意力；私聊按回复概率。
8. 解析图片：
   - 主模型支持视觉 → 直接作为图片块；
   - 否则调用视觉角色生成描述；
   - 都没有 → 不传图，prompt 注入“你看不到图片”。
9. 组装上下文（摘要/事实/事件/日记/未闭环/最近消息/当前批次）。
10. 调 `chat` 角色，要求 JSON 回复计划。
11. 解析计划：`silent` / 1~4 条 bubbles / sticker / quote / voice。
12. 写入 outbox，按字数模拟打字延迟；worker 到点发送。
13. 发送成功后写入 `messages`（direction=out），更新关系状态。
14. 视消息数量排队 `memory.summarize`；每日 23 点排队 `memory.diary`。

## 数据库

所有内容表都在 `src/db/migrations.ts`：

- `sessions` / `messages`
- `memory_facts` / `memory_episodes` / `diaries` / `open_loops`
- `relationship_state`
- `providers` / `models` / `role_bindings`
- `policy_entries`
- `outbox` / `jobs`
- `usage_logs` / `budget_ledger`
- `personas` / `persona_versions`
- `admin_users` / `admin_sessions` / `audit_logs`
- `stickers` / `media_assets`
- `settings`

敏感字段在写入前加密：

- `messages.text_enc` / `segments_enc` / `sender_name_enc`
- `sessions.summary_enc`
- `memory_facts.*_enc`、`memory_episodes.*_enc`、`diaries.content_enc`、`open_loops.*_enc`
- `outbox.payload_enc`、`jobs.payload_enc`
- `providers.api_key_enc`
- `settings` 中的 onebot token

加密格式 `v1.iv.tag.cipher`，AAD 绑定表/字段/行 id，防止密文被挪到别的行。

## 模型能力

`catalog/providers.yaml` 是数据；`models` 表是运行期副本。能力来源优先级：

1. 管理端手动覆盖；
2. 真实 probe 结果；
3. catalog 声明的 `input` / `features`；
4. 未知 → 按保守值（仅文本）。

视觉路径：

```text
有图
 ├─ chat.capabilities.vision ? 直接传图（imagePath=direct）
 ├─ vision 角色可用 ? 描述后注入（vision-fallback）
 └─ 都没有 ? 不传图 + 人格化说明（no-vision）
```

主模型不具备视觉时，**不会把图片块硬塞过去**。

## 记忆

- L1：最近消息 + 当前批次（token 预算内）。
- L2：滚动摘要（`sessions.summary_enc`），压缩前先 flush 事实/日记。
- L3：结构化事实、事件、日记、未闭环、关系状态。
- 检索：当前实现为按会话加载 + 关键词/重要性过滤；embedding 是可选扩展点，默认关闭。
- 恢复：新会话只需要摘要 + 事实 + 日记 + 关系，不依赖完整历史。

## 主动行为

- 60 秒 tick；先检查静默、全局每日上限、会话每日上限、最短间隔、连续未回。
- 私聊默认很保守；群聊只对 `smart/active` 且最近有活动的群低概率触发。
- 生成走 `chat` 角色，purpose=`proactive`；写入 outbox，不阻塞主流程。
- 用户回复时取消未发送的主动气泡。

## 预算

- 调用前按 prompt + max output 预估并预扣（global / session / calls）。
- 调用后按实际 usage 结算；失败释放预扣。
- 日预算、单会话预算、日 token、日调用数可配。
- 计价来自 catalog；未知价格显示 0 并标记估算。
- 详情见 `src/models/gateway.ts`、`src/models/pricing.ts`。

## 故障处理

- OneBot 断线：状态页可见；outbox 保留，恢复后重试；不盲目重发已超时的消息。
- 模型失败：按角色 fallback 链；鉴权错误不重试；预算不足停止非必要调用。
- 数据库：WAL + busy_timeout；主密钥错误会启动失败，不会新建空库覆盖。
- 记忆/日记失败：job 重试，不影响聊天。

## 扩展点

- 新 Provider：`src/models/provider.ts` 增加 kind 或直接用 OpenAI 兼容。
- 新模型：只改 `catalog/providers.yaml` 或管理端添加。
- 新 TTS：`src/media/tts.ts` 增加实现，`voiceSupported` 按平台返回。
- 新视觉：实现一个兼容 OpenAI 的视觉 Provider 即可。
- 新协议：`src/onebot` 是薄层，可替换为其他适配器。

v1 不做动态插件市场：任意插件代码会扩大攻击面。先保持 adapter/hook 级别的扩展。
