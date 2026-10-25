/**
 * Local end-to-end smoke test: pretend to be NapCat, connect to the reverse WS
 * endpoint, send a private message, answer the send_private_msg action, then
 * print the stored conversation.
 *
 * Usage:
 *   node scripts/smoke-onebot.mjs
 *   BASE=http://127.0.0.1:18080 PASSWORD=... QQ=10001 node scripts/smoke-onebot.mjs
 */
import WebSocket from 'ws';

const base = process.env.BASE ?? 'http://127.0.0.1:18080';
const password = process.env.PASSWORD ?? 'DemoAdmin456!';
const qq = process.env.QQ ?? '10001';
const selfId = process.env.SELF_ID ?? '999';
const token = process.env.ONEBOT_TOKEN ?? '';

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: process.env.ADMIN_USER ?? 'admin', password }),
});
const loginData = await login.json();
if (!login.ok) throw new Error(`login failed: ${JSON.stringify(loginData)}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const csrf = loginData.csrfToken;
const headers = { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };

const send = (path, method, body) =>
  fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
    return text ? JSON.parse(text) : {};
  });

// Demo defaults: make sure the chat/vision roles are usable, and allow the peer.
await send('/api/roles', 'PUT', { role: 'chat', modelRef: 'demo:demo-model' });
await send('/api/roles', 'PUT', { role: 'vision', modelRef: 'demo:demo-model' });
await send('/api/policy', 'POST', { scope: 'private', action: 'allow', targetId: qq, note: 'smoke test' });

const wsUrl = base.replace(/^http/, 'ws') + '/onebot/v11/ws' + (token ? `?access_token=${encodeURIComponent(token)}` : '');
const ws = new WebSocket(wsUrl, {
  headers: {
    'x-self-id': selfId,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
});

let sent = false;
const timer = setTimeout(() => {
  console.error('timeout waiting for send_private_msg');
  process.exit(1);
}, 15000);

ws.on('open', () => {
  console.log('connected to', wsUrl);
  setTimeout(() => {
    ws.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        self_id: Number(selfId),
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        message_id: 1001,
        user_id: Number(qq),
        message: [{ type: 'text', data: { text: '今天好累' } }],
        raw_message: '今天好累',
        sender: { user_id: Number(qq), nickname: '测试好友' },
      }),
    );
  }, 300);
});

ws.on('message', async (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.action === 'get_login_info') {
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: Number(selfId), nickname: 'MockBot' }, echo: message.echo }));
    return;
  }
  if (message.action === 'send_private_msg') {
    console.log('send_private_msg:', JSON.stringify(message.params));
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 5001 }, echo: message.echo }));
    sent = true;
    clearTimeout(timer);
    setTimeout(async () => {
      const sessions = await send('/api/sessions', 'GET');
      const session = sessions.sessions.find((s) => s.kind === 'private' && s.peer_id === qq);
      if (session) {
        const messages = await send(`/api/sessions/${session.id}/messages?limit=20`, 'GET');
        console.log('stored messages:');
        for (const m of messages.messages) console.log(`  ${m.direction} ${m.sender_name}: ${m.text}`);
      }
      ws.close();
      process.exit(sent ? 0 : 1);
    }, 3500);
  }
});

ws.on('error', (err) => {
  console.error('ws error:', err.message);
  process.exit(1);
});
