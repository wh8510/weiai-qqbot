import type { Capabilities } from '../models/catalog.js';
import type { Store } from '../store.js';

export interface PromptFacts {
  persona: any;
  session: any;
  capabilities: Capabilities;
  relationship: any;
  summary: string;
  facts: any[];
  episodes: any[];
  diary: any | null;
  openLoops: any[];
  timezone: string;
  platform: string;
  voiceAvailable: boolean;
  stickersAvailable: boolean;
  isGroup: boolean;
}

function fmtRelationship(rel: any): string {
  const affinity = Number(rel?.affinity ?? 0.2);
  const stage = affinity > 0.75 ? '很熟、比较亲近' : affinity > 0.5 ? '算熟了' : affinity > 0.25 ? '认识但不深' : '还比较陌生';
  return `关系阶段：${stage}；信任度：${Math.round(Number(rel?.trust ?? 0.3) * 100)}%；你当前的心情：${rel?.mood ?? 'neutral'}；精力：${Math.round(Number(rel?.energy ?? 0.7) * 100)}%。`;
}

function fmtMemory(input: PromptFacts): string {
  const parts: string[] = [];
  if (input.summary) parts.push(`【之前聊过什么】\n${input.summary}`);
  if (input.facts.length) {
    parts.push(
      `【你记得的事实】\n${input.facts
        .slice(0, 12)
        .map((f) => `- ${f.subject} ${f.predicate} ${f.object}`)
        .join('\n')}`,
    );
  }
  if (input.episodes.length) {
    parts.push(
      `【最近发生的事】\n${input.episodes
        .slice(0, 4)
        .map((e) => `- ${e.title}：${e.summary}`)
        .join('\n')}`,
    );
  }
  if (input.diary) parts.push(`【你最近的日记】\n${input.diary.content}`);
  if (input.openLoops.length) {
    parts.push(
      `【还没聊完的事】\n${input.openLoops
        .slice(0, 5)
        .map((l) => `- ${l.topic}：${l.detail}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

function capabilityBlock(input: PromptFacts): string {
  const lines: string[] = [];
  lines.push(`图片输入：${input.capabilities.vision ? '支持，你可以直接看到对方发的图片' : '不支持，你看不到图片'}`);
  lines.push(`语音输出：${input.voiceAvailable ? '支持，但只在合适的时候用' : '不支持，不要承诺发语音'}`);
  lines.push(`表情包：${input.stickersAvailable ? '支持，可以在合适的时候发表情包' : '当前没有可用表情包，不要承诺发'}`);
  lines.push(`长期记忆：${input.facts.length || input.diary || input.summary ? '支持，你记得之前的事' : '暂时没有可用的长期记忆'}`);
  lines.push('实时联网：不支持，不要谎称刚查过网络');

  if (!input.capabilities.vision) {
    lines.push(
      [
        '',
        '【看不到图片时的规则】',
        '- 不要声称自己看到了图片，不要编造画面内容。',
        '- 用你的人设自然表达：可以让对方描述、可以撒娇、可以吐槽、可以转移话题。',
        '- 不要说“我是语言模型 / 我没有多模态能力”这类技术解释，除非对方认真追问。',
        `- 可参考的说话风格：${input.persona.no_vision_lines || '我这边看不到图，你跟我说说图里是什么好不好？'}`,
        '- 如果系统提供了 OCR 文本或图像描述，只能基于那段文字回应，不要扩写不存在的画面。',
      ].join('\n'),
    );
  } else {
    lines.push('', '你能看到图片时，自然评论画面内容，不要描述“我收到了一个 image block”。');
  }
  return lines.join('\n');
}

export function buildSystemPrompt(input: PromptFacts): string {
  const persona = input.persona;
  const scene = input.isGroup
    ? '你在一个 QQ 群里。群里可能有多个人说话。你不是每句都要接，默认先观察；只有被 @、被回复、或话题真的让你想说话时才开口。不要刷屏，不要 @全体。'
    : '你在和对方私聊。对方的消息默认是发给你一个人的。';

  return [
    persona.system_prompt,
    '',
    '【你的表达习惯】',
    persona.style_examples || '',
    '',
    '【边界】',
    persona.boundaries || '不假装拥有系统没有的能力；不索要隐私；不刷屏。',
    '',
    '【当前场景】',
    scene,
    `当前时间：${new Date().toLocaleString('zh-CN', { timeZone: input.timezone })}（${input.timezone}）`,
    `运行平台：${input.platform}`,
    '',
    '【当前能力清单】',
    capabilityBlock(input),
    '',
    '【你和对方的关系】',
    fmtRelationship(input.relationship),
    '',
    fmtMemory(input),
    '',
    '【输出要求】',
    '只输出一个 JSON 对象，不要 Markdown，不要代码围栏：',
    '{"silent":false,"bubbles":["第一条","第二条"],"sticker":"","quote":false,"voice":false}',
    '- bubbles 最多 4 条，每条尽量 2~30 个字，最多 80 字。',
    '- 如果这次不想说话，输出 {"silent":true,"bubbles":[]}。',
    '- sticker 只能是：开心、无语、安慰、猫猫、害羞、生气、困、惊讶之一，或留空。',
    '- quote=true 表示引用对方刚发的那条消息；私聊一般不引用。',
    '- voice=true 只在你想发语音且系统支持时使用。',
    '- 不要在 bubble 里写“第一条/第二条”，不要解释 JSON。',
  ]
    .filter(Boolean)
    .join('\n');
}
