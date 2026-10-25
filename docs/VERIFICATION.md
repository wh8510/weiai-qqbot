# 交付验证记录

日期：2026-10-25  
版本：`0.1.0`

## 已执行

| 项目 | 命令 / 方式 | 结果 |
|---|---|---|
| TypeScript | `pnpm typecheck` | 通过 |
| 单元 / 集成测试 | `pnpm test` | 10 个文件，46 个用例全部通过（含 API 鉴权/CSRF/密钥脱敏、主动消息、群注意力） |
| 服务端构建 | `pnpm build:server` | 通过（`dist/server/index.js` + `cli.js`） |
| 前端构建 | `pnpm build:web` | 通过（`dist/web`） |
| 管理端 UI | Playwright + 系统 Chrome | 登录、改密、11 个页面、调试台真实回复，全部通过 |
| OneBot 反向 WS | `node scripts/smoke-onebot.mjs` | 模拟 NapCat 连入，收到私聊事件，发送 2 条气泡，落库成功 |
| Windows TTS | `synthesizeSilk('你好，今天怎么样')` | SAPI 生成 WAV，`silk-wasm` 编码成功（179 KB） |
| 首次生产启动 | 无 `.env` / 无数据目录 | 自动生成主密钥、管理员、初始密码文件；`/api/health` 正常 |
| CLI | `doctor` / `backup` / `key-fingerprint` | 通过 |

## 未执行 / 需要你提供

| 项目 | 原因 |
|---|---|
| 真实 NapCat 联调 | 需要你云端 NapCat 的 WS URL / token / 可达网络 |
| 真实 DeepSeek / OpenAI / Claude / Kimi / Qwen 调用 | 需要对应 API Key；代码已按 Provider 适配，Demo 用 mock 验证 |
| Docker 构建 | 当前开发机没有安装 Docker |
| 群聊 @ / 图片 / 语音真实发送 | 需要真实 NapCat；逻辑和 mock 路径已覆盖 |
| 备份恢复演练 | CLI 备份已生成；恢复流程需要实际数据目录演练 |

## 真实 NapCat 联调清单（拿到 URL/token 后）

1. `.env` 设置 `ONEBOT_MODE`、`ONEBOT_URL` 或反向 WS token。
2. 启动程序，确认「总览 → OneBot 连接」为已连接。
3. 「模型与密钥」填 DeepSeek Key，启用 Provider，`chat` 绑定 `deepseek-flash`。
4. 「名单」加你的 QQ 白名单；群聊加群号并设置模式。
5. 私聊发“你好”，确认回复；再发“今天好累”，确认 1~4 条分条。
6. 群里 @ 机器人，确认回复；非 @ 时确认默认沉默。
7. 发一张图片，确认：
   - `deepseek-flash` 主模型：直接理解；
   - 切到 `deepseek-v4-pro` 且 `vision` 未绑定：按人格说“看不到”；
   - 绑定 `vision` 到 Flash：走描述旁路。
8. Windows 上确认语音（如果开启）；Linux 显示不可用是预期。
9. 检查「用量与预算」是否开始记账。
10. 检查 `data/initial-credentials.txt` 是否已删除、`master.key` 是否备份。
