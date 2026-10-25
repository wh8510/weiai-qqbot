import React, { useEffect, useState } from 'react';
import { get, setCsrf } from './api';
import { Badge, Button } from './components';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Models from './pages/Models';
import Persona from './pages/Persona';
import Policy from './pages/Policy';
import Sessions from './pages/Sessions';
import Memory from './pages/Memory';
import Proactive from './pages/Proactive';
import Stickers from './pages/Stickers';
import Usage from './pages/Usage';
import Settings from './pages/Settings';
import Debug from './pages/Debug';

interface Me {
  username: string;
  mustChangePassword: boolean;
  csrfToken: string;
  demo: boolean;
  version: string;
}

const NAV = [
  { id: 'dashboard', label: '总览', icon: '◈', group: '运行' },
  { id: 'sessions', label: '会话', icon: '◉', group: '运行' },
  { id: 'debug', label: '调试台', icon: '⌁', group: '运行' },
  { id: 'models', label: '模型与密钥', icon: '◇', group: '配置' },
  { id: 'persona', label: '人格', icon: '✎', group: '配置' },
  { id: 'policy', label: '名单', icon: '☷', group: '配置' },
  { id: 'memory', label: '记忆', icon: '❋', group: '配置' },
  { id: 'stickers', label: '媒体库', icon: '▧', group: '配置' },
  { id: 'proactive', label: '主动行为', icon: '↗', group: '配置' },
  { id: 'usage', label: '用量与预算', icon: '▤', group: '运维' },
  { id: 'settings', label: '系统设置', icon: '⚙', group: '运维' },
] as const;

type PageId = (typeof NAV)[number]['id'];

function pageFromHash(): PageId {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  return (NAV.find((n) => n.id === hash)?.id ?? 'dashboard') as PageId;
}

function ChangePassword({ me, onDone }: { me: Me; onDone: (me: Me) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (next.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || '修改失败');
      setCsrf(data.csrfToken);
      onDone({ ...me, mustChangePassword: false, csrfToken: data.csrfToken });
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
            <h1 className="login-title">先改个密码</h1>
            <p className="login-sub">首次登录必须修改初始密码</p>
          </div>
        </div>
        <div className="stack">
          <label className="field">
            <span className="field-label">当前密码</span>
            <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span className="field-label">新密码（至少 8 位）</span>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">确认新密码</span>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {error ? <div className="alert alert-danger">{error}</div> : null}
          <Button variant="primary" loading={loading} type="submit">
            保存并进入
          </Button>
        </div>
        <p className="login-hint">修改后请删除 data/initial-credentials.txt</p>
      </form>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const refreshMe = async () => {
    try {
      const data = await get<Me>('/api/auth/me');
      setMe(data);
      if (data.csrfToken) setCsrf(data.csrfToken);
    } catch {
      setMe(null);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void refreshMe();
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    const onUnauthorized = () => setMe(null);
    window.addEventListener('companion:unauthorized', onUnauthorized);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('companion:unauthorized', onUnauthorized);
    };
  }, []);

  const navigate = (id: string) => {
    window.location.hash = `#/${id}`;
    setPage(id as PageId);
    setSidebarOpen(false);
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': me?.csrfToken ?? '' } });
    } catch {
      // ignore
    }
    setCsrf('');
    setMe(null);
  };

  if (checking) {
    return (
      <div className="login-page">
        <div className="loading">
          <span className="spinner" />
          <span>正在连接后台</span>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <Login
        onLogin={(data) => {
          if (data.csrfToken) setCsrf(data.csrfToken);
          setMe({
            username: data.username,
            mustChangePassword: data.mustChangePassword,
            csrfToken: data.csrfToken,
            demo: data.demo,
            version: data.version ?? '',
          });
        }}
      />
    );
  }

  if (me.mustChangePassword) return <ChangePassword me={me} onDone={setMe} />;

  const current = NAV.find((n) => n.id === page) ?? NAV[0];
  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">○</div>
          <div>
            <div className="brand-name">OneBot Companion</div>
            <div className="brand-sub">v{me.version || '0.1.0'} · 自托管</div>
          </div>
        </div>
        <nav className="nav">
          {groups.map((group) => (
            <React.Fragment key={group}>
              <div className="nav-label">{group}</div>
              {NAV.filter((n) => n.group === group).map((item) => (
                <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <span>{me.username}</span>
            {me.demo ? <Badge tone="amber">DEMO</Badge> : <span className="dot on" />}
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>
            退出登录
          </Button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="row">
            <button className="icon-btn mobile-only" onClick={() => setSidebarOpen((v) => !v)} aria-label="菜单">
              ☰
            </button>
            <span className="topbar-title">{current.label}</span>
          </div>
          <div className="topbar-actions">
            {me.demo ? <Badge tone="amber">Demo 模式 · 不连 QQ</Badge> : null}
            <Button variant="ghost" size="sm" onClick={() => navigate('debug')}>
              调试台
            </Button>
          </div>
        </header>
        <div className="content">
          {page === 'dashboard' ? <Dashboard navigate={navigate} /> : null}
          {page === 'models' ? <Models /> : null}
          {page === 'persona' ? <Persona /> : null}
          {page === 'policy' ? <Policy /> : null}
          {page === 'sessions' ? <Sessions /> : null}
          {page === 'memory' ? <Memory /> : null}
          {page === 'stickers' ? <Stickers /> : null}
          {page === 'proactive' ? <Proactive /> : null}
          {page === 'usage' ? <Usage /> : null}
          {page === 'settings' ? <Settings /> : null}
          {page === 'debug' ? <Debug /> : null}
        </div>
      </main>
    </div>
  );
}
