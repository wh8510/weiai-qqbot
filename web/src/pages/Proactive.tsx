import React, { useEffect, useState } from 'react';
import { get, post, put } from '../api';
import { Alert, Badge, Button, Card, Empty, Field, PageHeader, Spinner, TextInput, Toggle } from '../components';

export default function Proactive() {
  const [settings, setSettings] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [s, se] = await Promise.all([get('/api/proactive/settings'), get('/api/sessions')]);
      setSettings(s);
      setSessions(se.sessions ?? []);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setSaving(true);
    setNotice('');
    try {
      await put('/api/proactive/settings', {
        enabled: settings.enabled,
        quietStart: settings.quietStart,
        quietEnd: settings.quietEnd,
        minIntervalMin: Number(settings.minIntervalMin),
        privateDailyCap: Number(settings.privateDailyCap),
        groupDailyCap: Number(settings.groupDailyCap),
        globalDailyCap: Number(settings.globalDailyCap),
      });
      setNotice('主动行为设置已保存');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const test = async (sessionId: string) => {
    setBusy(sessionId);
    setPreview(null);
    setError('');
    try {
      const res = await post(`/api/proactive/test/${sessionId}`, { enqueue: false });
      setPreview({ sessionId, ...res.result });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (loading || !settings) return <Spinner label="正在读取主动行为设置" />;

  return (
    <>
      <PageHeader
        title="主动行为"
        description="她不是等你发消息才活过来。这个页面控制她什么时候会主动找你、频率上限和静默时段。"
        actions={<Button variant="primary" onClick={save} loading={saving}>保存设置</Button>}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="总开关" subtitle="关闭后不会主动发任何消息，但正常回复不受影响">
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 700 }}>主动消息</div>
              <div className="faint small">由后台调度器按概率、静默时段和每日上限决定</div>
            </div>
            <Toggle checked={Boolean(settings.enabled)} onChange={(v) => setSettings({ ...settings, enabled: v })} label={settings.enabled ? '开启' : '关闭'} />
          </div>
          <div className="divider" />
          <div className="grid grid-2">
            <Field label="私聊每日上限"><TextInput type="number" value={settings.privateDailyCap} onChange={(e) => setSettings({ ...settings, privateDailyCap: Number(e.target.value) })} /></Field>
            <Field label="群聊每日上限"><TextInput type="number" value={settings.groupDailyCap} onChange={(e) => setSettings({ ...settings, groupDailyCap: Number(e.target.value) })} /></Field>
            <Field label="全局每日上限"><TextInput type="number" value={settings.globalDailyCap} onChange={(e) => setSettings({ ...settings, globalDailyCap: Number(e.target.value) })} /></Field>
            <Field label="最短间隔（分钟）"><TextInput type="number" value={settings.minIntervalMin} onChange={(e) => setSettings({ ...settings, minIntervalMin: Number(e.target.value) })} /></Field>
            <Field label="静默开始"><TextInput value={settings.quietStart} onChange={(e) => setSettings({ ...settings, quietStart: e.target.value })} /></Field>
            <Field label="静默结束"><TextInput value={settings.quietEnd} onChange={(e) => setSettings({ ...settings, quietEnd: e.target.value })} /></Field>
          </div>
        </Card>

        <Card title="触发逻辑" subtitle="不是纯随机；先过名单、上限、静默，再看关系和时间">
          <ul className="list-reset">
            <li className="list-row"><span>正在对话</span><span className="muted small">20 分钟内不插入</span></li>
            <li className="list-row"><span>连续未回复</span><Badge tone="amber">2 条后停止</Badge></li>
            <li className="list-row"><span>静默时段</span><span className="muted small">不主动，但会正常回复</span></li>
            <li className="list-row"><span>预算耗尽</span><Badge tone="rose">停止主动</Badge></li>
            <li className="list-row"><span>优先话题</span><span className="muted small">未闭环 &gt; 日记 &gt; 关系/时间</span></li>
          </ul>
          <div className="divider" />
          <p className="faint small">主动消息会进入发送队列，遵守 1~4 条分条、打字延迟和发送冷却。用户先回复会取消未发出的气泡。</p>
        </Card>
      </div>

      <Card title="预览" subtitle="只生成，不发送；用来检查她会不会说人话" style={{ marginTop: 16 }}>
        {preview ? (
          preview.plan?.bubbles?.length ? (
            <div className="stack">
              <div className="row">
                <Badge tone="mint">预览</Badge>
                <span className="faint small">{preview.modelRef}</span>
              </div>
              {preview.plan.bubbles.map((b: string, i: number) => <div className="bubble bubble-out" key={i} style={{ maxWidth: '80%' }}>{b}</div>)}
            </div>
          ) : <Alert tone="warn">这次模型选择沉默（silent）。可以换个会话或稍后再试。</Alert>
        ) : (
          <p className="muted small">在下面选一个会话，点“预览主动消息”。</p>
        )}
      </Card>

      <Card title="会话" subtitle="主动行为按会话独立设置；这里可以快速预览" className="flush" style={{ marginTop: 16 }}>
        {sessions.length === 0 ? <Empty title="还没有会话" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>会话</th><th>类型</th><th>最近</th><th>主动</th><th></th></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.kind === 'group' ? `群 ${s.peer_id}` : `QQ ${s.peer_id}`}</td>
                    <td><Badge tone={s.kind === 'group' ? 'blue' : 'mint'}>{s.kind === 'group' ? '群' : '私'}</Badge></td>
                    <td className="faint small">{s.lastMessage?.text?.slice(0, 40) ?? '—'}</td>
                    <td>{s.settings?.paused ? <Badge tone="rose">暂停</Badge> : <Badge tone="mint">可触发</Badge>}</td>
                    <td><Button size="sm" onClick={() => test(s.id)} loading={busy === s.id}>预览主动消息</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
