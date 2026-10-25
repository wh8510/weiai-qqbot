let csrfToken = localStorage.getItem('companion_csrf') ?? '';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = 'UNKNOWN') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function setCsrf(token: string): void {
  csrfToken = token;
  if (token) localStorage.setItem('companion_csrf', token);
  else localStorage.removeItem('companion_csrf');
}

export function getCsrf(): string {
  return csrfToken;
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }
  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(path, {
    ...options,
    body,
    headers,
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('companion:unauthorized'));
  }
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new ApiError(data?.message || `请求失败 (${response.status})`, response.status, data?.error ?? 'UNKNOWN');
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: any) => api<T>(path, { method: 'POST', body });
export const put = <T = any>(path: string, body?: any) => api<T>(path, { method: 'PUT', body });
export const patch = <T = any>(path: string, body?: any) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export function formatMoney(value: number, currency = 'CNY'): string {
  const symbol = currency === 'USD' ? '$' : '¥';
  const n = Number(value || 0);
  return `${symbol}${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
}

export function formatDate(ts?: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export function timeAgo(ts?: number | null): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}
