import React, { useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';

export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []): {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((value) => {
        if (alive) {
          setData(value);
          setError('');
        }
      })
      .catch((err) => {
        if (alive) setError(err?.message ?? String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((n) => n + 1) };
}

export function Button({
  variant = 'default',
  size = 'md',
  loading,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'subtle'; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...props} disabled={props.disabled || loading}>
      {loading ? <span className="spinner-dot" /> : null}
      {children}
    </button>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {title || actions ? (
        <header className="card-head">
          <div>
            {title ? <h2 className="card-title">{title}</h2> : null}
            {subtitle ? <p className="card-sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: 'mint' | 'blue' | 'amber' | 'rose' }) {
  return (
    <div className={`stat ${accent ? `stat-${accent}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'mint' | 'blue' | 'amber' | 'rose' | 'violet' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${props.className ?? ''}`} {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input textarea ${props.className ?? ''}`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input select ${props.className ?? ''}`} {...props} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span className="toggle-knob" />
      {label ? <span className="toggle-label">{label}</span> : null}
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-glyph">◌</div>
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'success'; children: ReactNode }) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function Progress({ value, max, tone = 'mint' }: { value: number; max: number; tone?: 'mint' | 'amber' | 'rose' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress">
      <div className={`progress-bar progress-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function MiniBars({ data, valueKey = 'cost', height = 120 }: { data: any[]; valueKey?: string; height?: number }) {
  const max = Math.max(0.000001, ...data.map((d) => Number(d[valueKey] ?? 0)));
  return (
    <div className="mini-bars" style={{ height }}>
      {data.map((d) => {
        const h = Math.max(3, (Number(d[valueKey] ?? 0) / max) * (height - 24));
        return (
          <div className="mini-bar-wrap" key={d.date} title={`${d.date}: ${d[valueKey]}`}>
            <div className="mini-bar" style={{ height: h }} />
            <span>{String(d.date).slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

export function ChatBubble({ direction, name, text, at }: { direction: 'in' | 'out'; name?: string; text: string; at?: number }) {
  return (
    <div className={`bubble-row ${direction === 'out' ? 'out' : 'in'}`}>
      <div className={`bubble ${direction === 'out' ? 'bubble-out' : 'bubble-in'}`}>
        {name ? <div className="bubble-name">{name}</div> : null}
        <div className="bubble-text">{text}</div>
        {at ? <div className="bubble-time">{new Date(at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}</div> : null}
      </div>
    </div>
  );
}
