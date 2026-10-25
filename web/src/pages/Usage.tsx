import React, { useEffect, useState } from 'react';
import { formatMoney, get } from '../api';
import { Alert, Button, Card, Empty, MiniBars, PageHeader, Progress, Spinner, Stat, TableWrap } from '../components';

export default function Usage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (d: number) => {
    setLoading(true);
    try {
      setData(await get(`/api/usage?days=${d}`));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(days); }, [days]);

  if (loading && !data) return <Spinner label="正在读取用量" />;
  if (error) return <Alert tone="danger">{error}</Alert>;

  const today = data?.today ?? {};
  const total = data?.summary?.total ?? {};
  const budget = data?.budget ?? {};
  const daily = Number(budget.dailyCny ?? 10);
  const pct = daily > 0 ? (Number(today.cost ?? 0) / daily) * 100 : 0;

  return (
    <>
      <PageHeader
        title="用量与预算"
        description="对话、记忆整理、主动消息、看图都会记账。价格来自模型目录，改价不影响历史账。"
        actions={
          <div className="row">
            <Button size="sm" variant={days === 7 ? 'primary' : 'ghost'} onClick={() => setDays(7)}>7 天</Button>
            <Button size="sm" variant={days === 30 ? 'primary' : 'ghost'} onClick={() => setDays(30)}>30 天</Button>
            <Button size="sm" onClick={() => load(days)}>刷新</Button>
          </div>
        }
      />

      <div className="grid grid-4">
        <Stat label="今日花费" value={formatMoney(Number(today.cost ?? 0))} sub={`预算 ${formatMoney(daily)}`} accent={pct > 80 ? 'rose' : 'mint'} />
        <Stat label="今日调用" value={Number(today.calls ?? 0)} sub={`${Number(today.promptTokens ?? 0) + Number(today.completionTokens ?? 0)} tokens`} accent="blue" />
        <Stat label={`${days} 天总花费`} value={formatMoney(Number(total.cost ?? 0))} sub={`${Number(total.calls ?? 0)} 次调用`} accent="amber" />
        <Stat label="缓存命中" value={`${Number(total.cachedTokens ?? 0).toLocaleString()}`} sub="cached input tokens" accent="mint" />
      </div>

      <Card title="预算" subtitle="超过上限会自动停主动/降级，避免把账单聊穿" style={{ marginTop: 16 }}>
        <div className="row-between">
          <span className="small muted">今日 {formatMoney(Number(today.cost ?? 0))} / {formatMoney(daily)}</span>
          <span className="small muted">{pct.toFixed(1)}%</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <Progress value={Number(today.cost ?? 0)} max={daily} tone={pct > 80 ? 'rose' : pct > 60 ? 'amber' : 'mint'} />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="faint small">日 token 上限 {Number(budget.dailyTokens ?? 0).toLocaleString()}</span>
          <span className="faint small">日调用上限 {budget.dailyCalls ?? 0}</span>
          <span className="faint small">单会话日预算 {formatMoney(Number(budget.sessionCny ?? 2))}</span>
        </div>
      </Card>

      <Card title={`${days} 天走势`} subtitle="按本地时区聚合" style={{ marginTop: 16 }}>
        {data?.timeseries?.length ? <MiniBars data={data.timeseries} valueKey="cost" height={170} /> : <Empty title="还没有用量" />}
      </Card>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="按用途" subtitle="chat / memory / proactive / vision / diary" className="flush">
          {data?.summary?.byPurpose?.length ? (
            <TableWrap>
              <table>
                <thead><tr><th>用途</th><th>调用</th><th>Tokens</th><th>花费</th></tr></thead>
                <tbody>
                  {data.summary.byPurpose.map((p: any) => (
                    <tr key={p.purpose}><td>{p.purpose}</td><td>{p.calls}</td><td>{Number(p.tokens).toLocaleString()}</td><td>{formatMoney(p.cost)}</td></tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : <Empty title="还没有数据" />}
        </Card>
        <Card title="按模型" subtitle="哪个模型最费钱" className="flush">
          {data?.summary?.byModel?.length ? (
            <TableWrap>
              <table>
                <thead><tr><th>模型</th><th>调用</th><th>Tokens</th><th>花费</th></tr></thead>
                <tbody>
                  {data.summary.byModel.map((m: any) => (
                    <tr key={m.model}><td className="mono small">{m.model}</td><td>{m.calls}</td><td>{Number(m.tokens).toLocaleString()}</td><td>{formatMoney(m.cost)}</td></tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : <Empty title="还没有数据" />}
        </Card>
      </div>

      <Card title="按会话" subtitle="今天/最近哪个群、哪个好友最费" className="flush" style={{ marginTop: 16 }}>
        {data?.summary?.bySession?.length ? (
          <TableWrap>
            <table>
              <thead><tr><th>Session</th><th>调用</th><th>花费</th></tr></thead>
              <tbody>
                {data.summary.bySession.map((s: any) => (
                  <tr key={s.sessionId}><td className="mono small">{s.sessionId}</td><td>{s.calls}</td><td>{formatMoney(s.cost)}</td></tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : <Empty title="还没有数据" />}
      </Card>
    </>
  );
}
