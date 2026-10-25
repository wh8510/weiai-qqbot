# Contributing

## Before you start

- Node.js 22+
- `pnpm install`
- `pnpm typecheck`
- `pnpm test`

## Good first contributions

- Update `catalog/providers.yaml` with a new model/price/capability. Include the official docs URL and a `source` field.
- Add an OneBot compatibility fix (NapCat / Lagrange / LLOneBot).
- Add a TTS or vision adapter.
- Improve Chinese/English docs.

## Model catalog PRs

- Do not invent capabilities. If unverified, leave `input: [text]` and let the runtime probe it.
- Include `status` (`active` / `deprecated` / `preview`) and `successor` when a model is retired.
- Prices are per 1,000,000 tokens and in the provider's currency.
- Keep `catalog/providers.yaml` valid YAML; CI should parse it.

## Code style

- TypeScript strict.
- No secrets in code, tests, or fixtures.
- Do not add telemetry.
- Do not bundle copyrighted stickers/personas.
- Keep protocol/model-specific logic in adapters, not in the conversation runtime.

## Security

Do not include real user data or API keys in issues/PRs. See [docs/SECURITY.md](docs/SECURITY.md).
