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

先确认服务器有 Docker 和 Compose：

```bash
docker --version
docker compose version
# 没有 Docker 的 Ubuntu/Debian：
# curl -fsSL https://get.docker.com | sh
# sudo usermod -aG docker "$USER"   # 重新登录后生效
```

把项目传到服务器（任选一种）：

```bash
# 有 Git 仓库
git clone <你的仓库地址> /opt/onebot-companion

# 或从本机上传（在 Windows 的 Git Bash / WSL 里执行）
rsync -av --exclude node_modules --exclude dist --exclude data --exclude .env \
  ./ root@47.96.164.80:/opt/onebot-companion/
```

然后：

```bash
cd /opt/onebot-companion
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f bot
```

`.env` 的最小配置（NapCat 与 bot 在同一台 Docker 主机，NapCat 以 WebSocket Server 暴露 3001）：

```env
BOT_HOST=127.0.0.1
BOT_PORT=8080
BOT_PUBLIC_URL=http://127.0.0.1:8080
BOT_DATA_DIR=/data
BOT_TRUST_PROXY=0

ONEBOT_MODE=forward
ONEBOT_URL=ws://host.docker.internal:3001
ONEBOT_PATH=/onebot/v11/ws
ONEBOT_TOKEN=换成一串足够长的随机值
```

`docker-compose.yml` 已包含：

- 只把 `127.0.0.1:8080` 映射到宿主机；
- 数据卷 `./data:/data`；
- 容器内 `BOT_DATA_DIR=/data`；
- `host.docker.internal:host-gateway`，让容器能访问宿主机上 NapCat 的 3001；
- 非 root 用户运行。

如果 `./data` 权限报错：

```bash
sudo chown -R 1000:1000 ./data
```

生产环境在前面放 Caddy/Nginx，提供 HTTPS；没有域名可以用 SSH 隧道。裸机 systemd 示例见 `deploy/onebot-companion.service`。

### 没有域名：用 SSH 隧道访问（安全）

不要把 8080 直接暴露到公网。在你自己的电脑上执行：

```bash
ssh -L 8080:127.0.0.1:8080 root@47.96.164.80
```

保持 SSH 窗口不关，本机浏览器打开：

```text
http://127.0.0.1:8080
```

### 有域名：Caddy 反代

宿主机安装 Caddy，使用 `deploy/Caddyfile`：

```caddyfile
bot.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo caddy run --config /etc/caddy/Caddyfile
```

`.env` 设置：

```env
BOT_PUBLIC_URL=https://bot.example.com
BOT_TRUST_PROXY=1
BOT_FORCE_HTTPS=1
```

如果想让 Caddy 也跑在 Compose 里，取消 `docker-compose.yml` 里的 caddy 服务注释，使用 `deploy/Caddyfile.docker`（反代 `bot:8080`）。

## 3. 首次登录

```bash
# 初始密码在容器数据卷里；首次启动日志也会打印一次
docker compose exec bot cat /data/initial-credentials.txt
```

打开管理端，登录后立刻改密码，然后删除凭据文件：

```bash
docker compose exec bot rm -f /data/initial-credentials.txt
```

## 4. NapCat 连接

### 你的场景：NapCat 是 WebSocket Server（正向）

NapCat 网络配置里启用 **WebSocket Server**，Host `0.0.0.0`、Port `3001`、消息格式 `Array`，设置 token。

本程序用 forward 模式主动连它：

```env
ONEBOT_MODE=forward
ONEBOT_URL=ws://host.docker.internal:3001
ONEBOT_TOKEN=与 NapCat 一致的 token
```

`host.docker.internal` 由 Compose 的 `extra_hosts` 提供；如果 NapCat 在另一台机器，改成 `ws://<napcat内网IP>:3001`，并用安全组只放行 bot 的出口 IP。

### 另一种：NapCat 是 WebSocket Client（反向）

NapCat 新建 **WebSocket 客户端**，URL 填：

```text
ws://<bot-host>:8080/onebot/v11/ws
# 有域名+Caddy 时：
wss://bot.example.com/onebot/v11/ws
```

Token 与 `ONEBOT_TOKEN` 一致，消息格式 `array`，启用私聊/群聊/心跳。

### 安全组 / 防火墙

- 公网只开 `22`、`80`、`443`（或只开 443 + SSH 隧道）。
- **不要**把 `8080`、`3001`、`6099` 直接暴露公网。
- 如果 NapCat 在同一台机器，`3001` 只需本机/容器可达；安全组不要放行 3001。
- 不要把 NapCat 的 WebUI / OneBot 端口裸奔在公网。

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
