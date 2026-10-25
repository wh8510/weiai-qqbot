# OneBot Companion

A self-hosted, capability-aware AI companion for **OneBot 11** (NapCat, Lagrange, LLOneBot, …).

It is not a simple request/response bot. It has a persona, relationship state, long-term memory, proactive behaviour, probability controls and a hard budget guard. It sends multiple short bubbles, stickers, and — on Windows — voice messages. If the selected model cannot see images, it says so **in character** instead of pretending.

> Status: `0.1.0`. The complete flow is covered by the bundled mock OneBot / mock LLM tests. Real NapCat integration still needs a reachable WS URL and token.

## Features

- Private and group chats with independent sessions.
- Allow/deny lists (private, group, group member); deny-by-default, owner bypass.
- Web admin with generated first-run credentials and forced password change.
- DeepSeek, OpenAI, Anthropic Claude, Google Gemini, Kimi, Qwen, GLM, MiniMax, Grok, OpenRouter, Ollama, and any OpenAI-compatible endpoint.
- **Model catalog + capability probe**: text, JSON, and vision are verified against a generated test image. Images take one of three paths: direct, vision fallback, or in-character “I can’t see it”.
- Persona editor with style examples, boundaries, no-vision lines, and version history.
- Memory: rolling summary, structured facts, episodes, diaries, open loops, relationship state.
- Proactive messages: time/relationship/open-loop aware, quiet hours, daily caps, backoff, cancellation when the user replies.
- Human-ish delivery: 1–4 bubbles, typing delays, read delays, stickers, quote replies, Windows SAPI voice.
- Token/cost accounting, per-day and per-session budgets, pre-reservation to prevent overspend.
- Field-level AES-256-GCM encryption for message content, sender names, summaries, facts, diaries, outbox/jobs payloads, and API keys; Argon2id admin passwords.
- Windows scripts + Linux Docker; CI matrix.

## Quick start (demo, no QQ/API key)

```bash
pnpm install
pnpm build
pnpm demo
```

Open <http://127.0.0.1:18080>, log in with the generated credentials, and use the debug console.

## Quick start (production)

```bash
cp .env.example .env
# edit ONEBOT_TOKEN and provider API keys, then:
docker compose up -d --build
```

Admin binds to `127.0.0.1:8080` by default; put Caddy/Nginx with HTTPS in front. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

NapCat: create a **WebSocket client** pointing to `ws://<host>:8080/onebot/v11/ws` with the same access token. Add allowed QQ/group IDs in the admin UI, add a provider key, and bind the `chat` role.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Security & threat model](docs/SECURITY.md)
- [Model capabilities](docs/MODEL_CAPABILITIES.md)
- [Persona guide](docs/PERSONA.md)
- [FAQ](docs/FAQ.md)

## Commands

```bash
pnpm dev:server
pnpm dev:web
pnpm build
pnpm start
pnpm demo
pnpm test
pnpm typecheck
pnpm cli doctor
pnpm cli backup
```

## Limitations

- Real NapCat integration is pending a reachable endpoint.
- Full-database SQLCipher is not enabled by default because a stable prebuilt is not available for this Windows/Node 24 setup; sensitive fields are encrypted instead. Use disk encryption on Linux.
- Voice is Windows-only (SAPI). Linux TTS is intentionally disabled.
- ASR, video, AI image generation, a plugin marketplace, and multi-account UI are out of scope for v1.

## Disclaimer

Not affiliated with Tencent, QQ, NapCat, or any model vendor. Unofficial QQ protocol implementations carry account-risk. Use an alt account, comply with the QQ ToS and local law, and do not use this project for spam, harassment, or fraud.

## License

MIT
