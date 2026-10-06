# Streamer Assist AI Connectors

This repository publishes small, independently versioned provider adapters for Streamer Assist. It contains adapter source and metadata recipes; it does not ship model SDKs or provider CLI binaries. The desktop downloads only the selected adapter pack when it is needed.

The six component IDs are `openai`, `anthropic`, `xai`, `google`, `deepseek`, and `moonshot`. Each lives under `providers/<id>/` and has its own semantic version in `manifest.json`. Release tags use `<id>-v<version>`; publishing one provider does not require changing the other five.

## Adapter boundary

Adapters implement ABI version 1. They describe provider-specific HTTP request bodies and event mappings, usage normalization, CLI analysis plans, CLI model discovery parsing, quota mapping, pricing snapshots, and official CLI release metadata. The desktop owns HTTP transport, cancellation, response limits, process creation, path validation, credentials, encryption, and storage. Adapters receive API keys only as in-memory function arguments; no key is persisted in this repository or included in a model-list URL.

Models are discovered from the selected provider API or installed CLI at runtime. The packs do not seed a static model catalog. Provider pricing rows name one exact model ID and carry a source URL and check date; the app treats these as estimates until the provider reports an actual cost. An unknown model price remains unknown.

## Provider sign-in

The adapter also describes sign-out: Codex, Claude Code, and Grok use their documented logout commands before a fresh login. Antigravity requires a user to enter `/logout` in its TUI. Kimi Code uses ACP logout only after `initialize` advertises `agentCapabilities.auth.logout`; the host never sends that method to an older or unsupported agent. DeepSeek has no CLI logout; the app removes its saved encrypted API key. The host never invents a logout command or treats a status precheck as a substitute for an explicit fresh-login flow.

Each installed adapter carries a fixed `cli.auth` recipe based on the provider's documented CLI entry point. Codex and Claude Code use their documented login and status commands; Grok and Kimi Code use their documented browser/device flows; Antigravity starts its sign-in from the `agy` terminal; DeepSeek uses its API-key flow because it has no official coding CLI login command. The host launches only these fixed argument arrays and validates relayed browser URLs against the adapter's exact HTTPS host allowlist.

Status and progress parsers expose only normalized login state, an approved verification URL, or a one-time device code. They never return raw command output, account details, access tokens, or API keys. API keys are entered in the desktop's encrypted key flow; `keyUrl` points to the provider's HTTPS key console. Provider commands and URL hosts are source-versioned with each component manifest.

## Build and test

Node.js 22 or newer is required. There are no runtime or development npm dependencies.

```sh
npm test
npm run build
node scripts/build-pack.cjs openai
```

`npm run build` creates all six `.saip.json` packages under `dist/`. Each package is a base64 envelope around a JSON payload whose individual files have SHA-256 hashes. `scripts/build-pack.cjs` also writes package digest metadata for release automation.

## Publishing

Push a provider tag such as `openai-v0.1.4` after updating only that provider's manifest. Provider publishing runs independently per tag: it tests all packs, builds the tagged package, publishes the asset once, and verifies GitHub's SHA-256 digest and byte size. A separate catalog workflow runs after each successful provider publish and can also be started manually to refresh the catalog. It verifies the prior catalog bytes against GitHub's digest, validates every prior row against its tagged package, then checks the newest semantic version for each provider against the release tag, asset name, schema, per-file hashes, GitHub digest, and byte size. Catalog rebuilds are serialized; if queued runs coalesce, each rebuild scans all provider releases and selects the latest valid version for every provider. The catalog is plain schema-versioned JSON. The desktop pins this repository and requires GitHub's release asset digest to match the catalog and downloaded package bytes.

After validating the catalog and every selected release against GitHub's API-reported asset digest and size, the catalog workflow also publishes a metadata-only distribution index at `https://raw.githubusercontent.com/yechankun/streamer-assist-ai-connectors/distribution-v1/index.json`. The index includes the exact catalog bytes and the API asset receipts needed to check each package; it does not copy or mirror provider package binaries. A client can fetch this fixed, same-repository URL without spending a user's GitHub REST quota, then download only the fixed GitHub release URLs and verify their bytes against the receipts. This endpoint is an alternate publisher trust path and does not change a client's existing trust policy by itself. A client using it trusts HTTPS and the pinned repository's CI-published `distribution-v1` branch as its publisher anchor; the index is not signed and does not represent a fresh per-client GitHub API attestation. Keep that branch workflow-owned.

GitHub Actions uses only its short-lived repository `GITHUB_TOKEN` for release and distribution-branch writes. No persistent signing key or adapter-specific secret is required. Provider release assets are not overwritten: publish a new semantic version for each change.

## Pricing sources

Initial rate snapshots were checked on 2026-10-06 and contain exact model IDs only. Rates can change; the source link and date travel with each record. DeepSeek's documented UTC peak windows and Gemini's dated introductory rate period are represented in the pricing schema. Runtime xAI model metadata can also supply provider-reported per-model prices. The desktop's import path validates the schema and never treats an estimate as an invoice.

## Contributing

Keep provider-specific behavior in that provider's adapter and keep shared pure transforms in `lib/`. Avoid automatic retries of billable generation requests, API keys in URLs or files, provider error payloads in logs, or tool execution from API responses. Add tests using fixtures and in-memory metadata fetchers; never send paid prompts from tests.

See [README.ko.md](README.ko.md) for Korean documentation.
