import React, { useEffect, useState } from 'react';
import { del, get, post } from '../api';
import { Alert, Badge, Button, Card, Empty, PageHeader, Select, Spinner, TableWrap } from '../components';

export default function Memory() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

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
    try {
      setDetail(await get(`/api/sessions/${id}`));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => { void loadSessions(); }, []);
  useEffect(() => { if (selected) void loadDetail(selected); }, [selected]);

  const refresh = async () => {
    await loadDetail(selected);
    await loadSessions();
  };

  const removeFact = async (id: string) => {
    if (!confirm('删除这条记忆？')) return;
    await del(`/api/memory/facts/${id}`);
    await refresh();
  };

  const removeDiary = async (id: string) => {
    if (!confirm('删除这篇日记？')) return;
    await del(`/api/memory/diaries/${id}`);
    await refresh();
  };

  const trigger = async (kind: 'summarize' | 'diary') => {
    setBusy(kind);
    setNotice('');
    try {
      await post(`/api/sessions/${selected}/${kind}`, {});
      setNotice('任务已排队；几秒后刷新查看。');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (loading) return <Spinner label="正在读取记忆" />;

  return (
    <>
      <PageHeader
        title="记忆"
        description="长期记忆不是聊天记录，而是“以后还用得上的东西”：稳定偏好、重要事件、没聊完的事、她自己的日记。"
        actions={<Button onClick={() => void refresh()} disabled={!selected}>刷新</Button>}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {sessions.length === 0 ? <Empty title="还没有会话" hint="先聊几句，再来看记忆。" /> : (
        <>
          <Card title="选择会话" subtitle="记忆按会话隔离">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.kind === 'group' ? `群 ${s.peer_id}` : `QQ ${s.peer_id}`} · {s.message_count ?? 0} 条</option>)}
            </Select>
            <div className="row" style={{ marginTop: 12 }}>
              <Button size="sm" onClick={() => trigger('summarize')} loading={busy === 'summarize'}>重新整理记忆</Button>
              <Button size="sm" onClick={() => trigger('diary')} loading={busy === 'diary'}>写今天的日记</Button>
              <Badge tone="mint">亲密 {Math.round(Number(detail?.relationship?.affinity ?? 0) * 100)}%</Badge>
              <Badge tone="blue">情绪 {detail?.relationship?.mood ?? 'neutral'}</Badge>
            </div>
          </Card>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card title={`结构化事实（${detail?.facts?.length ?? 0}）`} subtitle="subject / predicate / object，带置信度">
              {detail?.facts?.length ? (
                <TableWrap>
                  <table>
                    <thead><tr><th>事实</th><th>置信</th><th></th></tr></thead>
                    <tbody>
                      {detail.facts.map((f: any) => (
                        <tr key={f.id}>
                          <td><span className="muted">{f.subject}</span> {f.predicate} <strong>{f.object}</strong></td>
                          <td className="small muted">{Math.round(Number(f.confidence) * 100)}%</td>
                          <td><Button size="sm" variant="danger" onClick={() => removeFact(f.id)}>删</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : <Empty title="还没有事实" hint="聊够 8 条后会自动整理，也可以手动触发。" />}
            </Card>

            <Card title={`未闭环话题（${detail?.openLoops?.length ?? 0}）`} subtitle="主动消息会优先跟进这些">
              {detail?.openLoops?.length ? (
                <ul className="list-reset">
                  {detail.openLoops.map((l: any) => (
                    <li className="list-row" key={l.id}>
                      <span><strong>{l.topic}</strong><br /><span className="faint small">{l.detail}</span></span>
                      <Badge tone="amber">open</Badge>
                    </li>
                  ))}
                </ul>
              ) : <Empty title="没有未闭环话题" hint="比如“明天面试”“答应发的图”，会被记在这里。" />}
            </Card>
          </div>

          <Card title={`日记（${detail?.diaries?.length ?? 0}）`} subtitle="第一人称叙事，用来恢复“她怎么看待这段关系”" style={{ marginTop: 16 }}>
            {detail?.diaries?.length ? (
              <div className="stack">
                {detail.diaries.map((d: any) => (
                  <div key={d.id} style={{ border: '1px solid var(--border-soft)', borderRadius: 12, padding: 14 }}>
                    <div className="row-between">
                      <Badge tone="violet">{d.date}</Badge>
                      <div className="row">
                        {d.mood ? <span className="faint small">心情：{d.mood}</span> : null}
                        <Button size="sm" variant="danger" onClick={() => removeDiary(d.id)}>删除</Button>
                      </div>
                    </div>
                    <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{d.content}</p>
                  </div>
                ))}
              </div>
            ) : <Empty title="还没有日记" hint="晚上 23 点会自动写；也可以手动触发。" />}
          </Card>

          <Card title="当前摘要" subtitle="上下文压缩后的滚动摘要" style={{ marginTop: 16 }}>
            {detail?.summary ? <div className="pre">{detail.summary}</div> : <p className="muted small">还没有摘要。聊够 8 条后会自动生成，或在上面点“重新整理记忆”。</p>}
          </Card>
        </>
      )}
    </>
  );
}
