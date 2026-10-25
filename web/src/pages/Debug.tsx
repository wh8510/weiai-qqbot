import React, { useEffect, useRef, useState } from 'react';
import { get, post } from '../api';
import { Alert, Badge, Button, Card, ChatBubble, Field, PageHeader, Select, Spinner, TextArea } from '../components';

interface LocalMessage {
  id: string;
  role: 'user' | 'bot' | 'note';
  text: string;
  at: number;
  meta?: string;
}

export default function Debug() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [selected, setSelected] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastMeta, setLastMeta] = useState<any>(null);
  const [image, setImage] = useState<{ mimeType: string; dataBase64: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    get('/api/sessions').then((d) => {
      const list = d.sessions ?? [];
      setSessions(list);
      const preferred =
        list.find((s: any) => s.kind === 'private' && s.peer_id === 'debug') ??
        list.find((s: any) => s.kind === 'private' && (s.message_count ?? 0) > 0) ??
        list.find((s: any) => s.kind === 'private') ??
        list[0];
      if (preferred) setSelected(preferred.id);
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if ((!text && !image) || loading) return;
    const attached = image;
    setInput('');
    setImage(null);
    setError('');
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: text || '[图片]', at: Date.now() }]);
    setLoading(true);
    try {
      const result = await post('/api/debug/chat', {
        sessionId: selected || undefined,
        text,
        images: attached ? [{ mimeType: attached.mimeType, dataBase64: attached.dataBase64 }] : [],
      });
      if (result.sessionId) setSelected(result.sessionId);
      setLastMeta(result);
      if (result.silent || !result.bubbles?.length) {
        setMessages((prev) => [...prev, { id: `n-${Date.now()}`, role: 'note', text: '她这次选择沉默。', at: Date.now() }]);
      } else {
        for (let i = 0; i < result.bubbles.length; i += 1) {
          await new Promise((r) => setTimeout(r, i === 0 ? 250 : 500));
          setMessages((prev) => [...prev, {
            id: `b-${Date.now()}-${i}`,
            role: 'bot',
            text: result.bubbles[i],
            at: Date.now(),
            meta: i === 0 ? `${result.model} · ${result.capabilityPath}` : undefined,
          }]);
        }
      }
      const list = await get('/api/sessions');
      setSessions(list.sessions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="调试台"
        description="直接走真实对话运行时，但不会发到 QQ。用来先看人格、分条、记忆和模型能力。"
        actions={<Button variant="ghost" onClick={() => setMessages([])} disabled={!messages.length}>清空本地记录</Button>}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="debug-layout" style={{ marginTop: 16 }}>
        <Card className="chat-panel" title="对话" subtitle="和 QQ 里用的是同一套 prompt / 记忆 / 能力判断">
          <div className="chat-scroll" ref={scroller} style={{ margin: '-16px -18px 0', minHeight: 380 }}>
            {messages.length === 0 && !loading ? (
              <div className="empty">
                <div className="empty-glyph">⌁</div>
                <h3>先发一句试试</h3>
                <p>比如“今天好累”“在吗”“给我看看你拍的猫”。Demo 模式不需要 API Key。</p>
              </div>
            ) : null}
            {messages.map((m) => m.role === 'note' ? (
              <div key={m.id} className="alert alert-warn" style={{ alignSelf: 'center', maxWidth: 420 }}>{m.text}</div>
            ) : (
              <ChatBubble key={m.id} direction={m.role === 'bot' ? 'out' : 'in'} name={m.role === 'bot' ? '她' : '你'} text={m.text} at={m.at} />
            ))}
            {loading ? (
              <div className="bubble-row in">
                <div className="bubble bubble-in">
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  <span className="faint small" style={{ marginLeft: 8 }}>正在想…</span>
                </div>
              </div>
            ) : null}
          </div>
          {image ? (
            <div className="row" style={{ padding: '8px 12px', borderTop: '1px solid var(--border-soft)' }}>
              <Badge tone="blue">附图</Badge>
              <span className="small muted">{image.name}</span>
              <Button size="sm" variant="ghost" onClick={() => setImage(null)}>移除</Button>
            </div>
          ) : null}
          <div className="chat-input">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const result = String(reader.result ?? '');
                  const base64 = result.split(',')[1] ?? '';
                  if (base64) setImage({ mimeType: file.type || 'image/png', dataBase64: base64, name: file.name });
                };
                reader.readAsDataURL(file);
                e.target.value = '';
              }}
            />
            <Button variant="ghost" onClick={() => fileRef.current?.click()} title="附一张图">附图</Button>
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Enter 发送，Shift+Enter 换行"
              style={{ minHeight: 44, maxHeight: 140 }}
            />
            <Button variant="primary" onClick={send} loading={loading} disabled={!input.trim() && !image}>发送</Button>
          </div>
        </Card>

        <div className="stack">
          <Card title="会话" subtitle="选择已有会话，或留空自动创建 debug 会话">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">自动（debug 私聊）</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.kind === 'group' ? `群 ${s.peer_id}` : `QQ ${s.peer_id}`}</option>)}
            </Select>
            <p className="faint small" style={{ marginBottom: 0 }}>这里发的消息会写入该会话的上下文，方便测试记忆。</p>
          </Card>

          <Card title="最近一次" subtitle="模型、能力路径和成本">
            {lastMeta ? (
              <div className="stack">
                <div><span className="faint small">模型</span><div className="mono small">{lastMeta.model}</div></div>
                <div><span className="faint small">能力路径</span><div><Badge tone={lastMeta.capabilityPath === 'direct' ? 'mint' : lastMeta.capabilityPath === 'vision-fallback' ? 'blue' : 'neutral'}>{lastMeta.capabilityPath}</Badge></div></div>
                <div><span className="faint small">成本</span><div>¥{Number(lastMeta.costCny ?? 0).toFixed(5)}</div></div>
                <div><span className="faint small">图片处理</span><div className="small muted">{lastMeta.imagePath}</div></div>
              </div>
            ) : <p className="muted small">还没有调用记录。</p>}
          </Card>

          <Card title="说明" subtitle="为什么这里不直连 QQ">
            <ul className="list-reset">
              <li className="list-row"><span>不发送</span><Badge tone="mint">安全</Badge></li>
              <li className="list-row"><span>写入上下文</span><Badge tone="blue">会</Badge></li>
              <li className="list-row"><span>消耗 token</span><Badge tone="amber">会</Badge></li>
              <li className="list-row"><span>受预算限制</span><Badge tone="mint">是</Badge></li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
