import React, { useEffect, useState } from 'react';
import { formatDate, get, patch, post, timeAgo } from '../api';
import { Alert, Badge, Button, Card, ChatBubble, Empty, Field, PageHeader, Select, Spinner, TextInput, Toggle } from '../components';

export default function Sessions() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState('');

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await get('/api/sessions');
      const list = data.sessions ?? [];
      setSessions(list);
      if (!selected && list.length) {
        const preferred =
          list.find((s: any) => s.kind === 'private' && (s.message_count ?? 0) > 0) ??
          list.find((s: any) => s.kind === 'private') ??
          list[0];
        setSelected(preferred.id);
      }
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    if (!id) return;
    setLoadingDetail(true);
    try {
      const [d, m] = await Promise.all([get(`/api/sessions/${id}`), get(`/api/sessions/${id}/messages?limit=300`)]);
      setDetail(d);
      setMessages(m.messages ?? []);
      setSettings(d.session?.settings ?? {});
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected) void loadDetail(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setNotice('');
    try {
      await patch(`/api/sessions/${selected}`, {
        mode: settings.mode,
        settings: {
          paused: Boolean(settings.paused),
          privateReplyProbability: Number(settings.privateReplyProbability ?? 0.95),
          groupReplyProbability: Number(settings.groupReplyProbability ?? 0.12),
          groupAttentionThreshold: Number(settings.groupAttentionThreshold ?? 4),
          proactiveDailyCap: Number(settings.proactiveDailyCap ?? 2),
          proactiveMinIntervalMin: Number(settings.proactiveMinIntervalMin ?? 120),
          quietStart: settings.quietStart ?? '23:30',
          quietEnd: settings.quietEnd ?? '08:00',
          stickerProbability: Number(settings.stickerProbability ?? 0.2),
          voiceProbability: Number(settings.voiceProbability ?? 0.1),
        },
      });
      setNotice('会话设置已保存');
      await loadDetail(selected);
      await loadSessions();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const act = async (action: 'reset' | 'summarize' | 'diary' | 'proactive') => {
    if (!selected) return;
    if (action === 'reset' && !confirm('确定清空这个会话的消息和记忆吗？不可恢复。')) return;
    setActionBusy(action);
    setNotice('');
    try {
      if (action === 'reset') await post(`/api/sessions/${selected}/reset`, {});
      if (action === 'summarize') await post(`/api/sessions/${selected}/summarize`, {});
      if (action === 'diary') await post(`/api/sessions/${selected}/diary`, {});
      if (action === 'proactive') {
        const res = await post(`/api/proactive/test/${selected}`, {});
        setNotice(res.result ? `主动消息预览：${res.result.plan?.bubbles?.join(' / ')}（仅预览，不发送）` : '这次没有生成主动消息');
      }
      if (action !== 'proactive') setNotice(action === 'reset' ? '会话已重置' : '任务已排队，稍后刷新记忆页查看');
      if (action === 'reset') {
        await loadDetail(selected);
        await loadSessions();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy('');
    }
  };

  if (loading) return <Spinner label="正在读取会话" />;

  return (
    <>
      <PageHeader
        title="会话"
        description="每个私聊/群一个独立会话。可以看消息、调概率、重置上下文、手动触发摘要/日记。"
        actions={<Button onClick={() => void loadSessions()}>刷新</Button>}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {sessions.length === 0 ? (
        <Empty title="还没有会话" hint="等 OneBot 收到消息，或在调试台先聊一句。" />
      ) : (
        <div className="session-layout" style={{ marginTop: 16 }}>
          <Card className="session-list" title="会话列表" subtitle={`${sessions.length} 个`}>
            <div style={{ margin: '-16px -18px -18px' }}>
              {sessions.map((s) => (
                <button key={s.id} className={`session-item ${selected === s.id ? 'active' : ''}`} onClick={() => setSelected(s.id)}>
                  <div className="session-item-title">
                    <span>{s.kind === 'group' ? `群 ${s.peer_id}` : `QQ ${s.peer_id}`}</span>
                    <Badge tone={s.kind === 'group' ? 'blue' : 'mint'}>{s.kind === 'group' ? '群' : '私'}</Badge>
                  </div>
                  <div className="session-item-sub">{s.lastMessage?.text ?? '暂无消息'} · {timeAgo(s.last_active_at)}</div>
                </button>
              ))}
            </div>
          </Card>

          <div className="stack">
            {loadingDetail || !detail ? (
              <Card><Spinner label="正在读取会话详情" /></Card>
            ) : (
              <>
                <Card
                  title={detail.session.kind === 'group' ? `群 ${detail.session.peer_id}` : `私聊 ${detail.session.peer_id}`}
                  subtitle={`创建于 ${formatDate(detail.session.created_at)} · 最近活跃 ${timeAgo(detail.session.last_active_at)}`}
                  actions={
                    <>
                      <Badge tone="mint">亲密 {Math.round(Number(detail.relationship?.affinity ?? 0) * 100)}%</Badge>
                      <Badge tone="blue">{detail.session.mode}</Badge>
                    </>
                  }
                >
                  <div className="grid grid-4">
                    <div><div className="faint small">消息</div><div style={{ fontWeight: 700 }}>{messages.length}</div></div>
                    <div><div className="faint small">事实</div><div style={{ fontWeight: 700 }}>{detail.facts?.length ?? 0}</div></div>
                    <div><div className="faint small">日记</div><div style={{ fontWeight: 700 }}>{detail.diaries?.length ?? 0}</div></div>
                    <div><div className="faint small">未闭环</div><div style={{ fontWeight: 700 }}>{detail.openLoops?.length ?? 0}</div></div>
                  </div>
                  <div className="divider" />
                  <div className="row">
                    <Button size="sm" onClick={() => act('summarize')} loading={actionBusy === 'summarize'}>生成摘要</Button>
                    <Button size="sm" onClick={() => act('diary')} loading={actionBusy === 'diary'}>写日记</Button>
                    <Button size="sm" variant="subtle" onClick={() => act('proactive')} loading={actionBusy === 'proactive'}>预览主动消息</Button>
                    <Button size="sm" variant="danger" onClick={() => act('reset')} loading={actionBusy === 'reset'}>重置会话</Button>
                  </div>
                  <p className="faint small" style={{ marginBottom: 0 }}>“预览主动消息”只生成、不发送；真正的主动发送由后台调度器按概率/上限执行。</p>
                </Card>

                <Card title="消息记录" subtitle="按时间正序，内容从加密字段解密后展示">
                  <div className="chat-scroll" style={{ maxHeight: 520, margin: '-16px -18px -18px', borderRadius: 0 }}>
                    {messages.length === 0 ? <Empty title="还没有消息" /> : messages.map((m) => (
                      <ChatBubble key={m.id} direction={m.direction === 'out' ? 'out' : 'in'} name={m.direction === 'out' ? '她' : m.sender_name || m.sender_id} text={m.text || '[图片]'} at={m.created_at} />
                    ))}
                  </div>
                </Card>

                <Card title="会话参数" subtitle="只影响这个会话；留空/默认继承全局">
                  <div className="grid grid-2">
                    <Field label="群模式">
                      <Select value={settings.mode ?? detail.session.mode ?? 'mention_only'} onChange={(e) => setSettings({ ...settings, mode: e.target.value })}>
                        <option value="mention_only">mention_only（只回 @）</option>
                        <option value="smart">smart（低概率插话）</option>
                        <option value="active">active（更活跃）</option>
                        <option value="off">off（关闭）</option>
                        <option value="normal">normal（私聊）</option>
                      </Select>
                    </Field>
                    <Field label="暂停这个会话">
                      <Toggle checked={Boolean(settings.paused)} onChange={(v) => setSettings({ ...settings, paused: v })} label={settings.paused ? '已暂停' : '运行中'} />
                    </Field>
                    <Field label="私聊回复概率" hint="0~1；Owner 始终回复">
                      <TextInput type="number" step="0.01" min="0" max="1" value={settings.privateReplyProbability ?? 0.95} onChange={(e) => setSettings({ ...settings, privateReplyProbability: Number(e.target.value) })} />
                    </Field>
                    <Field label="群聊插话概率" hint="仅在注意力过线后生效">
                      <TextInput type="number" step="0.01" min="0" max="1" value={settings.groupReplyProbability ?? 0.12} onChange={(e) => setSettings({ ...settings, groupReplyProbability: Number(e.target.value) })} />
                    </Field>
                    <Field label="注意力阈值"><TextInput type="number" value={settings.groupAttentionThreshold ?? 4} onChange={(e) => setSettings({ ...settings, groupAttentionThreshold: Number(e.target.value) })} /></Field>
                    <Field label="主动消息上限/天"><TextInput type="number" value={settings.proactiveDailyCap ?? 2} onChange={(e) => setSettings({ ...settings, proactiveDailyCap: Number(e.target.value) })} /></Field>
                    <Field label="主动最短间隔（分钟）"><TextInput type="number" value={settings.proactiveMinIntervalMin ?? 120} onChange={(e) => setSettings({ ...settings, proactiveMinIntervalMin: Number(e.target.value) })} /></Field>
                    <Field label="静默开始 / 结束">
                      <div className="row">
                        <TextInput value={settings.quietStart ?? '23:30'} onChange={(e) => setSettings({ ...settings, quietStart: e.target.value })} />
                        <TextInput value={settings.quietEnd ?? '08:00'} onChange={(e) => setSettings({ ...settings, quietEnd: e.target.value })} />
                      </div>
                    </Field>
                    <Field label="表情包概率"><TextInput type="number" step="0.01" min="0" max="1" value={settings.stickerProbability ?? 0.2} onChange={(e) => setSettings({ ...settings, stickerProbability: Number(e.target.value) })} /></Field>
                    <Field label="语音概率（Windows）"><TextInput type="number" step="0.01" min="0" max="1" value={settings.voiceProbability ?? 0.1} onChange={(e) => setSettings({ ...settings, voiceProbability: Number(e.target.value) })} /></Field>
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <Button variant="primary" onClick={save} loading={saving}>保存参数</Button>
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
