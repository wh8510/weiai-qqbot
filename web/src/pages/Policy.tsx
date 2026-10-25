import React, { useEffect, useState } from 'react';
import { del, get, post } from '../api';
import { Alert, Badge, Button, Card, Field, PageHeader, Select, Spinner, TableWrap, TextInput } from '../components';

const SCOPES: Record<string, string> = {
  private: '私聊',
  group: '群聊',
  group_member: '群成员',
};

export default function Policy() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ scope: 'private', action: 'allow', targetId: '', note: '' });

  const load = async () => {
    setLoading(true);
    try {
      const data = await get('/api/policy');
      setEntries(data.entries ?? []);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice('');
    try {
      await post('/api/policy', form);
      setForm({ ...form, targetId: '', note: '' });
      setNotice('名单已保存');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('确定删除这条名单吗？')) return;
    try {
      await del(`/api/policy/${id}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <Spinner label="正在读取名单" />;

  return (
    <>
      <PageHeader title="名单" description="默认拒绝：白名单为空时，任何私聊/群都不会触发。黑名单优先于白名单。列表改动即时生效。" />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Alert tone="warn">
        先在「名单」里把允许的 QQ / 群号加进白名单，否则机器人不会回应任何消息。Owner（系统设置里的 owner QQ）不受白名单限制。
      </Alert>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="添加名单" subtitle="群成员黑名单只支持 deny">
          <form className="stack" onSubmit={add}>
            <Field label="范围">
              <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, action: e.target.value === 'group_member' ? 'deny' : form.action })}>
                {Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="动作">
              <Select value={form.action} disabled={form.scope === 'group_member'} onChange={(e) => setForm({ ...form, action: e.target.value })}>
                <option value="allow">允许（白名单）</option>
                <option value="deny">拒绝（黑名单）</option>
              </Select>
            </Field>
            <Field label="QQ / 群号">
              <TextInput value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })} placeholder="例如 123456789" inputMode="numeric" />
            </Field>
            <Field label="备注">
              <TextInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="可选，比如：测试小号 / 猫群" />
            </Field>
            <Button variant="primary" type="submit">保存名单</Button>
          </form>
        </Card>

        <Card title="规则说明" subtitle="所有判断都在调用模型之前完成">
          <ul className="list-reset">
            <li className="list-row"><span>私聊白名单为空</span><Badge tone="rose">拒绝所有私聊</Badge></li>
            <li className="list-row"><span>群白名单为空</span><Badge tone="rose">拒绝所有群</Badge></li>
            <li className="list-row"><span>黑名单命中</span><Badge tone="rose">直接丢弃</Badge></li>
            <li className="list-row"><span>Owner QQ</span><Badge tone="mint">始终允许</Badge></li>
            <li className="list-row"><span>群成员黑名单</span><Badge tone="amber">该成员发言不触发</Badge></li>
            <li className="list-row"><span>群模式</span><span className="muted small">off / mention_only / smart / active</span></li>
          </ul>
          <div className="divider" />
          <p className="faint small">
            群模式在「会话」里按群设置。新群默认 <span className="code">mention_only</span>，只有被 @ 或叫名字才回。
          </p>
        </Card>
      </div>

      <Card title={`当前名单（${entries.length}）`} className="flush" style={{ marginTop: 16 }}>
        {entries.length === 0 ? (
          <div className="empty">
            <div className="empty-glyph">☷</div>
            <h3>名单还是空的</h3>
            <p>在左边加一条私聊白名单，机器人才能回复你。</p>
          </div>
        ) : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>范围</th>
                  <th>动作</th>
                  <th>目标</th>
                  <th>备注</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td><Badge tone={e.scope === 'private' ? 'mint' : e.scope === 'group' ? 'blue' : 'violet'}>{SCOPES[e.scope] ?? e.scope}</Badge></td>
                    <td><Badge tone={e.action === 'allow' ? 'mint' : 'rose'}>{e.action === 'allow' ? '允许' : '拒绝'}</Badge></td>
                    <td className="mono">{e.target_id}</td>
                    <td className="muted small">{e.note || '—'}</td>
                    <td>{e.enabled ? <Badge tone="mint">生效</Badge> : <Badge tone="neutral">停用</Badge>}</td>
                    <td><Button size="sm" variant="danger" onClick={() => remove(e.id)}>删除</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
