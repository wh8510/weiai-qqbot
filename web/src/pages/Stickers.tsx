import React, { useEffect, useState } from 'react';
import { api, del, get } from '../api';
import { Alert, Badge, Button, Card, Empty, Field, PageHeader, Spinner, TextInput } from '../components';

export default function Stickers() {
  const [stickers, setStickers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState('');
  const [emotion, setEmotion] = useState('开心');
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await get('/api/stickers');
      setStickers(data.stickers ?? []);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.append('tags', tags);
      form.append('emotion', emotion);
      form.append('file', file);
      await api('/api/stickers', { method: 'POST', body: form });
      setFile(null);
      setTags('');
      setNotice('表情包已上传');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('删除这个表情包？')) return;
    try {
      await del(`/api/stickers/${id}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <Spinner label="正在读取表情包" />;

  return (
    <>
      <PageHeader title="表情包 / 图片" description="按情绪标签准备一些表情或图片；回复时按 sticker 字段和概率抽取。不要上传版权/他人隐私素材。" />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="上传表情" subtitle="支持 PNG / GIF / WebP">
          <form className="stack" onSubmit={upload}>
            <Field label="图片">
              <input className="input" type="file" accept="image/png,image/gif,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Field label="情绪标签">
              <select className="input select" value={emotion} onChange={(e) => setEmotion(e.target.value)}>
                <option>开心</option><option>无语</option><option>安慰</option><option>猫猫</option><option>害羞</option><option>生气</option><option>困</option><option>惊讶</option>
              </select>
            </Field>
            <Field label="额外标签" hint="可选，用逗号分隔">
              <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="猫, 沙发, 无语" />
            </Field>
            <Button variant="primary" type="submit" loading={uploading} disabled={!file}>上传</Button>
          </form>
        </Card>

        <Card title="说明" subtitle="什么时候会发">
          <ul className="list-reset">
            <li className="list-row"><span>触发</span><span className="muted small">回复计划里的 sticker + 概率</span></li>
            <li className="list-row"><span>默认概率</span><Badge tone="blue">20%</Badge></li>
            <li className="list-row"><span>群里</span><span className="muted small">同样受概率和冷却限制</span></li>
            <li className="list-row"><span>没有匹配</span><span className="muted small">不发，不会报错</span></li>
          </ul>
          <p className="faint small">表情会以图片消息发出，不依赖 QQ 商城表情 ID，所以跨 NapCat 版本更稳。</p>
        </Card>
      </div>

      <Card title={`媒体库（${stickers.length}）`} style={{ marginTop: 16 }}>
        {stickers.length === 0 ? <Empty title="还没有表情/图片" hint="先上传几张猫猫/无语/安慰，聊天会自然很多。" /> : (
          <div className="sticker-grid">
            {stickers.map((s) => (
              <div className="sticker-card" key={s.id}>
                <img src={s.fileUrl} alt={s.tags || s.emotion} loading="lazy" />
                <div className="sticker-meta">
                  <Badge tone="violet">{s.emotion || '未分类'}</Badge>
                  <span className="faint small">{s.tags || ''}</span>
                </div>
                <Button size="sm" variant="danger" onClick={() => remove(s.id)}>删除</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
