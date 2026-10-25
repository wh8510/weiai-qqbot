import React, { useEffect, useState } from 'react';
import { get, put } from '../api';
import { Alert, Badge, Button, Card, Field, PageHeader, Select, Spinner, TextInput } from '../components';

export default function Settings() {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const s = await get('/api/settings');
      setData(s);
      setForm({
        ...s,
        aliasesText: (() => {
          try {
            const a = JSON.parse(s.aliases || '[]');
            return Array.isArray(a) ? a.join(', ') : '';
          } catch {
            return '';
          }
        })(),
      });
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
    setError('');
    try {
      await put('/api/settings', {
        botName: form.botName,
        aliases: form.aliasesText.split(/[,，\n]/).map((s: string) => s.trim()).filter(Boolean),
        ownerQq: form.ownerQq,
        onebot: {
          mode: form.onebot.mode,
          path: form.onebot.path,
          url: form.onebot.url,
          token: token || undefined,
        },
        budget: {
          enabled: form.budget.enabled,
          dailyCny: Number(form.budget.dailyCny),
          sessionCny: Number(form.budget.sessionCny),
          dailyTokens: Number(form.budget.dailyTokens),
          dailyCalls: Number(form.budget.dailyCalls),
        },
        fxUsdCny: Number(form.fxUsdCny),
        defaults: {
          privateReplyProbability: Number(form.defaults.privateReplyProbability),
          groupReplyProbability: Number(form.defaults.groupReplyProbability),
          groupAttentionThreshold: Number(form.defaults.groupAttentionThreshold),
          stickerProbability: Number(form.defaults.stickerProbability),
          voiceProbability: Number(form.defaults.voiceProbability),
          maxMessagesPerHour: Number(form.defaults.maxMessagesPerHour),
          cooldownSec: Number(form.defaults.cooldownSec),
        },
      });
      setToken('');
      setNotice('设置已保存。OneBot 网络参数改动后需要重启进程才会完全生效。');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <Spinner label="正在读取设置" />;

  return (
    <>
      <PageHeader
        title="系统设置"
        description="OneBot 连接、机器人身份、预算和汇率。API Key 不在这里，去「模型与密钥」。"
        actions={<Button variant="primary" onClick={save} loading={saving}>保存设置</Button>}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="机器人身份" subtitle="决定它叫什么、认谁当 owner">
          <div className="stack">
            <Field label="名字"><TextInput value={form.botName} onChange={(e) => setForm({ ...form, botName: e.target.value })} /></Field>
            <Field label="别名（逗号分隔）" hint="群里叫这些名字也会被当成在叫它">
              <TextInput value={form.aliasesText} onChange={(e) => setForm({ ...form, aliasesText: e.target.value })} />
            </Field>
            <Field label="Owner QQ" hint="Owner 不受白名单限制，可以私聊触发；不会自动给群管理权限">
              <TextInput value={form.ownerQq} onChange={(e) => setForm({ ...form, ownerQq: e.target.value })} placeholder="你的 QQ 号" />
            </Field>
            <div className="row">
              <Badge tone="blue">时区 {data.timezone}</Badge>
              <Badge tone="neutral">v{data.version}</Badge>
              <Badge tone={data.voice.supported ? 'mint' : 'neutral'}>{data.voice.supported ? '语音可用' : '语音不可用'}</Badge>
              {data.keyFingerprint ? <Badge tone="violet">密钥 {data.keyFingerprint}</Badge> : null}
            </div>
            <p className="faint small">{data.voice.reason}</p>
          </div>
        </Card>

        <Card title="OneBot 连接" subtitle="支持 NapCat / Lagrange / LLOneBot 的 OneBot 11">
          <div className="stack">
            <Field label="模式">
              <Select value={form.onebot.mode} onChange={(e) => setForm({ ...form, onebot: { ...form.onebot, mode: e.target.value } })}>
                <option value="reverse">反向 WS（NapCat 连过来，推荐）</option>
                <option value="forward">正向 WS（程序连 NapCat）</option>
              </Select>
            </Field>
            <Field label="反向 WS 路径" hint="NapCat 的「WebSocket 客户端」URL 填 ws://<host>:<port> + 这个路径">
              <TextInput value={form.onebot.path} onChange={(e) => setForm({ ...form, onebot: { ...form.onebot, path: e.target.value } })} />
            </Field>
            <Field label="正向 WS URL" hint="仅 forward 模式使用，例如 ws://127.0.0.1:3001">
              <TextInput value={form.onebot.url} onChange={(e) => setForm({ ...form, onebot: { ...form.onebot, url: e.target.value } })} placeholder="ws://127.0.0.1:3001" />
            </Field>
            <Field label="Access Token" hint={`${form.onebot.tokenConfigured ? '已配置；' : ''}留空表示不修改`}>
              <TextInput type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={form.onebot.tokenConfigured ? '已配置，留空不修改' : '与 NapCat 的 token 保持一致'} />
            </Field>
            <Alert tone="warn">管理端默认只监听 127.0.0.1。云端部署请用 Caddy/Nginx 加 HTTPS，并只暴露必要端口。</Alert>
          </div>
        </Card>
      </div>

      <Card title="预算与破产保护" subtitle="按模型目录里的单价计算，价格未配置的模型会显示 0 并标记估算" style={{ marginTop: 16 }}>
        <div className="grid grid-3">
          <Field label="日预算（元）"><TextInput type="number" step="0.01" value={form.budget.dailyCny} onChange={(e) => setForm({ ...form, budget: { ...form.budget, dailyCny: Number(e.target.value) } })} /></Field>
          <Field label="单会话日预算（元）"><TextInput type="number" step="0.01" value={form.budget.sessionCny} onChange={(e) => setForm({ ...form, budget: { ...form.budget, sessionCny: Number(e.target.value) } })} /></Field>
          <Field label="日 token 上限"><TextInput type="number" value={form.budget.dailyTokens} onChange={(e) => setForm({ ...form, budget: { ...form.budget, dailyTokens: Number(e.target.value) } })} /></Field>
          <Field label="日调用上限"><TextInput type="number" value={form.budget.dailyCalls} onChange={(e) => setForm({ ...form, budget: { ...form.budget, dailyCalls: Number(e.target.value) } })} /></Field>
          <Field label="USD → CNY 汇率" hint="用于把美元模型的成本折算成人民币"><TextInput type="number" step="0.01" value={form.fxUsdCny} onChange={(e) => setForm({ ...form, fxUsdCny: Number(e.target.value) })} /></Field>
        </div>
        <p className="faint small">上限为 0 表示不限制。建议保留：日 10 元、单会话 2 元，足够个人使用。</p>
      </Card>

      <Card title="默认行为" subtitle="新会话继承这些值；每个会话仍可单独覆盖" style={{ marginTop: 16 }}>
        <div className="grid grid-4">
          <Field label="私聊回复概率"><TextInput type="number" step="0.01" min="0" max="1" value={form.defaults.privateReplyProbability} onChange={(e) => setForm({ ...form, defaults: { ...form.defaults, privateReplyProbability: Number(e.target.value) } })} /></Field>
          <Field label="群聊插话概率"><TextInput type="number" step="0.01" min="0" max="1" value={form.defaults.groupReplyProbability} onChange={(e) => setForm({ ...form, defaults: { ...form.defaults, groupReplyProbability: Number(e.target.value) } })} /></Field>
          <Field label="群注意力阈值"><TextInput type="number" value={form.defaults.groupAttentionThreshold} onChange={(e) => setForm({ ...form, defaults: { ...form.defaults, groupAttentionThreshold: Number(e.target.value) } })} /></Field>
          <Field label="表情包概率"><TextInput type="number" step="0.01" min="0" max="1" value={form.defaults.stickerProbability} onChange={(e) => setForm({ ...form, defaults: { ...form.defaults, stickerProbability: Number(e.target.value) } })} /></Field>
          <Field label="语音概率"><TextInput type="number" step="0.01" min="0" max="1" value={form.defaults.voiceProbability} onChange={(e) => setForm({ ...form, defaults: { ...form.defaults, voiceProbability: Number(e.target.value) } })} /></Field>
          <Field label="每小时消息上限"><TextInput type="number" value={form.defaults.maxMessagesPerHour} onChange={(e) => setForm({ ...form, defaults: { ...form.defaults, maxMessagesPerHour: Number(e.target.value) } })} /></Field>
          <Field label="发言冷却（秒）"><TextInput type="number" value={form.defaults.cooldownSec} onChange={(e) => setForm({ ...form, defaults: { ...form.defaults, cooldownSec: Number(e.target.value) } })} /></Field>
        </div>
        <p className="faint small">概率只是最后一道闸门；名单、静默、每小时上限和预算仍然优先。</p>
      </Card>

      <Card title="安全" subtitle="部署到云端前请确认" style={{ marginTop: 16 }}>
        <ul className="list-reset">
          <li className="list-row"><span>消息正文 / API Key</span><Badge tone="mint">字段级 AES-256-GCM 加密</Badge></li>
          <li className="list-row"><span>管理员密码</span><Badge tone="mint">Argon2id</Badge></li>
          <li className="list-row"><span>主密钥</span><span className="muted small">data/master.key，请备份；丢失不可恢复</span></li>
          <li className="list-row"><span>传输</span><span className="muted small">生产环境必须 HTTPS / WSS</span></li>
          <li className="list-row"><span>API Key 回显</span><Badge tone="mint">从不回显明文</Badge></li>
        </ul>
        <p className="faint small">数据库文件本身未做整库加密（跨平台 SQLCipher 预编译不稳定），敏感字段已逐字段加密；云主机建议同时开启磁盘加密与加密备份。</p>
      </Card>
    </>
  );
}
