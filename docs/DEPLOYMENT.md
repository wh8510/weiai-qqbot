# 部署

## 1. Windows（本地/半生产）

前置：Node.js 22+、pnpm 9+。

```powershell
cd E:\bot
.\scripts\setup.ps1
.\scripts\start.bat
```

- 管理端：<http://127.0.0.1:8080>
- 数据：`data/`（主密钥、SQLite、媒体、TTS 缓存）
- 首次启动看 `data/initial-credentials.txt`
- 语音：Windows SAPI 可用；Linux 不可用

开机自启可用 NSSM 把 `node dist/server/index.js` 注册为服务，工作目录设为项目根目录。

## 2. Linux Docker（推荐）

```bash
cp .env.example .env
# 修改 ONEBOT_TOKEN、BOT_PUBLIC_URL、模型 key
docker compose up -d --build
```

`docker-compose.yml` 默认：

- 只把 `127.0.0.1:8080` 映射到宿主机；
- 数据卷 `./data:/data`；
- 容器内 `BOT_DATA_DIR=/data`；
- 非 root 用户运行。

生产环境在前面放 Caddy/Nginx，提供 HTTPS 和 WSS。裸机 systemd 示例见 `deploy/onebot-companion.service`。

## 3. Caddy 反代示例

`Caddyfile`：

```caddyfile
bot.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
```

Caddy 会自动处理 WebSocket。然后：

```bash
caddy run --config Caddyfile
```

`.env` 设置：

```env
BOT_PUBLIC_URL=https://bot.example.com
BOT_TRUST_PROXY=1
BOT_FORCE_HTTPS=1
```

管理端和 OneBot 走同一个域名；NapCat 的反向 WS 地址填：

```text
wss://bot.example.com/onebot/v11/ws
```

## 4. NapCat 连接

### 反向 WS（推荐）

NapCat WebUI → 网络配置 → 新建 → **WebSocket 客户端**：

- URL：`ws://<bot-host>:8080/onebot/v11/ws` 或 `wss://bot.example.com/onebot/v11/ws`
- Token：与 `.env` 的 `ONEBOT_TOKEN` 一致
- 消息格式：`array`
- 启用：私聊消息、群聊消息、心跳

反向 WS 对云端最友好：NapCat 主动连出，不需要给 NapCat 开入站端口。

### 正向 WS

NapCat 开启 WebSocket 服务端（例如 `ws://127.0.0.1:3001`），本程序：

```env
ONEBOT_MODE=forward
ONEBOT_URL=ws://127.0.0.1:3001
ONEBOT_TOKEN=...
```

或在管理端「系统设置 → OneBot」切换，保存后重启进程。

### 同机 / 跨机

- 同机：`ws://127.0.0.1:8080/...`；Docker 内 NapCat 用 `ws://host.docker.internal:8080/...`（Windows/Mac）或宿主机内网 IP。
- 跨机：优先 Tailscale/WireGuard 内网；否则 `wss://` + token + 防火墙只放行 NapCat 出口 IP。
- 不要把 NapCat 的 WebUI / OneBot 端口直接裸奔在公网。

## 5. 首次配置顺序

1. 登录管理端，改密码。
2. 「模型与密钥」填 DeepSeek / OpenAI / Claude / Kimi / Qwen 等 Key，启用 Provider。
3. 角色绑定：
   - `chat`：主对话（建议 DeepSeek Flash 这类便宜且支持视觉的）；
   - `vision`：看图（可与 chat 相同）；
   - `memory`：摘要/事实/日记（便宜、支持 JSON）；
   - `classifier`：群聊判断（可选）。
4. 「名单」加私聊白名单 / 群白名单；否则默认拒绝。
5. 「人格」调人设、风格、边界、看不了图时的说法。
6. 「主动行为」按需开；先用默认保守值。
7. 「系统设置」设 Owner QQ、日预算、静默时段。
8. 在「调试台」先聊几句；确认没问题再接 QQ。

## 6. 数据与备份

- `data/master.key`：**必须备份**。丢失后加密字段不可恢复。
- `data/companion.db`：SQLite；敏感字段加密。
- `data/media/`、`data/stickers/`、`data/tts/`：媒体与缓存。
- 备份：
  ```bash
  node dist/server/cli.js backup
  ```
  生成 `data/backups/companion-*.db`；恢复时同时保留同一个 `master.key`。
- 升级前先备份；升级后启动会自动跑迁移。

## 7. 升级

```bash
git pull
pnpm install
pnpm build
# 重启进程或 docker compose up -d --build
```

数据库迁移是向前兼容的；升级前请备份。模型目录更新只需改 `catalog/providers.yaml` 或在管理端添加，不需要发版。

## 8. 反向代理 / 防火墙清单

- 只开 443（或内网 Tailscale）。
- 管理端路径建议加 IP allowlist 或基础认证（Caddy `basicauth`）。
- 不暴露 8080、3000、3001、6099。
- `BOT_HOST=127.0.0.1` + Caddy 是最稳的默认。
- 定期备份 `master.key` 和数据库；备份文件本身也要加密/限权。

## 9. 常见部署问题

**页面 502**：程序没起或端口不对；看 `docker compose logs -f` / 控制台。

**NapCat 连不上**：
- token 是否一致；
- 路径是否 `/onebot/v11/ws`；
- 反向 WS 是 NapCat 连本程序，不是反过来；
- 跨机是否被防火墙拦；
- HTTPS 页面不能用 `ws://`，必须 `wss://`。

**能连上但没反应**：
- 名单是否为空（默认拒绝）；
- 群模式是否 `mention_only`；
- Provider 是否启用、角色是否绑定、Key 是否配置；
- 看总览页的「最近事件」和错误。

**语音不工作**：
- 只有 Windows 有本地 SAPI；
- Linux 显示不可用是预期；
- QQ 语音需要 silk，程序会先本地转码，仍以真实 NapCat 联调为准。
