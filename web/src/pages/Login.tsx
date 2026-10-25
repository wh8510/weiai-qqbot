import React, { useState } from 'react';
import { post } from '../api';
import { Button } from '../components';

export default function Login({ onLogin }: { onLogin: (data: any) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await post('/api/auth/login', { username, password });
      onLogin(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="brand-mark">○</div>
          <div>
            <h1 className="login-title">OneBot Companion</h1>
            <p className="login-sub">自托管 AI 聊天伴侣 · 管理端</p>
          </div>
        </div>
        <div className="stack">
          <label className="field">
            <span className="field-label">用户名</span>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
          </label>
          <label className="field">
            <span className="field-label">密码</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="首次启动密码见 data/initial-credentials.txt"
            />
          </label>
          {error ? <div className="alert alert-danger login-error">{error}</div> : null}
          <Button variant="primary" type="submit" loading={loading}>
            登录
          </Button>
        </div>
        <p className="login-hint">
          首次启动会自动生成管理员账号密码，保存在 <span className="code">data/initial-credentials.txt</span>
          <br />
          登录后必须修改密码。
        </p>
      </form>
    </div>
  );
}
