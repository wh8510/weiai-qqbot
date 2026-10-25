# 安全与威胁模型

## 保护什么

1. QQ 消息正文、发送者名、图片消息段；
2. 会话摘要、事实、日记、未闭环话题；
3. 待发送队列 / 后台任务的内容；
4. 模型 API Key、OneBot token；
5. 管理员密码与会话。

## 当前实现

- **字段级加密**：AES-256-GCM；格式 `v1.iv.tag.cipher`；AAD 绑定表/字段/行 id。
- **主密钥**：`data/master.key`（或 `BOT_MASTER_KEY`）；HKDF-SHA256 派生子密钥；文件在 POSIX 上 `chmod 600`，Windows 上用 `icacls` 限制当前用户。
- **管理员密码**：Argon2id（`@node-rs/argon2`，64 MiB / 3 次 / 1 并行）。
- **会话**：32 字节随机 token，服务端只存 SHA-256；HttpOnly Cookie；CSRF token；SameSite=Lax。
- **登录限速**：同一 IP 15 分钟最多 6 次失败。
- **API Key**：只写不读；管理端只显示是否已配置；日志 redact。
- **SSRF**：图片 URL 只允许 http/https，解析 DNS 并拒绝内网/回环/链路本地地址；限制重定向、大小、超时。
- **提示注入**：模型默认没有任何工具权限；聊天内容被视为数据；管理端命令不通过 QQ 执行。
- **审计**：登录、Provider/角色/人格/名单变更、模型探测、备份等写 `audit_logs`。

## 没有做什么（重要）

- **没有整库加密**。当前 Windows/Node 24 环境下，跨平台 SQLCipher 预编译包不稳定，默认采用字段级加密。数据库文件中的表名、时间戳、QQ 号、token 数量等元数据仍可被看到。
- **不是端到端加密**。消息会以明文发送给你配置的模型 Provider（DeepSeek/OpenAI/Claude/…）。要避免出机，请用 Ollama / vLLM 本地模型。
- **不能抵御运行中的 root**。密钥在进程内存里；攻击者拿到 root 就能读。字段加密主要防拖库、备份泄露、磁盘/快照泄露。
- **不承诺内容合规**。AI 生成内容需要使用者自行甄别；公网部署请自行加内容审核与访问控制。

## 云端加固清单

- [ ] `BOT_HOST=127.0.0.1`，前面放 Caddy/Nginx + HTTPS。
- [ ] 防火墙只开 443；管理端加 IP allowlist 或额外 basic auth。
- [ ] 全盘加密（LUKS / 云盘加密）。
- [ ] `master.key` 与数据库分开备份；备份文件加密、限权。
- [ ] 定期 `pnpm audit` / 更新依赖。
- [ ] 不要把 `data/`、`.env`、`config.yaml` 提交到 Git。
- [ ] 首次登录后删除 `data/initial-credentials.txt`。
- [ ] 不在群聊里泄露 API Key、服务器路径、内部 URL。
- [ ] 小号测试；低频；避免群发与营销。

## 密钥丢失 / 泄露

- 丢失 `master.key`：加密字段不可恢复。只能从备份恢复，或用 `cli reset-password` 重建管理员（消息仍不可读）。
- 泄露 API Key：立刻去厂商控制台吊销，重新在管理端填写。
- 泄露管理员密码：`node dist/server/cli.js reset-password`，并删除所有会话（CLI 会做）。
- 怀疑数据库被拖：轮换所有 Provider Key、OneBot token、管理员密码；检查审计日志。

## 报告漏洞

请通过仓库 issue / 私下联系维护者，不要公开可直接利用的细节。描述：影响版本、复现步骤、影响范围、建议修复。不要提交真实用户数据或 API Key。
