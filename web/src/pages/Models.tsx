import React, { useEffect, useState } from 'react';
import { get, patch, post, put } from '../api';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Select, Spinner, TableWrap, TextInput, Toggle } from '../components';

type AnyModel = any;
type AnyProvider = any;

function priceLabel(model: AnyModel): string {
  const p = model.pricing;
  if (!p) return '未配置价格';
  const cur = p.currency === 'USD' ? '$' : '¥';
  return `${cur}${p.input ?? '?'} / ${cur}${p.output ?? '?'} 每百万`;
}

function CapBadge({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <Badge tone={on ? 'mint' : 'neutral'}>{children}</Badge>;
}

const ROLE_LABELS: Record<string, string> = {
  chat: '主对话',
  vision: '看图',
  memory: '记忆整理',
  classifier: '群聊判断',
  embedding: '向量检索',
};

const ROLE_HINTS: Record<string, string> = {
  chat: '它平时说话用的模型；支持视觉的模型可以直接看图',
  vision: '主模型不支持看图时，用它来描述图片',
  memory: '摘要、事实、日记；选便宜、快、支持 JSON 的',
  classifier: '群聊注意力判断；通常用便宜的小模型',
  embedding: '可选；用于长期记忆的向量检索',
};

export default function Models() {
  const [providers, setProviders] = useState<AnyProvider[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<AnyProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({ id: '', name: '', kind: 'openai', baseUrl: '', apiKey: '' });
  const [addingModel, setAddingModel] = useState(false);
  const [newModel, setNewModel] = useState({ providerId: '', modelId: '', displayName: '', context: 32768, maxOutput: 4096, vision: false });
  const [busy, setBusy] = useState('');
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({});
  const [modelChoice, setModelChoice] = useState<Record<string, string>>({});
  const [probeResult, setProbeResult] = useState<any>(null);
  const [revealedKey, setRevealedKey] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([get('/api/providers'), get('/api/roles')]);
      const providerList = p.providers ?? [];
      const roleList = r.roles ?? [];
      setProviders(providerList);
      setRoles(roleList);
      const draft: Record<string, string> = {};
      for (const role of roleList) draft[role.role] = role.modelRef ?? '';
      setRoleDraft(draft);
      const chatRef = roleList.find((role: any) => role.role === 'chat')?.modelRef ?? '';
      setModelChoice((prev) => {
        const next = { ...prev };
        for (const provider of providerList) {
          const models = provider.models ?? [];
          if (models.some((m: any) => m.id === next[provider.id])) continue;
          const current = chatRef.startsWith(`${provider.id}:`) ? chatRef : '';
          next[provider.id] =
            current ||
            models.find((m: any) => m.capabilities?.vision && m.status !== 'deprecated')?.id ||
            models.find((m: any) => m.status !== 'deprecated')?.id ||
            models[0]?.id ||
            '';
        }
        return next;
      });
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

  const currentRoleRef = (role: string): string => roles.find((r) => r.role === role)?.modelRef ?? '';
  const sortModels = (models: AnyModel[]): AnyModel[] => {
    const chatRef = currentRoleRef('chat');
    const visionRef = currentRoleRef('vision');
    const score = (m: AnyModel): number => {
      if (m.id === chatRef) return 0;
      if (m.id === visionRef) return 1;
      if (m.status === 'deprecated') return 3;
      return 2;
    };
    return [...models].sort((a, b) => {
      const diff = score(a) - score(b);
      if (diff !== 0) return diff;
      return String(a.display_name).localeCompare(String(b.display_name));
    });
  };
  const allModels = sortModels(
    providers.flatMap((p) => (p.models ?? []).map((m: AnyModel) => ({ ...m, providerName: p.name, providerId: p.id, hasKey: p.hasKey, providerEnabled: p.enabled }))),
  );
  const selectedProviderModel = (provider: AnyProvider): AnyModel | undefined =>
    (provider.models ?? []).find((m: AnyModel) => m.id === modelChoice[provider.id]);

  const assignRole = async (role: string, modelRef: string) => {
    if (!modelRef) return;
    const model = allModels.find((m) => m.id === modelRef);
    if (role === 'vision' && !model?.capabilities?.vision) {
      setError('这个模型不支持图片输入，不能设为“看图”模型');
      return;
    }
    setBusy(`assign-${role}-${modelRef}`);
    setError('');
    try {
      await put('/api/roles', { role, modelRef });
      setNotice(`已把「${model?.display_name ?? modelRef}」设为${ROLE_LABELS[role] ?? role}模型`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const revealKey = async () => {
    if (!editing) return;
    if (!confirm('完整 API Key 会显示在页面上。请确认没有共享屏幕或录屏。')) return;
    setBusy('reveal-key');
    try {
      const result = await post(`/api/providers/${editing.id}/reveal-key`, {});
      setApiKey(result.apiKey);
      setRevealedKey(true);
      setNotice('已显示完整 Key；关闭弹窗后不会保留');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const openEdit = (provider: AnyProvider) => {
    setEditing(provider);
    setApiKey('');
    setRevealedKey(false);
    setBaseUrl(provider.base_url ?? '');
    setEnabled(Boolean(provider.enabled));
    setProbeResult(null);
  };

  const saveProvider = async () => {
    if (!editing) return;
    setBusy('save-provider');
    try {
      await patch(`/api/providers/${editing.id}`, {
        apiKey: apiKey || undefined,
        baseUrl,
        enabled: apiKey ? true : enabled,
      });
      setEditing(null);
      setNotice('Provider 已保存');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const testProvider = async (provider: AnyProvider) => {
    setBusy(`test-${provider.id}`);
    setProbeResult(null);
    try {
      const result = await post(`/api/providers/${provider.id}/test`, {});
      setProbeResult({ provider: provider.name, ...result.probe });
      setNotice(`${provider.name} 测试完成`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const probe = async (model: AnyModel) => {
    setBusy(`probe-${model.id}`);
    setProbeResult(null);
    try {
      const result = await post(`/api/models/${encodeURIComponent(model.id)}/probe`, {});
      setProbeResult({ model: model.display_name, ...result.probe });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const saveRoles = async () => {
    setBusy('roles');
    try {
      for (const [role, modelRef] of Object.entries(roleDraft)) {
        await put('/api/roles', { role, modelRef: modelRef || null });
      }
      setNotice('角色绑定已保存');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const createProvider = async () => {
    setBusy('create-provider');
    try {
      await post('/api/providers', newProvider);
      setAddingProvider(false);
      setNewProvider({ id: '', name: '', kind: 'openai', baseUrl: '', apiKey: '' });
      setNotice('Provider 已创建');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const createModel = async () => {
    setBusy('create-model');
    try {
      await post('/api/models', {
        providerId: newModel.providerId,
        modelId: newModel.modelId,
        displayName: newModel.displayName || newModel.modelId,
        context: Number(newModel.context),
        maxOutput: Number(newModel.maxOutput),
        input: newModel.vision ? ['text', 'image'] : ['text'],
        features: ['json'],
      });
      setAddingModel(false);
      setNewModel({ providerId: '', modelId: '', displayName: '', context: 32768, maxOutput: 4096, vision: false });
      setNotice('模型已添加');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (loading) return <Spinner label="正在读取模型目录" />;

  return (
    <>
      <PageHeader
        title="模型与密钥"
        description="先填 Key / 启用 Provider，再在 Provider 卡片里直接选模型并设为主对话或看图。角色绑定是高级覆盖，支持 Flash、Pro 等同一家的多个模型。"
        actions={
          <>
            <Button onClick={() => setAddingProvider(true)}>添加 Provider</Button>
            <Button onClick={() => setAddingModel(true)}>添加模型</Button>
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {probeResult ? (
        <Card title={`能力探测：${probeResult.model || probeResult.provider}`} style={{ marginTop: 16 }} actions={<Button size="sm" variant="ghost" onClick={() => setProbeResult(null)}>关闭</Button>}>
          <div className="row">
            <Badge tone={probeResult.text ? 'mint' : 'rose'}>文本 {probeResult.text ? '通过' : '失败'}</Badge>
            <Badge tone={probeResult.json ? 'mint' : 'neutral'}>JSON {probeResult.json ? '通过' : '未通过'}</Badge>
            <Badge tone={probeResult.vision ? 'mint' : 'neutral'}>视觉 {probeResult.vision === true ? '通过' : probeResult.vision === false ? '不支持' : '未知'}</Badge>
            <span className="faint small">{probeResult.latencyMs} ms</span>
          </div>
          {probeResult.errors?.length ? <div className="pre" style={{ marginTop: 10 }}>{probeResult.errors.join('\n')}</div> : null}
        </Card>
      ) : null}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        {providers.map((provider) => (
          <div className="provider-card" key={provider.id}>
            <div className="provider-head">
              <div>
                <div className="provider-name">{provider.name}</div>
                <div className="provider-meta">
                  {provider.kind} · {provider.base_url}
                </div>
              </div>
              <div className="chips">
                <Badge tone={provider.enabled ? 'mint' : 'neutral'}>{provider.enabled ? '启用' : '停用'}</Badge>
                <Badge tone={provider.hasKey ? 'blue' : 'amber'}>{provider.hasKey ? `已配 Key${provider.keyLast4 ? ` · ${provider.keyLast4}` : ''}` : '缺 Key'}</Badge>
              </div>
            </div>
            <div className="provider-meta">
              {(provider.models ?? []).length} 个模型 · {provider.docs_url ? <a href={provider.docs_url} target="_blank" rel="noreferrer">官方文档</a> : '无文档链接'}
            </div>
            {(provider.models ?? []).length > 0 ? (
              <div className="model-pick">
                <span className="field-label">选择这个 Provider 的模型</span>
                <Select
                  value={modelChoice[provider.id] ?? ''}
                  onChange={(e) => setModelChoice((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                >
                  {sortModels(provider.models ?? []).map((m: AnyModel) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                      {currentRoleRef('chat') === m.id ? '（当前对话）' : ''}
                      {currentRoleRef('vision') === m.id ? '（当前看图）' : ''}
                      {m.status === 'deprecated' ? '（已下线）' : ''}
                    </option>
                  ))}
                </Select>
                <div className="row">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!modelChoice[provider.id]}
                    onClick={() => assignRole('chat', modelChoice[provider.id])}
                    loading={busy === `assign-chat-${modelChoice[provider.id]}`}
                  >
                    设为主对话
                  </Button>
                  <Button
                    size="sm"
                    disabled={!selectedProviderModel(provider)?.capabilities?.vision}
                    onClick={() => assignRole('vision', modelChoice[provider.id])}
                    loading={busy === `assign-vision-${modelChoice[provider.id]}`}
                  >
                    设为看图
                  </Button>
                </div>
                <div className="chips">
                  <CapBadge on={Boolean(selectedProviderModel(provider)?.capabilities?.vision)}>视觉</CapBadge>
                  <CapBadge on={Boolean(selectedProviderModel(provider)?.capabilities?.json)}>JSON</CapBadge>
                  <span className="faint small">{selectedProviderModel(provider) ? priceLabel(selectedProviderModel(provider)) : ''}</span>
                </div>
              </div>
            ) : (
              <div className="faint small">还没有模型；点「添加模型」补一个。</div>
            )}
            <div className="provider-actions">
              <Button size="sm" onClick={() => openEdit(provider)}>配置 Key</Button>
              <Button size="sm" variant="ghost" onClick={() => testProvider(provider)} loading={busy === `test-${provider.id}`}>测试</Button>
            </div>
          </div>
        ))}
      </div>

      <Card title="角色绑定" subtitle="主对话负责说话；看图可以独立；记忆和群聊判断建议用便宜模型。" style={{ marginTop: 16 }} actions={<Button variant="primary" size="sm" onClick={saveRoles} loading={busy === 'roles'}>保存角色</Button>}>
        <div className="role-grid">
          {roles.map((role) => (
            <div className="role-card" key={role.role}>
              <div className="role-title">
                <Badge tone={role.role === 'chat' ? 'mint' : role.role === 'vision' ? 'blue' : 'neutral'}>{ROLE_LABELS[role.role] ?? role.role}</Badge>
                {!role.available ? <span className="faint small">不可用：{role.missing}</span> : null}
              </div>
              <Select value={roleDraft[role.role] ?? ''} onChange={(e) => setRoleDraft((prev) => ({ ...prev, [role.role]: e.target.value }))}>
                <option value="">（不绑定）</option>
                {providers.map((provider) => {
                  const models = sortModels(provider.models ?? []).filter((m: AnyModel) => (role.role === 'vision' ? m.capabilities?.vision : true));
                  if (!models.length) return null;
                  return (
                    <optgroup label={provider.name} key={provider.id}>
                      {models.map((m: AnyModel) => (
                        <option value={m.id} key={m.id}>
                          {m.display_name}{m.status === 'deprecated' ? '（已下线）' : ''}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </Select>
              <div className="faint small">
                {ROLE_HINTS[role.role] ?? ''}
                {role.modelRef && role.label ? ` 当前：${role.label}` : ''}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="模型目录" subtitle="能力来自 catalog + 探测结果；模型名/价格会变，这里只做展示和覆盖。" className="flush" style={{ marginTop: 16 }}>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>Provider</th>
                <th>能力</th>
                <th>上下文</th>
                <th>价格</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {allModels.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{m.display_name}</div>
                    <div className="faint small mono">{m.model_id}</div>
                  </td>
                  <td className="muted small">{m.providerName}</td>
                  <td>
                    <div className="chips">
                      <CapBadge on={Boolean(m.capabilities?.vision)}>视觉</CapBadge>
                      <CapBadge on={Boolean(m.capabilities?.json)}>JSON</CapBadge>
                      <CapBadge on={Boolean(m.capabilities?.tools)}>Tools</CapBadge>
                    </div>
                  </td>
                  <td className="small muted">{Math.round((m.context_window ?? 0) / 1000)}k</td>
                  <td className="small muted">{priceLabel(m)}</td>
                  <td>
                    <div className="chips">
                      <Badge tone={m.status === 'deprecated' ? 'rose' : m.providerEnabled ? 'mint' : 'neutral'}>{m.status === 'deprecated' ? '已下线' : m.providerEnabled ? '可用' : 'Provider 停用'}</Badge>
                      {currentRoleRef('chat') === m.id ? <Badge tone="mint">当前对话</Badge> : null}
                      {currentRoleRef('vision') === m.id ? <Badge tone="blue">当前看图</Badge> : null}
                    </div>
                  </td>
                  <td>
                    <div className="row nowrap">
                      <Button size="sm" variant="ghost" onClick={() => probe(m)} loading={busy === `probe-${m.id}`}>探测</Button>
                      <Button size="sm" variant="ghost" disabled={m.status === 'deprecated'} onClick={() => assignRole('chat', m.id)} loading={busy === `assign-chat-${m.id}`}>设为主对话</Button>
                      <Button size="sm" variant="ghost" disabled={!m.capabilities?.vision || m.status === 'deprecated'} onClick={() => assignRole('vision', m.id)} loading={busy === `assign-vision-${m.id}`}>设为看图</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`配置 ${editing?.name ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>取消</Button>
            <Button variant="primary" onClick={saveProvider} loading={busy === 'save-provider'}>保存</Button>
          </>
        }
      >
        <div className="stack">
          {editing?.hasKey ? (
            <Alert tone="info">
              已保存 API Key：尾号 <strong>{editing.keyLast4}</strong>，长度 {editing.keyLength}。
              默认不回显；需要核对时点「显示」，操作会写入审计日志。
            </Alert>
          ) : (
            <Alert tone="warn">还没有保存 API Key。粘贴后点保存。</Alert>
          )}
          <Field label="Base URL">
            <TextInput value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
          </Field>
          <Field
            label="API Key"
            hint={revealedKey ? '完整 Key 已显示；关闭弹窗后不会保留在页面上。' : '留空表示不修改；粘贴时不要带空格、Bearer 前缀或备注。'}
          >
            <div className="row" style={{ alignItems: 'stretch', flexWrap: 'nowrap' }}>
              <TextInput
                type={revealedKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editing?.hasKey ? `已配置（尾号 ${editing.keyLast4}），留空不修改` : 'sk-...'}
                style={{ flex: 1, minWidth: 0 }}
              />
              {editing?.hasKey ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (revealedKey) {
                      setApiKey('');
                      setRevealedKey(false);
                    } else {
                      void revealKey();
                    }
                  }}
                  loading={busy === 'reveal-key'}
                >
                  {revealedKey ? '隐藏' : '显示'}
                </Button>
              ) : null}
            </div>
          </Field>
          <div className="row-between">
            <span className="field-label">启用这个 Provider</span>
            <Toggle checked={enabled} onChange={setEnabled} label={enabled ? '启用' : '停用'} />
          </div>
        </div>
      </Modal>

      <Modal
        open={addingProvider}
        onClose={() => setAddingProvider(false)}
        title="添加自定义 Provider"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddingProvider(false)}>取消</Button>
            <Button variant="primary" onClick={createProvider} loading={busy === 'create-provider'}>创建</Button>
          </>
        }
      >
        <div className="stack">
          <Field label="ID（英文/数字/下划线）"><TextInput value={newProvider.id} onChange={(e) => setNewProvider({ ...newProvider, id: e.target.value })} placeholder="my-provider" /></Field>
          <Field label="显示名称"><TextInput value={newProvider.name} onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })} placeholder="我的中转" /></Field>
          <Field label="协议">
            <Select value={newProvider.kind} onChange={(e) => setNewProvider({ ...newProvider, kind: e.target.value })}>
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="mock">Mock（测试）</option>
            </Select>
          </Field>
          <Field label="Base URL"><TextInput value={newProvider.baseUrl} onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })} placeholder="https://.../v1" /></Field>
          <Field label="API Key（可后填）"><TextInput type="password" value={newProvider.apiKey} onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal
        open={addingModel}
        onClose={() => setAddingModel(false)}
        title="添加自定义模型"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddingModel(false)}>取消</Button>
            <Button variant="primary" onClick={createModel} loading={busy === 'create-model'}>添加</Button>
          </>
        }
      >
        <div className="stack">
          <Field label="Provider">
            <Select value={newModel.providerId} onChange={(e) => setNewModel({ ...newModel, providerId: e.target.value })}>
              <option value="">选择 Provider</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="模型 ID"><TextInput value={newModel.modelId} onChange={(e) => setNewModel({ ...newModel, modelId: e.target.value })} placeholder="qwen2.5-vl:7b" /></Field>
          <Field label="显示名称"><TextInput value={newModel.displayName} onChange={(e) => setNewModel({ ...newModel, displayName: e.target.value })} /></Field>
          <div className="row">
            <Field label="上下文"><TextInput type="number" value={newModel.context} onChange={(e) => setNewModel({ ...newModel, context: Number(e.target.value) })} /></Field>
            <Field label="最大输出"><TextInput type="number" value={newModel.maxOutput} onChange={(e) => setNewModel({ ...newModel, maxOutput: Number(e.target.value) })} /></Field>
          </div>
          <div className="row-between">
            <span className="field-label">支持图片输入</span>
            <Toggle checked={newModel.vision} onChange={(v) => setNewModel({ ...newModel, vision: v })} label={newModel.vision ? '是' : '否'} />
          </div>
        </div>
      </Modal>
    </>
  );
}
