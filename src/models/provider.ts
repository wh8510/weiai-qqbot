import type { ModelRow, ProviderRow } from '../store.js';
import { featureList } from './catalog.js';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; dataBase64: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatRequest {
  provider: ProviderRow;
  model: ModelRow;
  apiKey: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  purpose?: string;
  timeoutMs?: number;
  estimatedPromptTokens?: number;
  thinking?: 'enabled' | 'disabled';
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  imageTokens: number;
  estimated: boolean;
}

export interface ChatResponse {
  text: string;
  usage: ChatUsage;
  latencyMs: number;
  raw?: any;
}

export class ProviderError extends Error {
  status: number;
  body: string;
  retryable: boolean;

  constructor(message: string, status = 0, body = '', retryable = false) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.body = body.slice(0, 2000);
    this.retryable = retryable || status === 429 || status >= 500;
  }
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function headersFor(provider: ProviderRow, apiKey: string): Record<string, string> {
  const base: Record<string, string> = { 'content-type': 'application/json' };
  if (provider.kind === 'anthropic') {
    base['x-api-key'] = apiKey;
    base['anthropic-version'] = '2023-06-01';
  } else if (provider.kind === 'gemini') {
    // Gemini uses ?key=, no Authorization header.
  } else {
    base.authorization = `Bearer ${apiKey}`;
  }
  if (provider.extra_headers_json) {
    try {
      Object.assign(base, JSON.parse(provider.extra_headers_json));
    } catch {
      // ignore malformed optional headers
    }
  }
  return base;
}

function openAiContent(content: string | ContentPart[]): any {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : {
          type: 'image_url',
          image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` },
        },
  );
}

function anthropicContent(content: string | ContentPart[]): any {
  if (typeof content === 'string') return content;
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : {
          type: 'image',
          source: { type: 'base64', media_type: part.mimeType, data: part.dataBase64 },
        },
  );
}

function geminiParts(content: string | ContentPart[]): any[] {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((part) =>
    part.type === 'text'
      ? { text: part.text }
      : { inlineData: { mimeType: part.mimeType, data: part.dataBase64 } },
  );
}

function parseOpenAiText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
      .filter(Boolean)
      .join('');
  }
  if (typeof data?.choices?.[0]?.text === 'string') return data.choices[0].text;
  return '';
}

function parseOpenAiUsage(data: any, estimatedPrompt: number): ChatUsage {
  const usage = data?.usage ?? {};
  const prompt = usage.prompt_tokens ?? usage.input_tokens ?? estimatedPrompt;
  const completion = usage.completion_tokens ?? usage.output_tokens ?? 0;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens ?? 0,
    imageTokens: usage.prompt_tokens_details?.image_tokens ?? 0,
    estimated: usage.prompt_tokens === undefined && usage.input_tokens === undefined,
  };
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function openAiChat(req: ChatRequest): Promise<ChatResponse> {
  const started = Date.now();
  const base = trimBase(req.provider.base_url);
  const url = `${base}/chat/completions`;
  const hasJson = featureList(req.model).includes('json');
  const isGpt6 = req.model.model_id.startsWith('gpt-6');
  const body: any = {
    model: req.model.model_id,
    messages: req.messages.map((m) => ({ role: m.role, content: openAiContent(m.content) })),
    stream: false,
  };
  // GPT-6 reasoning endpoints are picky about sampling parameters; leave the
  // provider default unless the caller explicitly needs a value.
  if (!isGpt6) body.temperature = req.temperature ?? 0.8;
  if (req.maxTokens) {
    if (isGpt6) body.max_completion_tokens = req.maxTokens;
    else body.max_tokens = req.maxTokens;
  }
  // DeepSeek V4.x defaults to thinking mode, which can consume the entire
  // small max_tokens budget in reasoning_content and leave content empty.
  // Short chat/probe calls use non-thinking mode unless explicitly requested.
  if (req.model.model_id.startsWith('deepseek-') && req.thinking !== 'enabled') {
    body.thinking = { type: 'disabled' };
  }
  if (req.json && hasJson) body.response_format = { type: 'json_object' };
  if (req.purpose === 'probe') body.temperature = 0;

  const response = await fetch(url, {
    method: 'POST',
    headers: headersFor(req.provider, req.apiKey),
    body: JSON.stringify(body),
    signal: timeoutSignal(req.timeoutMs ?? 90_000),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new ProviderError(
      `OpenAI-compatible ${response.status}: ${data?.error?.message ?? data?.message ?? response.statusText}`,
      response.status,
      JSON.stringify(data),
    );
  }
  return {
    text: parseOpenAiText(data),
    usage: parseOpenAiUsage(data, req.estimatedPromptTokens ?? 0),
    latencyMs: Date.now() - started,
    raw: data,
  };
}

async function anthropicChat(req: ChatRequest): Promise<ChatResponse> {
  const started = Date.now();
  const base = trimBase(req.provider.base_url);
  const url = `${base}/v1/messages`;
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')))
    .join('\n\n');
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: anthropicContent(m.content) }));
  const body: any = {
    model: req.model.model_id,
    max_tokens: req.maxTokens ?? 1024,
    temperature: req.temperature ?? 0.8,
    messages,
  };
  if (system) body.system = system;
  const response = await fetch(url, {
    method: 'POST',
    headers: headersFor(req.provider, req.apiKey),
    body: JSON.stringify(body),
    signal: timeoutSignal(req.timeoutMs ?? 90_000),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new ProviderError(
      `Anthropic ${response.status}: ${data?.error?.message ?? response.statusText}`,
      response.status,
      JSON.stringify(data),
    );
  }
  const text = Array.isArray(data.content)
    ? data.content.map((p: any) => (p.type === 'text' ? p.text : '')).join('')
    : '';
  return {
    text,
    usage: {
      promptTokens: data.usage?.input_tokens ?? req.estimatedPromptTokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      cachedTokens: data.usage?.cache_read_input_tokens ?? 0,
      reasoningTokens: 0,
      imageTokens: 0,
      estimated: !data.usage,
    },
    latencyMs: Date.now() - started,
    raw: data,
  };
}

async function geminiChat(req: ChatRequest): Promise<ChatResponse> {
  const started = Date.now();
  const base = trimBase(req.provider.base_url);
  const url = `${base}/models/${encodeURIComponent(req.model.model_id)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n\n');
  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: geminiParts(m.content),
    }));
  const body: any = {
    contents,
    generationConfig: {
      temperature: req.temperature ?? 0.8,
      maxOutputTokens: req.maxTokens ?? 1024,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (req.json) body.generationConfig.responseMimeType = 'application/json';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: timeoutSignal(req.timeoutMs ?? 90_000),
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new ProviderError(
      `Gemini ${response.status}: ${data?.error?.message ?? response.statusText}`,
      response.status,
      JSON.stringify(data),
    );
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p.text ?? '')
    .join('');
  return {
    text,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount ?? req.estimatedPromptTokens ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      cachedTokens: data.usageMetadata?.cachedContentTokenCount ?? 0,
      reasoningTokens: data.usageMetadata?.thoughtsTokenCount ?? 0,
      imageTokens: 0,
      estimated: !data.usageMetadata,
    },
    latencyMs: Date.now() - started,
    raw: data,
  };
}

function mockTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === 'text' ? part.text : part?.type === 'image' ? '[图片]' : ''))
      .join('\n');
  }
  return '';
}

function mockChat(req: ChatRequest): ChatResponse {
  const last = [...req.messages].reverse().find((m) => m.role === 'user');
  const input = mockTextContent(last?.content);
  let text = '嗯，我在。';
  if (req.purpose === 'probe-text') text = 'OK';
  else if (req.purpose === 'probe-vision') text = 'A7';
  else if (req.purpose === 'probe-json') text = '{"ok":true}';
  else if (req.purpose === 'vision') {
    text = input.includes('[图片]') || input.includes('描述')
      ? '图片里有一张浅色背景的截图/画面，能看到红色和蓝色的形状，底部有文字 A7。整体像是在测试视觉能力。'
      : '一张普通的图片，画面比较简洁。';
  } else if (req.purpose === 'memory') {
    text = JSON.stringify({
      summary: '我们在轻松地聊天，对方看起来有点累，但愿意继续说话。',
      facts: [{ subject: '用户', predicate: '状态', object: '有点累', confidence: 0.6, importance: 0.5 }],
      episodes: [],
      open_loops: [],
      mood: 'gentle',
    });
  } else if (req.purpose === 'proactive') {
    text = JSON.stringify({ silent: false, bubbles: ['刚才突然想到你，今天还顺利吗'] });
  } else if (input.includes('看不到图片') || input.includes('你看不到') || input.includes('看不到原图')) {
    text = JSON.stringify({ silent: false, bubbles: ['我这边看不到图', '你跟我说说图里是什么好不好'] });
  } else if (input.includes('图像描述')) {
    text = JSON.stringify({ silent: false, bubbles: ['我看到了，', '感觉挺有意思的'] });
  } else if (input.includes('你好') || input.includes('在吗')) {
    text = JSON.stringify({ silent: false, bubbles: ['在呢', '怎么啦'] });
  } else if (input.includes('累')) {
    text = JSON.stringify({ silent: false, bubbles: ['怎么了', '又加班？'], sticker: '安慰' });
  } else if (input.includes('图')) {
    text = JSON.stringify({ silent: false, bubbles: ['我看到啦，这张图有点意思'] });
  } else {
    text = JSON.stringify({ silent: false, bubbles: ['嗯嗯，我在听', '你继续说'] });
  }
  return {
    text,
    usage: {
      promptTokens: 10,
      completionTokens: 10,
      cachedTokens: 0,
      reasoningTokens: 0,
      imageTokens: 0,
      estimated: true,
    },
    latencyMs: 1,
  };
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  if (req.provider.kind === 'mock') return mockChat(req);
  if (req.provider.kind === 'anthropic') return anthropicChat(req);
  if (req.provider.kind === 'gemini') return geminiChat(req);
  return openAiChat(req);
}
