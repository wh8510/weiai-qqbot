import type { Store } from '../store.js';
import type { ChatMessage, ContentPart } from '../models/provider.js';
import type { Capabilities } from '../models/catalog.js';
import { buildSystemPrompt } from './persona.js';
import { estimateMessagesTokens } from '../models/pricing.js';

export interface IncomingMessage {
  senderId: string;
  senderName: string;
  text: string;
  messageId?: string | null;
  createdAt?: number;
}

export interface IncomingImage {
  mimeType: string;
  dataBase64: string;
  description?: string;
  sha256?: string;
}

export interface BuildContextInput {
  store: Store;
  session: any;
  persona: any;
  capabilities: Capabilities;
  model: any;
  incoming: IncomingMessage[];
  images: IncomingImage[];
  mentioned: boolean;
  replyToBot: boolean;
  historyBefore?: number;
  timezone: string;
  platform: string;
  voiceAvailable: boolean;
  stickersAvailable: boolean;
}

export interface BuiltContext {
  messages: ChatMessage[];
  system: string;
  usedTokens: number;
  budgetTokens: number;
  imagePath: 'direct' | 'vision-fallback' | 'no-vision' | 'none';
  summary: string;
  facts: any[];
  episodes: any[];
  diary: any | null;
  openLoops: any[];
}

function groupPrefix(session: any, message: IncomingMessage): string {
  if (session.kind !== 'group') return '';
  return `[${message.senderName || message.senderId}]: `;
}

function renderHistory(store: Store, session: any, limit = 30, before?: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  const rows = store.listMessages(session.id, limit, before);
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const row of rows) {
    if (!row.text.trim()) continue;
    if (row.direction === 'out') {
      out.push({ role: 'assistant', content: row.text });
    } else {
      const prefix = session.kind === 'group' ? `[${row.sender_name || row.sender_id}]: ` : '';
      out.push({ role: 'user', content: `${prefix}${row.text}` });
    }
  }
  return out;
}

function trimHistory(history: Array<{ role: 'user' | 'assistant'; content: string }>, maxTokens: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  const copy = [...history];
  while (copy.length > 6 && estimateMessagesTokens(copy) > maxTokens) copy.shift();
  return copy;
}

export function buildContext(input: BuildContextInput): BuiltContext {
  const { store, session, persona, capabilities } = input;
  const summary = store.getSessionSummary(session.id);
  const facts = store.listFacts(session.id, 20);
  const episodes = store.listEpisodes(session.id, 4);
  const diaries = store.listDiaries(session.id, 1);
  const diary = diaries[0] ?? null;
  const openLoops = store.listOpenLoops(session.id, 'open', 6);
  const relationship = store.getRelationship(session.id);

  const system = buildSystemPrompt({
    persona,
    session,
    capabilities,
    relationship,
    summary,
    facts,
    episodes,
    diary,
    openLoops,
    timezone: input.timezone,
    platform: input.platform,
    voiceAvailable: input.voiceAvailable,
    stickersAvailable: input.stickersAvailable,
    isGroup: session.kind === 'group',
  });

  const configuredMax = store.getSettingInt('context.max_prompt_tokens', 12000);
  const modelMax = Math.min(input.model.context_window || 32000, 24000);
  const maxPromptTokens = Math.max(2000, Math.min(configuredMax, Math.floor(modelMax * 0.7)));
  const reserveForSystem = estimateMessagesTokens([{ content: system }]);
  const history = trimHistory(renderHistory(store, session, 32, input.historyBefore), Math.max(800, maxPromptTokens - reserveForSystem - 1200));

  let imagePath: BuiltContext['imagePath'] = 'none';
  const described = input.images.filter((img) => img.description);
  const canSee = capabilities.vision;
  if (input.images.length > 0) {
    if (canSee) imagePath = 'direct';
    else if (described.length > 0) imagePath = 'vision-fallback';
    else imagePath = 'no-vision';
  }

  const lines: string[] = [];
  lines.push(`【当前这轮的消息】`);
  for (const message of input.incoming) {
    lines.push(`${groupPrefix(session, message)}${message.text || '[图片/表情]'}`);
  }
  if (input.mentioned) lines.push('（对方 @ 了你 / 明确叫了你，优先回应。）');
  if (input.replyToBot) lines.push('（对方引用了你之前说的话。）');
  if (imagePath === 'vision-fallback') {
    lines.push('', '【图像描述（你看不到原图，但系统给了你描述）】');
    for (const img of described) lines.push(`- ${img.description}`);
    lines.push('把这段描述当作你看到的内容来回应，不要提及旁路模型。');
  } else if (imagePath === 'no-vision') {
    lines.push('', '【注意】对方发了图片，但你看不到。按“看不到图片时的规则”用你的人设回应。');
  } else if (imagePath === 'direct') {
    lines.push('', '【注意】图片会直接附在这条消息里，你可以看到。');
  }

  const currentText = lines.join('\n');
  const currentParts: ContentPart[] = [{ type: 'text', text: currentText }];
  if (imagePath === 'direct') {
    for (const img of input.images) {
      currentParts.push({ type: 'image', mimeType: img.mimeType, dataBase64: img.dataBase64 });
    }
  }
  // DeepSeek (and some other JSON-mode models) occasionally returns only
  // whitespace when a long history ends on an assistant turn. A final short
  // instruction in the current user message reliably anchors the JSON plan.
  currentParts.push({ type: 'text', text: '（只输出 JSON 回复计划，不要输出空白或解释。）' });

  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: currentParts }];
  const usedTokens = estimateMessagesTokens(messages);

  return {
    messages,
    system,
    usedTokens,
    budgetTokens: maxPromptTokens,
    imagePath,
    summary,
    facts,
    episodes,
    diary,
    openLoops,
  };
}
