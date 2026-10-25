import React, { useEffect, useState } from 'react';
import { get, post, put } from '../api';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Select, Spinner, TextArea, TextInput } from '../components';

const EMPTY = {
  id: '',
  name: '',
  description: '',
  systemPrompt: '',
  styleExamples: '',
  boundaries: '',
  noVisionLines: '',
  voiceStyle: '',
};

export default function Persona() {
  const [personas, setPersonas] = useState<any[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<any>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [versions, setVersions] = useState<any[]>([]);

  const load = async (keep?: string) => {
    setLoading(true);
    try {
      const data = await get('/api/personas');
      setPersonas(data.personas ?? []);
      setActiveId(data.activePersonaId ?? '');
      const id = keep || selectedId || data.activePersonaId || data.personas?.[0]?.id || '';
      setSelectedId(id);
      const found = (data.personas ?? []).find((p: any) => p.id === id);
      if (found) setForm({ ...found });
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    get(`/api/personas/${selectedId}/versions`).then((d) => setVersions(d.versions ?? [])).catch(() => setVersions([]));
  }, [selectedId]);

  const select = (id: string) => {
    setSelectedId(id);
    const found = personas.find((p) => p.id === id);
    if (found) setForm({ ...found });
  };

  const save = async () => {
    if (!form.id) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await put(`/api/personas/${form.id}`, {
        name: form.name,
        description: form.description,
        systemPrompt: form.system_prompt,
        styleExamples: form.style_examples,
        boundaries: form.boundaries,
        noVisionLines: form.no_vision_lines,
        voiceStyle: form.voice_style,
      });
      setNotice('人格已保存；下一条消息生效');
      await load(form.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const activate = async () => {
    if (!form.id) return;
    try {
      await post(`/api/personas/${form.id}/activate`, {});
      setActiveId(form.id);
      setNotice('已设为默认人格');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const data = await post('/api/personas', {
        name: newName,
        systemPrompt: '你是一个普通的网友，说话短、口语化，不要像客服。',
        noVisionLines: '我这边看不到图，你跟我说说图里是什么好不好？',
      });
      setCreating(false);
      setNewName('');
      await load(data.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <Spinner label="正在读取人格" />;

  return (
    <>
      <PageHeader
        title="人格"
        description="人格决定“她是谁、怎么说话、边界在哪”。保存后对下一条消息生效，不用重启。"
        actions={
          <>
            <Button onClick={() => setCreating(true)}>新建人格</Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={!form.id}>保存修改</Button>
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="选择人格" subtitle="每个会话也可以单独绑定人格">
          <div className="stack">
            <Select value={selectedId} onChange={(e) => select(e.target.value)}>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.id === activeId ? '（默认）' : ''}
                </option>
              ))}
            </Select>
            <div className="row">
              {form.id === activeId ? <Badge tone="mint">当前默认人格</Badge> : <Button size="sm" onClick={activate}>设为默认</Button>}
              <Badge tone="blue">{versions.length} 个历史版本</Badge>
            </div>
            <div className="divider" />
            <Field label="人格名称">
              <TextInput value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="一句话描述">
              <TextInput value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="看不了图时的说法" hint="会作为风格参考，不一定是逐字台词。">
              <TextArea value={form.no_vision_lines ?? ''} onChange={(e) => setForm({ ...form, no_vision_lines: e.target.value })} style={{ minHeight: 72 }} />
            </Field>
            <Field label="语音风格（Windows TTS）">
              <TextInput value={form.voice_style ?? ''} onChange={(e) => setForm({ ...form, voice_style: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card title="行为边界" subtitle="这些会进入 system prompt，影响她怎么拒绝、怎么保持边界">
          <Field label="边界与禁忌">
            <TextArea value={form.boundaries ?? ''} onChange={(e) => setForm({ ...form, boundaries: e.target.value })} style={{ minHeight: 180 }} />
          </Field>
          <Field label="说话风格示例" hint="用“对方/你”的短对话示例，比形容词更有效。">
            <TextArea value={form.style_examples ?? ''} onChange={(e) => setForm({ ...form, style_examples: e.target.value })} style={{ minHeight: 180 }} />
          </Field>
        </Card>
      </div>

      <Card title="人格提示词" subtitle="这是核心。不要写“你是 AI 助手”，要写成一个具体的人。" style={{ marginTop: 16 }}>
        <TextArea value={form.system_prompt ?? ''} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} style={{ minHeight: 320 }} />
        <div className="row-between" style={{ marginTop: 10 }}>
          <span className="faint small">建议 300~1200 字；太长会占上下文预算。</span>
          <span className="faint small">{String(form.system_prompt ?? '').length} 字</span>
        </div>
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="新建人格"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>取消</Button>
            <Button variant="primary" onClick={create}>创建</Button>
          </>
        }
      >
        <Field label="人格名称">
          <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：小满 / 阿雨" />
        </Field>
        <p className="faint small">创建后会生成一个基础提示词，再慢慢改。</p>
      </Modal>
    </>
  );
}
