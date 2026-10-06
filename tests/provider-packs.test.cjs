"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildPack, IDS } = require("../scripts/build-pack.cjs");
const { makeCatalog, REPOSITORY } = require("../scripts/build-catalog.cjs");

const adapter = id => require(`../providers/${id}/adapter.cjs`);
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const jobDirectory = path.join(os.tmpdir(), "saip-jobs", "one");
function validatePricing(rows) {
  assert.ok(Array.isArray(rows) && rows.length > 0);
  const seen = new Set();
  const validRates = ["inputPerMillion", "outputPerMillion", "cachedInputPerMillion", "cacheWriteInputPerMillion", "cacheWrite5mInputPerMillion", "cacheWrite1hInputPerMillion"];
  for (const row of rows) {
    assert.deepEqual([row.schemaVersion, row.type, row.currency], [1, "model-pricing", "USD"]);
    assert.match(row.providerId, /^[a-z0-9][a-z0-9-]{0,39}$/);
    assert.match(row.modelId, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/);
    assert.equal(seen.has(row.modelId), false, "pricing IDs are unique within a provider");
    seen.add(row.modelId);
    for (const key of validRates) if (row[key] !== undefined) assert.ok(Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 1_000_000);
    assert.ok(Number.isFinite(row.inputPerMillion) && Number.isFinite(row.outputPerMillion));
    if (row.source !== undefined) assert.equal(new URL(row.source).protocol, "https:");
    if (row.checkedAt !== undefined) assert.match(row.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    if (row.longContext) { assert.ok(Number.isSafeInteger(row.longContextThreshold) && row.longContextThreshold > 0); assert.ok(Object.entries(row.longContext).some(([key, value]) => validRates.includes(key) && Number.isFinite(value))); }
    if (row.rateWindows) for (const window of row.rateWindows) { assert.ok(Array.isArray(window.weekdaysUtc) && window.weekdaysUtc.length); assert.ok(window.startMinuteUtc >= 0 && window.endMinuteUtc <= 1440 && window.startMinuteUtc < window.endMinuteUtc); }
    if (row.ratePeriods) for (const period of row.ratePeriods) { assert.ok(period.validFrom || period.validThrough); assert.ok(Object.entries(period).some(([key, value]) => validRates.includes(key) && Number.isFinite(value))); }
  }
}

test("all six manifests and adapter descriptors match the desktop ABI", () => {
  const expected = {
    openai: ["responses", "codex", "codex-app-server", "codex-rate-limits"],
    anthropic: ["anthropic", "claude", "claude-initialize", "claude-events"],
    xai: ["chat", "grok", "grok-models", "unsupported"],
    google: ["gemini", "agy", "agy-models", "unsupported"],
    deepseek: ["chat", "codex", "codex-app-server", "unsupported"],
    moonshot: ["chat", "kimi", "kimi-acp", "unsupported"],
  };
  for (const id of IDS) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "providers", id, "manifest.json"), "utf8"));
    const current = adapter(id);
    assert.deepEqual([manifest.id, manifest.abiVersion, manifest.entry], [id, 1, "adapter.cjs"]);
    assert.equal(current.abiVersion, 1);
    assert.deepEqual([current.provider.protocol, current.provider.cliId, current.cli.models.driver, current.cli.quota.driver], expected[id]);
    for (const hook of ["buildRequest", "parseEvent", "buildModelsRequest", "parseModelsResponse", "normalizeUsage"]) assert.equal(typeof current.api[hook], "function");
    assert.equal(typeof current.cli.analysisPlan, "function");
    assert.deepEqual(current.cli.loginArgs, []);
    assert.ok(current.cli.auth);
    assert.equal(typeof current.cli.auth.kind, "string");
    assert.equal(typeof current.cli.auth.instructions, "string");
    assert.equal(new URL(current.cli.auth.keyUrl).protocol, "https:");
    assert.ok(current.runtime && typeof current.runtime.resolveRelease === "function");
  }
});

test("login recipes use documented provider commands and return only safe auth state", () => {
  const openai = adapter("openai").cli.auth;
  assert.deepEqual(openai.loginArgs, ["login"]);
  assert.deepEqual(openai.statusArgs, ["login", "status"]);
  assert.equal(openai.requiresTty, false);
  assert.deepEqual(openai.parseStatus({ exitCode: 0, stdout: "Logged in using ChatGPT" }), { authenticated: true });
  assert.deepEqual(openai.parseStatus({ exitCode: 1, stderr: "No credentials" }), { authenticated: false });
  assert.equal(openai.parseStatus({ exitCode: 2 }), null);
  assert.deepEqual(openai.parseProgress({ text: "Open https://auth.openai.com/authorize?client_id=cli&state=private-state&code_challenge=challenge" }), {
    url: "https://auth.openai.com/authorize?client_id=cli&state=private-state&code_challenge=challenge",
  });
  assert.equal(openai.parseProgress({ text: "https://auth.openai.com/authorize?api_key=must-not-pass" }), null);

  const anthropic = adapter("anthropic").cli.auth;
  assert.deepEqual(anthropic.loginArgs, ["auth", "login"]);
  assert.deepEqual(anthropic.statusArgs, ["auth", "status"]);
  assert.equal(anthropic.requiresTty, false);
  assert.deepEqual(anthropic.parseStatus({ exitCode: 0, stdout: JSON.stringify({ authMethod: "claude.ai", configDirectory: "private/path", token: "never-return" }) }), { authenticated: true });
  assert.deepEqual(anthropic.parseStatus({ exitCode: 1, stdout: JSON.stringify({ authMethod: "none", token: "never-return" }) }), { authenticated: false });
  assert.equal(anthropic.parseStatus({ exitCode: 0, stdout: JSON.stringify({ authMethod: "unrecognized", token: "never-return" }) }), null);
  assert.deepEqual(anthropic.parseProgress({ text: "Sign in at https://claude.ai/oauth/authorize?client_id=cli&response_type=code&state=state" }), {
    url: "https://claude.ai/oauth/authorize?client_id=cli&response_type=code&state=state",
  });
  assert.equal(anthropic.parseProgress({ text: "https://evil.example/oauth/authorize?state=x" }), null);

  const grok = adapter("xai").cli.auth;
  assert.deepEqual(grok.loginArgs, ["login"]);
  assert.equal(grok.kind, "browser");
  assert.equal(grok.requiresTty, false);
  assert.deepEqual(grok.parseProgress({ text: "Continue: https://auth.x.ai/authorize?client_id=cli&response_type=code&state=safe-state&code_challenge=challenge" }), {
    url: "https://auth.x.ai/authorize?client_id=cli&response_type=code&state=safe-state&code_challenge=challenge",
  });
  assert.equal(grok.parseProgress({ text: "https://auth.x.ai/authorize?access_token=secret" }), null);
  assert.equal(grok.parseProgress({ text: "https://evil.example/authorize?state=x" }), null);
  assert.equal(grok.parseProgress({ text: "https://user:pass@auth.x.ai/authorize" }), null);
  assert.equal(grok.parseProgress({ text: "https://auth.x.ai/authorize#token=secret" }), null);

  const kimi = adapter("moonshot").cli.auth;
  assert.deepEqual(kimi.loginArgs, ["login"]);
  assert.equal(kimi.kind, "device");
  assert.equal(kimi.requiresTty, false);
  assert.deepEqual(kimi.parseProgress({ text: "Visit https://www.kimi.ai/code and enter user code: abcd-1234" }), {
    url: "https://www.kimi.ai/code", code: "ABCD-1234",
  });
  assert.equal(kimi.parseProgress({ text: "Visit https://evil.example/code and enter user code: AB-1234" }), null);
  assert.equal(kimi.parseProgress({ text: "access_token: should-not-be-forwarded" }), null);

  const google = adapter("google").cli.auth;
  assert.equal(google.kind, "terminal");
  assert.deepEqual(google.loginArgs, []);
  assert.equal(google.requiresTty, true);
  assert.match(google.instructions, /models/i);
  assert.equal(google.parseStatus, undefined);

  const deepseek = adapter("deepseek").cli.auth;
  assert.equal(deepseek.kind, "api-key");
  assert.deepEqual(deepseek.loginArgs, []);
  assert.match(deepseek.instructions, /no official CLI/i);
  assert.equal(deepseek.parseStatus, undefined);

  for (const id of IDS) {
    const current = adapter(id).cli.auth;
    assert.ok(current.keyUrl.startsWith("https://"));
    assert.equal(current.keyUrl.includes("@"), false);
    assert.ok(Array.isArray(current.authHosts));
  }
});

test("API request builders keep credentials in headers and preserve provider-specific effort protocols", () => {
  const key = "never-put-this-in-a-url-or-error";
  const prompt = { system: "system", user: "untrusted transcript" };
  const openai = adapter("openai").api.buildRequest({ provider: adapter("openai").provider, key, model: "gpt-6.1-sol", effort: "max", prompt });
  assert.equal(openai.method, "POST");
  assert.equal(openai.url, "https://api.openai.com/v1/responses");
  assert.equal(openai.headers.authorization, `Bearer ${key}`);
  assert.equal(new URL(openai.url).search, "");
  assert.equal(JSON.parse(openai.body).reasoning.effort, "max");
  assert.equal(JSON.parse(openai.body).store, false);
  assert.equal("tools" in JSON.parse(openai.body), false);
  assert.throws(() => adapter("openai").api.buildRequest({ provider: adapter("openai").provider, key, model: "gpt-6.1-sol", effort: "none", prompt }), { code: "unsupported_effort" });

  const claude = adapter("anthropic").api.buildRequest({ provider: adapter("anthropic").provider, key, model: "claude-sonnet-4-6", effort: "high", prompt });
  assert.equal(claude.headers["x-api-key"], key);
  assert.equal(claude.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(JSON.parse(claude.body).thinking, { type: "adaptive" });
  assert.deepEqual(JSON.parse(claude.body).output_config, { effort: "high" });
  assert.equal("tools" in JSON.parse(claude.body), false);

  const deepseek = adapter("deepseek").api.buildRequest({ provider: adapter("deepseek").provider, key, model: "deepseek-flash", effort: "none", prompt });
  assert.deepEqual(JSON.parse(deepseek.body).thinking, { type: "disabled" });
  assert.equal(JSON.parse(deepseek.body).stream_options.include_usage, true);

  const kimi = adapter("moonshot").api.buildRequest({ provider: adapter("moonshot").provider, key, model: "kimi-k3", effort: "max", prompt });
  assert.equal(JSON.parse(kimi.body).max_completion_tokens, 8192);
  assert.equal(JSON.parse(kimi.body).reasoning_effort, "max");
  assert.equal("max_tokens" in JSON.parse(kimi.body), false);

  const gemini = adapter("google").api.buildRequest({ provider: adapter("google").provider, key, model: "gemini-3.8-flash", effort: "high", prompt });
  assert.equal(gemini.headers["x-goog-api-key"], key);
  assert.equal(new URL(gemini.url).searchParams.get("alt"), "sse");
  assert.equal(JSON.parse(gemini.body).generationConfig.thinkingConfig.thinkingLevel, "high");
  assert.equal("tools" in JSON.parse(gemini.body), false);
  for (const request of [openai, claude, deepseek, kimi, gemini]) {
    assert.equal(request.url.includes(key), false);
    assert.equal(request.body.includes(key), false);
  }
});

test("model-list requests, cursors, effort rows, and xAI-only fallback are normalized", () => {
  const a = adapter("anthropic");
  const request = a.api.buildModelsRequest({ provider: a.provider, key: "secret", cursor: "after-model" });
  assert.equal(new URL(request.url).searchParams.get("limit"), "1000");
  assert.equal(new URL(request.url).searchParams.get("after_id"), "after-model");
  assert.equal(request.headers["x-api-key"], "secret");
  const page = a.api.parseModelsResponse({ payload: { data: [{ id: "claude-sonnet-4-6", display_name: "Sonnet", supportedEffortLevels: ["low", "high"] }], has_more: true, last_id: "claude-sonnet-4-6" } });
  assert.deepEqual(page, { models: [{ id: "claude-sonnet-4-6", name: "Sonnet", efforts: ["low", "high"] }], nextCursor: "claude-sonnet-4-6", hasMore: true });
  const deepseekModels = adapter("deepseek").api.parseModelsResponse({ payload: { data: [{ id: "deepseek-flash" }, { id: "custom-model", supportsEffort: false }] } });
  assert.deepEqual(deepseekModels.models, [{ id: "deepseek-flash" }, { id: "custom-model", efforts: [] }]);
  assert.deepEqual(adapter("deepseek").provider.effortsFor({ mode: "api", model: "custom-model", row: deepseekModels.models[1] }), []);

  const gemini = adapter("google");
  const geminiPage = gemini.api.buildModelsRequest({ provider: gemini.provider, key: "secret", cursor: "next" });
  assert.equal(new URL(geminiPage.url).searchParams.get("pageToken"), "next");
  assert.deepEqual(gemini.api.parseModelsResponse({ payload: { models: [{ name: "models/gemini-3.8-flash", displayName: "Flash" }], nextPageToken: "next" } }), {
    models: [{ id: "gemini-3.8-flash", name: "Flash" }], nextCursor: "next", hasMore: true,
  });

  const xai = adapter("xai");
  assert.equal(new URL(xai.api.buildModelsRequest({ provider: xai.provider, key: "k" }).url).pathname, "/v1/language-models");
  assert.equal(new URL(xai.api.buildModelsFallbackRequest({ provider: xai.provider, key: "k" }).url).pathname, "/v1/models");
  assert.equal(adapter("openai").api.buildModelsFallbackRequest, undefined);
  const xaiPage = xai.api.parseModelsResponse({ payload: { models: [{ id: "grok-4.7", capabilities: { reasoning_effort: ["low", "medium", "high", "xhigh"], default_reasoning_effort: "high" }, prompt_text_token_price: 20000, cached_prompt_text_token_price: 5000, completion_text_token_price: 60000, prompt_text_token_price_long_context: 40000, cached_prompt_text_token_price_long_context: 10000, completion_text_token_price_long_context: 90000, long_context_threshold: 200000 }] } });
  assert.deepEqual(xaiPage.models[0].efforts, ["low", "medium", "high", "xhigh"]);
  assert.equal(xaiPage.models[0].defaultEffort, "high");
  assert.equal(xaiPage.models[0].pricing.inputPerMillion, 2);
  assert.equal(xaiPage.models[0].pricing.cachedInputPerMillion, .5);
  assert.deepEqual(xaiPage.models[0].pricing.longContext, { inputPerMillion: 4, outputPerMillion: 9, cachedInputPerMillion: 1 });
});

test("stream parsers return text, usage, and explicit terminal/tool/error states", () => {
  const openai = adapter("openai").api;
  assert.deepEqual(openai.parseEvent({ event: "response.output_text.delta", data: JSON.stringify({ delta: "hi" }) }), { text: "hi", appendText: true });
  const final = openai.parseEvent({ event: "response.completed", data: JSON.stringify({ response: { status: "completed", usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } }) });
  assert.equal(final.done, true);
  assert.deepEqual(final.usage, { inputTokens: 5, uncachedInputTokens: 5, outputTokens: 2, totalTokens: 7 });
  assert.equal(openai.parseEvent({ event: "response.output_item.added", data: JSON.stringify({ item: { type: "function_call" } }) }).toolRequest, true);
  assert.equal(openai.parseEvent({ event: "response.incomplete", data: "{}" }).incomplete, true);

  const chat = adapter("deepseek").api;
  assert.equal(chat.parseEvent({ data: JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0 }] } }] }) }).toolRequest, true);
  assert.equal(chat.parseEvent({ data: JSON.stringify({ choices: [{ finish_reason: "stop", delta: { content: "ok" } }] }) }).done, true);
  assert.equal(chat.parseEvent({ data: JSON.stringify({ error: { message: "secret echoed by server" } }) }).error, "provider_error");

  const anthropic = adapter("anthropic").api;
  assert.deepEqual(anthropic.parseEvent({ event: "content_block_delta", data: JSON.stringify({ delta: { type: "text_delta", text: "A" } }) }), { text: "A", appendText: true });
  assert.equal(anthropic.parseEvent({ event: "content_block_start", data: JSON.stringify({ content_block: { type: "tool_use" } }) }).toolRequest, true);
  assert.equal(anthropic.parseEvent({ event: "message_delta", data: JSON.stringify({ delta: { stop_reason: "max_tokens" } }) }).incomplete, true);
  assert.equal(anthropic.parseEvent({ event: "error", data: "{}" }).error, "provider_error");

  const gemini = adapter("google").api;
  assert.deepEqual(gemini.parseEvent({ data: JSON.stringify({ candidates: [{ content: { parts: [{ text: "visible" }, { text: "hidden", thought: true }] }, finishReason: "STOP" }] }) }), { text: "visible", appendText: true, done: true });
  const functionCall = { candidates: [{ content: { parts: [{ functionCall: { name: "x" } }] } }] };
  assert.equal(gemini.parseEvent({ data: JSON.stringify(functionCall) }).toolRequest, true);
});

test("CLI plans are provider-specific, isolated, and use live verified models", () => {
  const transcript = { system: "system", user: "untrusted input" };
  const openai = adapter("openai").cli.analysisPlan({ model: "gpt-6-luna", effort: "max", prompt: transcript, verifiedModels: [] });
  assert.equal(openai.promptMode, "stdin");
  assert.equal(openai.args.at(-1), "-");
  assert.ok(openai.args.includes('model_reasoning_effort="max"'));
  assert.equal(openai.args.includes("--sandbox"), true);
  assert.deepEqual(openai.files, []);

  const liveModels = [{ id: "deepseek-flash", efforts: ["low", "high", "max"], defaultEffort: "high" }];
  const deepseek = adapter("deepseek");
  assert.equal(deepseek.cli.models.requiresApiModelList, true);
  const plan = deepseek.cli.models.buildPlan({ jobDirectory, liveModels });
  assert.deepEqual(plan.files.map(file => file.relativePath), ["deepseek-models.json"]);
  const catalog = JSON.parse(plan.files[0].contents);
  assert.deepEqual(catalog.models.map(row => row.slug), ["deepseek-flash"]);
  assert.deepEqual(catalog.models[0].supported_reasoning_levels.map(row => row.effort), ["low", "high", "max"]);
  assert.ok(plan.args.some(arg => arg.includes('wire_api="responses"')));
  const inferred = deepseek.cli.models.buildPlan({ jobDirectory, liveModels: [{ id: "deepseek-flash" }] });
  assert.deepEqual(JSON.parse(inferred.files[0].contents).models[0].supported_reasoning_levels.map(row => row.effort), ["low", "high", "max"]);
  const analysis = deepseek.cli.analysisPlan({ model: "deepseek-flash", effort: "high", prompt: transcript, jobDirectory, verifiedModels: liveModels });
  assert.equal(analysis.promptMode, "stdin");
  assert.equal(analysis.args.at(-1), "-");
  assert.equal(JSON.stringify(analysis).includes("secret"), false);

  const claude = adapter("anthropic").cli.analysisPlan({ model: "claude-sonnet-4-6", effort: "high", prompt: transcript });
  assert.equal(claude.promptMode, "arg");
  assert.ok(claude.args.includes("--strict-mcp-config"));
  assert.ok(claude.args.includes("--tools"));
  assert.ok(claude.args.includes(""));
  assert.equal(claude.args.at(-1), "system\n\nuntrusted input");
  const kimi = adapter("moonshot").cli.analysisPlan({ model: "kimi-k3", effort: "max", prompt: transcript, jobDirectory });
  assert.equal(kimi.envVars.KIMI_MODEL_THINKING_EFFORT, "max");
  assert.equal(kimi.files.some(file => file.relativePath === "empty-skills/.keep"), true);
  assert.equal(adapter("xai").cli.models.parseOutput({ output: "You are using XAI_API_KEY.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n" }).currentModelId, "grok-4.7");
  assert.equal(adapter("google").cli.models.parseOutput({ output: JSON.stringify({ models: [{ id: "gemini-3.8-flash" }] }) }).models[0].id, "gemini-3.8-flash");
});

test("usage and source-stamped pricing validate against the adapter accounting schema", () => {
  for (const id of IDS) {
    const current = adapter(id);
    assert.doesNotThrow(() => validatePricing(current.pricing));
    assert.ok(current.pricing.every(row => row.providerId === id && row.checkedAt === "2026-10-06"));
  }
  const anthropic = adapter("anthropic").api.normalizeUsage({ raw: { input_tokens: 10, cache_read_input_tokens: 3, cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 1 }, output_tokens: 4 } });
  assert.deepEqual(anthropic, { inputTokens: 16, uncachedInputTokens: 10, cachedInputTokens: 3, cacheWriteInputTokens: 3, cacheWrite5mInputTokens: 2, cacheWrite1hInputTokens: 1, outputTokens: 4, totalTokens: 20 });
  const openai = adapter("openai").api.normalizeUsage({ raw: { input_tokens: 8, input_tokens_details: { cached_tokens: 2 }, output_tokens: 4 } });
  assert.equal(openai.uncachedInputTokens, 6);
  assert.equal(openai.totalTokens, 12);
});

test("runtime release recipes are metadata-only and constrain official hosts", async () => {
  const codex = adapter("openai").runtime;
  const calls = [];
  const release = await codex.resolveRelease({ platform: "win32", arch: "x64", version: "1.2.3", componentId: "codex" }, {
    async fetchJson(url) {
      calls.push(url);
      if (calls.length === 1) return { version: "1.2.3", optionalDependencies: { "@openai/codex-win32-x64": "npm:@openai/codex-win32-x64@1.2.3" } };
      return { version: "1.2.3", dist: { integrity: `sha512-${"A".repeat(86)}==`, tarball: "https://registry.npmjs.org/@openai/codex-win32-x64/-/codex.tgz" } };
    },
    async fetchText() { throw new Error("unexpected metadata request"); },
  });
  assert.equal(release.version, "1.2.3");
  assert.equal(release.artifact, "tar.gz");
  assert.equal(release.url.startsWith("https://registry.npmjs.org/"), true);
  assert.equal(calls.length, 2);
  await assert.rejects(codex.resolveRelease({ platform: "linux", arch: "x64" }, {}), /Windows/);

  const google = adapter("google").runtime;
  const agy = await google.resolveRelease({ platform: "win32", arch: "x64" }, {
    async fetchJson() { return { version: "2.0.0", url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/agy.exe", sha512: "a".repeat(128) }; },
    async fetchText() { throw new Error("unexpected metadata request"); },
  });
  assert.equal(agy.checksum.algorithm, "sha512");
  assert.equal(agy.executable, "agy.exe");
});

test("build output matches payload envelope and catalog digest contract", () => {
  let catalog = null;
  for (const id of IDS) {
    const built = buildPack(id);
    const envelope = JSON.parse(built.envelopeBytes.toString("utf8"));
    const payloadBytes = Buffer.from(envelope.payload, "base64");
    const payload = JSON.parse(payloadBytes.toString("utf8"));
    assert.deepEqual(Object.keys(envelope), ["payload"]);
    assert.deepEqual([payload.schemaVersion, payload.abiVersion, payload.id, payload.entry], [1, 1, id, "adapter.cjs"]);
    const wrapper = payload.files.find(file => file.path === "adapter.cjs");
    assert.ok(wrapper);
    for (const file of payload.files) assert.equal(digest(Buffer.from(file.content, "base64")), file.sha256);
    const extracted = fs.mkdtempSync(path.join(os.tmpdir(), "saip-pack-test-"));
    try {
      for (const file of payload.files) {
        const target = path.join(extracted, ...file.path.split("/"));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(file.content, "base64"));
      }
      const loaded = require(path.join(extracted, payload.entry));
      assert.equal(loaded.provider.id, id);
      assert.equal(typeof loaded.cli.auth.kind, "string", "installed packs include their login recipe module");
    } finally {
      fs.rmSync(extracted, { recursive: true, force: true });
    }
    assert.equal(digest(built.envelopeBytes), built.metadata.sha256);
    assert.equal(built.envelopeBytes.length, built.metadata.size);
    catalog = makeCatalog(catalog, built.metadata, "2026-10-06T00:00:00.000Z");
  }
  assert.equal(catalog.repository, REPOSITORY);
  assert.deepEqual(new Set(catalog.components.map(row => row.id)), new Set(IDS));
  assert.equal(catalog.components.length, 6);
});
