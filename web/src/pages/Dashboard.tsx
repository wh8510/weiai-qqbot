import React, { useEffect, useState } from 'react';
import { get, formatMoney, timeAgo } from '../api';
import { Alert, Badge, Button, Card, Empty, MiniBars, PageHeader, Progress, Spinner, Stat, TableWrap } from '../components';

export default function Dashboard({ navigate }: { navigate: (id: string) => void }) {
  const [status, setStatus] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [s, u, se] = await Promise.all([get('/api/status'), get('/api/usage?days=7'), get('/api/sessions')]);
      setStatus(s);
      setUsage(u);
      setSessions(se.sessions ?? []);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const es = new EventSource('/api/events');
    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [{ type: e.type, ...data }, ...prev].slice(0, 12));
        if (e.type === 'incoming' || e.type === 'reply') void load();
      } catch {
        // ignore
      }
    };
    ['incoming', 'reply', 'proactive', 'error'].forEach((name) => es.addEventListener(name, handler as any));
    return () => es.close();
  }, []);

  if (loading && !status) return <Spinner label="正在读取运行状态" />;
  if (error) return <Alert tone="danger">{error}</Alert>;

  const onebot = status?.onebot ?? {};
  const today = usage?.today ?? status?.usageToday?.total ?? {};
  const budget = usage?.budget ?? status?.budget ?? {};
  const chat = status?.models?.chat;
  const cost = Number(today.cost ?? 0);
  const daily = Number(budget.dailyCny ?? 10);
  const pct = daily > 0 ? Math.min(100, (cost / daily) * 100) : 0;

  return (
    <>
      <PageHeader
        title="总览"
        description="连接状态、今天的消耗、最近的会话。所有数字都来自本地数据库。"
        actions={
          <>
            <Button onClick={() => navigate('debug')}>打开调试台</Button>
            <Button variant="primary" onClick={() => navigate('models')}>
              模型与密钥
            </Button>
          </>
        }
      />

      {!chat ? (
        <Alert tone="warn">
          <strong>还没有可用的主对话模型。</strong> 去「模型与密钥」填一个 Provider 的 API Key，或使用 Demo 模式先体验。{status?.models?.missing ? `（${status.models.missing}）` : ''}
        </Alert>
      ) : null}

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <Stat
          label="OneBot 连接"
          value={onebot.connected ? '已连接' : '未连接'}
          sub={onebot.connected ? `${onebot.mode} · ${onebot.selfId || '等待账号'}${onebot.nickname ? ` · ${onebot.nickname}` : ''}` : onebot.lastError || '等待 NapCat 连入 / 填写 URL'}
          accent={onebot.connected ? 'mint' : 'rose'}
        />
        <Stat label="今日花费" value={formatMoney(cost)} sub={`预算 ${formatMoney(daily)} · 已用 ${pct.toFixed(1)}%`} accent={pct > 80 ? 'rose' : 'mint'} />
        <Stat label="会话 / 消息" value={`${status?.counts?.sessions ?? 0} / ${status?.counts?.messages ?? 0}`} sub={`待发 ${status?.counts?.pendingOutbox ?? 0} · 待处理任务 ${status?.counts?.pendingJobs ?? 0}`} accent="blue" />
        <Stat label="当前主模型" value={chat?.label ?? '未配置'} sub={chat?.vision ? '支持看图' : '不支持看图'} accent={chat ? 'mint' : 'amber'} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="最近 7 天消耗" subtitle="按本地时区聚合，含对话、记忆和主动消息">
          {usage?.timeseries?.length ? <MiniBars data={usage.timeseries} valueKey="cost" height={150} /> : <Empty title="还没有消耗记录" hint="配置模型后，第一次对话就会开始记账。" />}
          <div className="row-between" style={{ marginTop: 14 }}>
            <span className="small muted">今日 {formatMoney(cost)} / {formatMoney(daily)}</span>
            <Button size="sm" variant="ghost" onClick={() => navigate('usage')}>
              查看明细
            </Button>
          </div>
          <div style={{ marginTop: 8 }}>
            <Progress value={cost} max={daily} tone={pct > 80 ? 'rose' : pct > 60 ? 'amber' : 'mint'} />
          </div>
        </Card>

        <Card title="运行状态" subtitle="不用重启就能看到连接和模型状态">
          <dl className="kv">
            <dt>版本</dt>
            <dd>{status?.version}</dd>
            <dt>运行时间</dt>
            <dd>{Math.floor((status?.uptimeSec ?? 0) / 3600)} 小时 {Math.floor(((status?.uptimeSec ?? 0) % 3600) / 60)} 分</dd>
            <dt>OneBot 模式</dt>
            <dd>{onebot.mode} {onebot.connected ? <Badge tone="mint">在线</Badge> : <Badge tone="rose">离线</Badge>}</dd>
            <dt>机器人账号</dt>
            <dd>{onebot.selfId || '—'} {onebot.nickname ? `(${onebot.nickname})` : ''}</dd>
            <dt>最近事件</dt>
            <dd>{onebot.lastEventAt ? timeAgo(onebot.lastEventAt) : '还没有收到事件'}</dd>
            <dt>语音能力</dt>
            <dd>{status?.voice?.supported ? <Badge tone="mint">Windows TTS</Badge> : <Badge tone="neutral">未启用</Badge>} <span className="faint small">{status?.voice?.reason}</span></dd>
            <dt>Demo 模式</dt>
            <dd>{status?.demo ? <Badge tone="amber">开启</Badge> : '关闭'}</dd>
          </dl>
          {onebot.lastError ? <Alert tone="warn">{onebot.lastError}</Alert> : null}
        </Card>
      </div>

      <Card
        title="最近会话"
        subtitle="私聊 / 群聊，点进去看消息、记忆和参数"
        className="flush"
        actions={<Button size="sm" variant="ghost" onClick={() => navigate('sessions')}>全部会话</Button>}
        style={{ marginTop: 16 }}
      >
        {sessions.length === 0 ? (
          <Empty title="还没有会话" hint={status?.demo ? '在调试台发一条消息，或在 Demo 模式里直接聊。' : '等 OneBot 收到第一条消息后，这里会自动出现。'} action={<Button size="sm" onClick={() => navigate('debug')}>去调试台</Button>} />
        ) : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>会话</th>
                  <th>类型</th>
                  <th>消息</th>
                  <th>最近</th>
                  <th>关系</th>
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 8).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.kind === 'group' ? `群 ${s.peer_id}` : `QQ ${s.peer_id}`}</div>
                      <div className="faint small">{s.lastMessage?.text?.slice(0, 46) ?? '—'}</div>
                    </td>
                    <td><Badge tone={s.kind === 'group' ? 'blue' : 'mint'}>{s.kind === 'group' ? '群聊' : '私聊'}</Badge></td>
                    <td>{s.message_count ?? 0}</td>
                    <td className="muted small">{timeAgo(s.last_active_at)}</td>
                    <td><span className="small muted">亲密 {Math.round(Number(s.relationship?.affinity ?? 0) * 100)}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="实时事件" subtitle="最近 12 条，来自 /api/events" style={{ marginTop: 16 }}>
        {events.length === 0 ? (
          <p className="muted small">还没有实时事件。Demo 模式可以去调试台发一条消息。</p>
        ) : (
          <ul className="list-reset">
            {events.map((e, i) => (
              <li className="list-row" key={`${e.at}-${i}`}>
                <span>
                  <Badge tone={e.type === 'error' ? 'rose' : e.type === 'reply' ? 'mint' : 'blue'}>{e.type}</Badge>{' '}
                  <span className="muted">{e.text ?? e.bubbles?.join(' / ') ?? e.message ?? e.sessionId ?? ''}</span>
                </span>
                <span className="faint small">{timeAgo(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
