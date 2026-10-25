# 模型能力目录

模型名、上下文、价格、是否支持图片，变化非常快。本项目把模型信息放在 **数据** 里：

- `catalog/providers.yaml`：Provider 预设 + 模型快照；
- 管理端「模型与密钥」：可以覆盖、探测、添加自定义模型；
- 运行时按 `catalog / probe / 手动覆盖` 三层解析能力。

**不要**把模型名硬编码进业务逻辑。更新模型只需要改 YAML 或管理端。

## 2026-10 快照（示例，不是永久事实）

| 厂商 | 代表模型 | 图片 | 上下文 | 备注 |
|---|---|---:|---:|---|
| DeepSeek | `deepseek-flash` | ✅ | 1M | V4.1 Flash；JSON/tools；图片约 1024 tokens/张 |
| DeepSeek | `deepseek-v4-pro` | ❌ | 1M | 文本旗舰；看图需旁路或人设说明 |
| OpenAI | `gpt-6-astra` / `gpt-6-sol` / `gpt-6-luna` | ✅ | 1.05M | Astra 最强，Luna 最便宜 |
| Anthropic | `claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5` | ✅ | 1M | Opus 最强，Haiku 最便宜 |
| Google | `gemini-4-argon` | ✅ | 1M | 图片/音频/视频/文件输入 |
| Moonshot | `kimi-k3.1-pro` / `kimi-k2.6` | ✅ | 1M / 256K | K2.7 Code 偏代码，非视觉 |
| 阿里 | `qwen3.8-max` | ✅ | 1M | 图片 + 视频；中文场景强 |
| 智谱 | `glm-5.3` | ✅ | 1M | 多模态 |
| MiniMax | `minimax-m3.1` | ✅ | 1M | 图片 + 视频 |
| xAI | `grok-4.7` | ✅ | 500K | 图片/文件 |
| OpenRouter | 任意 | 取决于模型 | 取决于模型 | 一个 key 覆盖长尾模型 |
| Ollama | 本地模型 | 取决于模型 | 取决于显存 | 隐私最好 |

来源：

- DeepSeek 模型/价格 <https://api-docs.deepseek.com/zh-cn/quick_start/pricing>
- DeepSeek 图像理解 <https://api-docs.deepseek.com/zh-cn/guides/vision>
- Kimi 模型列表 <https://platform.kimi.com/docs/models>
- Qwen3.8-Max <https://partners-intl.aliyun.com/help/zh/model-studio/qwen3-8-max>
- Claude Opus <https://www.anthropic.com/claude/opus>
- Claude Sonnet <https://www.anthropic.com/claude/sonnet>
- Claude Haiku <https://www.anthropic.com/claude/haiku>
- GPT-6 系列 <https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/gpt-6>
- 公开模型快照 <https://openrouter.ai/api/v1/models>

## 能力探测

管理端「模型与密钥」→ 某个模型「探测」：

1. **文本**：要求回复 `OK`；
2. **JSON**：要求返回 `{"ok":true}`；
3. **视觉**：发一张本地生成的测试图（红色圆 + 蓝色方块 + 字符 `A7`），要求读出 `A7`；
4. 记录 `text/json/vision/tools`、延迟、错误、时间戳。

探测不通过不一定代表模型永远不行（网络、限流、临时故障）；可以手动覆盖。能力未知时按“不支持图片”处理，避免 400 和胡说。

## 视觉的三条路径

| 情况 | 行为 |
|---|---|
| `chat` 模型有视觉 | 图片作为 image block 直接传入；prompt 说“你可以看到” |
| `chat` 无视觉，`vision` 角色可用 | 先用视觉模型生成描述，再注入主模型；prompt 说“把它当作你看到的” |
| 都没有 | 不传图；prompt 说“你看不到”，模型按人格承认/让对方描述 |

**绝不**把图片块硬塞给不支持视觉的模型。

## 更新目录

```yaml
- id: my-model
  name: My Model
  context: 128000
  maxOutput: 8192
  input: [text, image]
  features: [json, tools, streaming]
  pricing:
    currency: CNY
    input: 1
    output: 4
    cacheRead: 0.02
  source: https://provider.example/docs/models
  status: active
```

- 新增 Provider：`providers:` 下加一项，填 `kind`（`openai` / `anthropic` / `gemini` / `mock`）与 `baseUrl`。
- 模型被下线：`status: deprecated`，填 `successor`。
- 价格未知：`pricing: null`，管理端会显示“未配置价格”，预算按 0 处理并标记估算。
- 改完重启进程；运行期也可以直接改数据库/管理端。

## 价格与预算

- 价格单位：每 100 万 tokens。
- `peak` 可选；目前按北京时间工作日 9:00–12:00、14:00–18:00 判断高峰，**不内置中国法定节假日表**；需要精确时请自行改价或扩展 `isPeakNow`。
- 汇率：管理端「系统设置」配置 `USD → CNY`，默认 7.2。
- 图片 token 因厂商而异；预算按实际 usage 结算，预扣时图片按约 1024 tokens 估算。
