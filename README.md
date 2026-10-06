# Streamer Assist AI Connectors

This repository publishes small, independently versioned provider adapters for Streamer Assist. It contains adapter source and metadata recipes; it does not ship model SDKs or provider CLI binaries. The desktop downloads only the selected adapter pack when it is needed.

The six component IDs are `openai`, `anthropic`, `xai`, `google`, `deepseek`, and `moonshot`. Each lives under `providers/<id>/` and has its own semantic version in `manifest.json`. Release tags use `<id>-v<version>`; publishing one provider does not require changing the other five.

## Adapter boundary

Adapters implement ABI version 1. They describe provider-specific HTTP request bodies and event mappings, usage normalization, CLI analysis plans, CLI model discovery parsing, quota mapping, pricing snapshots, and official CLI release metadata. The desktop owns HTTP transport, cancellation, response limits, process creation, path validation, credentials, encryption, and storage. Adapters receive API keys only as in-memory function arguments; no key is persisted in this repository or included in a model-list URL.

Models are discovered from the selected provider API or installed CLI at runtime. The packs do not seed a static model catalog. Provider pricing rows name one exact model ID and carry a source URL and check date; the app treats these as estimates until the provider reports an actual cost. An unknown model price remains unknown.

## Build and test

Node.js 22 or newer is required. There are no runtime or development npm dependencies.

```sh
npm test
npm run build
node scripts/build-pack.cjs openai
```

`npm run build` creates all six `.saip.json` packages under `dist/`. Each package is a base64 envelope around a JSON payload whose individual files have SHA-256 hashes. `scripts/build-pack.cjs` also writes package digest metadata for release automation.

## Publishing

Push a provider tag such as `openai-v0.1.1` after updating only that provider's manifest. The GitHub Actions workflow tests all packs, builds the tagged package, publishes the provider release asset once, checks GitHub's reported SHA-256 digest and byte size, then updates `catalog-v1/catalog.json` under a concurrency lock. Before updating the catalog it verifies each existing row against the corresponding GitHub release asset digest. The catalog itself is plain schema-versioned JSON. The desktop pins this repository and requires GitHub's release asset digest to match the catalog and downloaded package bytes.

GitHub Actions uses only its short-lived repository `GITHUB_TOKEN` for release writes. No persistent signing key or adapter-specific secret is required. Provider release assets are not overwritten: publish a new semantic version for each change.

## Pricing sources

Initial rate snapshots were checked on 2026-10-06 and contain exact model IDs only. Rates can change; the source link and date travel with each record. DeepSeek's documented UTC peak windows and Gemini's dated introductory rate period are represented in the pricing schema. Runtime xAI model metadata can also supply provider-reported per-model prices. The desktop's import path validates the schema and never treats an estimate as an invoice.

## Contributing

Keep provider-specific behavior in that provider's adapter and keep shared pure transforms in `lib/`. Avoid automatic retries of billable generation requests, API keys in URLs or files, provider error payloads in logs, or tool execution from API responses. Add tests using fixtures and in-memory metadata fetchers; never send paid prompts from tests.

See [README.ko.md](README.ko.md) for Korean documentation.
