# 交付验证记录

日期：2026-10-26  
版本：`0.1.0`

## 已执行

| 项目 | 命令 / 方式 | 结果 |
|---|---|---|
| TypeScript | `pnpm typecheck` | 通过 |
| 单元 / 集成测试 | `pnpm test` | 10 个文件，47 个用例全部通过（含 API 鉴权/CSRF/Key 显示、主动消息、群注意力） |
| 服务端构建 | `pnpm build:server` | 通过（`dist/server/index.js` + `cli.js`） |
| 前端构建 | `pnpm build:web` | 通过（`dist/web`） |
| 管理端 UI | Playwright + 系统 Chrome | 登录、改密、11 个页面、调试台真实回复，全部通过 |
| OneBot 反向 WS | `node scripts/smoke-onebot.mjs` | 模拟 NapCat 连入，收到私聊事件，发送 2 条气泡，落库成功 |
| 真实 NapCat 正向 WS | `ws://47.96.164.80:3001` | 已连接，`self_id=2798165022`（唯爱），心跳正常 |
| 真实 QQ 私聊往返 | QQ `2984339053` 发送“你好” | 收到消息并回复 2 条，落库成功（当时为 mock 模型） |
| 真实 DeepSeek 探测 | `deepseek:deepseek-flash` | 文本 / JSON / 视觉（A7 测试图）全部通过 |
| 真实 DeepSeek 对话 | 管理端调试台 | 返回中文 2 条气泡，成本记账 `¥0.00066`，无空回复 |
| Key 规范化 | 修复 `空格 + 额外后缀` | 保存时取第一个空白前 token；管理端显示 Key 尾号，避免再次误存 |
| Key 查看 / 模型选择 | 浏览器自动化 | 配置弹窗显示尾号/长度并可「显示」完整 Key；DeepSeek 下拉包含 Flash/Pro，Pro 的「设为看图」禁用；UI 切换并恢复角色成功 |
| Windows TTS | `synthesizeSilk('你好，今天怎么样')` | SAPI 生成 WAV，`silk-wasm` 编码成功（179 KB） |
| 首次生产启动 | 无 `.env` / 无数据目录 | 自动生成主密钥、管理员、初始密码文件；`/api/health` 正常 |
| CLI | `doctor` / `backup` / `key-fingerprint` | 通过 |

## 未执行 / 需要你提供

| 项目 | 原因 |
|---|---|
| Docker 构建 | 当前开发机没有安装 Docker |
| 群聊 @ / 图片 / 语音真实发送 | 需要你在测试群/私聊实际触发；已配置白名单和 DeepSeek 视觉 |
| 备份恢复演练 | CLI 备份已生成；恢复流程需要实际数据目录演练 |

## 真实 NapCat 联调清单（当前进度）

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
