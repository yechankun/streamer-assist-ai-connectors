"use strict";

const path = require("node:path");
const common = require("./provider-common.cjs");
const providerAuth = require("./provider-auth.cjs");
const providerProfile = require("./provider-profile.cjs");
const { resolveRuntimeRelease } = require("./runtime-recipes.cjs");

const DEFINITIONS = Object.freeze({
  openai: {
    name: "OpenAI", cliId: "codex", protocol: "responses", baseUrl: "https://api.openai.com/v1",
    docs: "https://developers.openai.com/api/docs/", apiKeyEnv: "OPENAI_API_KEY", quota: "supported",
    pricing: [
      rate("gpt-6.1-sol", 2, 10, .1, 2.5, "https://developers.openai.com/api/docs/models/gpt-6.1-sol", 272000, [4, 15, .2, 5]),
      rate("gpt-6-sol", 2, 10, .2, 2.5, "https://developers.openai.com/api/docs/models/gpt-6-sol", 272000, [4, 15, .4, 5]),
      rate("gpt-6-luna", .1, .5, .01, .125, "https://developers.openai.com/api/docs/models/gpt-6-luna", 272000, [.2, .75, .02, .25]),
      rate("gpt-6-astra", 10, 50, 1, 12.5, "https://developers.openai.com/api/docs/models/gpt-6-astra", 272000, [20, 75, 2, 25]),
      rate("gpt-5.4", 2.5, 15, .25, 3.125, "https://developers.openai.com/api/docs/models/gpt-5.4", 272000, [5, 22.5, .5, 6.25]),
    ],
  },
  anthropic: {
    name: "Anthropic", cliId: "claude", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1",
    docs: "https://docs.anthropic.com/en/api/getting-started", apiKeyEnv: "ANTHROPIC_API_KEY", quota: "supported",
    pricing: [
      rate("claude-sonnet-4-6", 3, 15, .3, 3.75, "https://platform.claude.com/docs/en/about-claude/pricing", undefined, undefined, 6),
      rate("claude-opus-4-6", 5, 25, .5, 6.25, "https://platform.claude.com/docs/en/about-claude/pricing", undefined, undefined, 10),
    ],
  },
  xai: {
    name: "xAI", cliId: "grok", protocol: "chat", baseUrl: "https://api.x.ai/v1",
    docs: "https://docs.x.ai/developers/overview", apiKeyEnv: "XAI_API_KEY", quota: "unsupported",
    pricing: [rate("grok-4.7", 2, 6, .5, undefined, "https://docs.x.ai/developers/models/grok-4.7", 200000, [4, 9, 1])],
  },
  google: {
    name: "Google", cliId: "agy", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    docs: "https://ai.google.dev/gemini-api/docs", apiKeyEnv: "GEMINI_API_KEY", quota: "unsupported",
    pricing: [
      rate("gemini-3.8-flash", .75, 3.75, undefined, undefined, "https://ai.google.dev/gemini-api/docs/latest-model", undefined, undefined, undefined, undefined, undefined, { ratePeriods: [
        { validThrough: "2026-12-31", inputPerMillion: .75, outputPerMillion: 3.75 },
        { validFrom: "2027-01-01", inputPerMillion: 1.5, outputPerMillion: 7.5 },
      ] }),
    ],
  },
  deepseek: {
    name: "DeepSeek", cliId: "codex", protocol: "chat", baseUrl: "https://api.deepseek.com/v1",
    docs: "https://api-docs.deepseek.com/", apiKeyEnv: "DEEPSEEK_API_KEY", cliApiKeyEnv: "DEEPSEEK_API_KEY", quota: "unsupported",
    pricing: [
      rate("deepseek-flash", .15, .6, .003, undefined, "https://api-docs.deepseek.com/quick_start/pricing/", undefined, undefined, undefined, undefined, undefined, { rateWindows: peakWindows(.3, 1.2, .006) }),
      rate("deepseek-v4-pro", .66, 1.98, .022, undefined, "https://api-docs.deepseek.com/quick_start/pricing/", undefined, undefined, undefined, undefined, undefined, { rateWindows: peakWindows(1.32, 3.96, .044) }),
    ],
  },
  moonshot: {
    name: "Moonshot", cliId: "kimi", protocol: "chat", baseUrl: "https://api.moonshot.ai/v1",
    docs: "https://platform.moonshot.ai/docs", apiKeyEnv: "MOONSHOT_API_KEY", quota: "unsupported",
    pricing: [rate("kimi-k3", 3, 15, .3, 3, "https://platform.kimi.ai/", undefined, undefined, 3)],
  },
});

function rate(modelId, input, output, cached, cacheWrite, source, longThreshold, longRates, writeOneHour, validUntil, validFrom, extra) {
  const row = {
    schemaVersion: 1, type: "model-pricing", providerId: "", modelId, currency: "USD",
    inputPerMillion: input, outputPerMillion: output, source, checkedAt: "2026-10-06",
  };
  if (cached !== undefined) row.cachedInputPerMillion = cached;
  if (cacheWrite !== undefined && writeOneHour !== undefined) {
    row.cacheWrite5mInputPerMillion = cacheWrite;
    row.cacheWrite1hInputPerMillion = writeOneHour;
  } else if (cacheWrite !== undefined) row.cacheWriteInputPerMillion = cacheWrite;
  if (longThreshold) Object.assign(row, { longContextThreshold: longThreshold, longContext: { inputPerMillion: longRates[0], outputPerMillion: longRates[1], ...(longRates[2] !== undefined ? { cachedInputPerMillion: longRates[2] } : {}), ...(longRates[3] !== undefined ? { cacheWriteInputPerMillion: longRates[3] } : {}) } });
  if (validUntil) row.validThrough = validUntil.slice(0, 10);
  if (validFrom) row.validFrom = validFrom.slice(0, 10);
  if (extra) Object.assign(row, extra);
  return row;
}
function peakWindows(input, output, cached) {
  return [
    { weekdaysUtc: [1, 2, 3, 4, 5], startMinuteUtc: 60, endMinuteUtc: 240, inputPerMillion: input, outputPerMillion: output, cachedInputPerMillion: cached },
    { weekdaysUtc: [1, 2, 3, 4, 5], startMinuteUtc: 360, endMinuteUtc: 600, inputPerMillion: input, outputPerMillion: output, cachedInputPerMillion: cached },
  ];
}

function descriptor(id) {
  const spec = DEFINITIONS[id];
  if (!spec) throw new Error("Unknown provider adapter.");
  const pricing = spec.pricing.map(item => ({ ...item, providerId: id }));
  const runtimeId = spec.cliId;
  const driver = ({ codex: "codex-app-server", claude: "claude-initialize", grok: "grok-models", agy: "agy-models", kimi: "kimi-acp" })[spec.cliId];
  const quotaDriver = id === "openai" ? "codex-rate-limits" : id === "anthropic" ? "claude-events" : "unsupported";
  const adapter = {
    abiVersion: 1,
    provider: {
      id, name: spec.name, protocol: spec.protocol, baseUrl: spec.baseUrl, docs: spec.docs,
      cliId: spec.cliId, apiKeyEnv: spec.apiKeyEnv,
      ...(spec.cliApiKeyEnv ? { cliApiKeyEnv: spec.cliApiKeyEnv } : {}),
      effortsFor({ mode, model, row } = {}) { return common.providerEfforts(id, mode, model, row); },
    },
    api: {
      buildRequest(input) { return common.buildApiRequest({ ...input, provider: input.provider || { baseUrl: spec.baseUrl } }, id, spec.protocol); },
      parseEvent(input) { return common.parseApiEvent(input, spec.protocol, id); },
      buildModelsRequest(input) { return common.buildModelsRequest({ ...input, provider: input.provider || { baseUrl: spec.baseUrl } }, spec.protocol, id); },
      ...(id === "xai" ? { buildModelsFallbackRequest(input) { return common.buildModelsRequest({ ...input, provider: input.provider || { baseUrl: spec.baseUrl } }, spec.protocol, id, "/models"); } } : {}),
      parseModelsResponse(input) { return common.parseModelsResponse(input, id, spec.protocol); },
      normalizeUsage(input) { return common.normalizeUsage(input, spec.protocol, id); },
    },
    cli: {
      analysisPlan(input) { return common.cliAnalysisPlan(input, id); },
      parseEvent(input) { return common.cliEvent(input, id); },
      models: {
        driver,
        ...(id === "deepseek" ? { requiresApiModelList: true } : {}),
        buildPlan(input = {}) {
          if (id === "openai") return { args: ["-c", 'model_provider="openai"'], files: [] };
          if (id === "deepseek") {
            if (typeof input.jobDirectory !== "string" || !path.isAbsolute(input.jobDirectory)) throw new Error("A validated model-query directory is required.");
            const rows = common.safeModelRows(input.liveModels || []);
            const models = rows.map(item => ({ slug: item.id, display_name: item.name || item.id,
              supported_reasoning_levels: (item.efforts ?? common.providerEfforts("deepseek", "cli", item.id, item)).filter(value => ["low", "high", "max"].includes(value)).map(effort => ({ effort, description: `${effort} reasoning` })),
              supported_in_api: true, visibility: "list", input_modalities: ["text"], shell_type: "shell_command", priority: 1, support_verbosity: true,
              truncation_policy: { mode: "tokens", limit: 10000 }, experimental_supported_tools: [],
              model_messages: { instructions_template: "You are a helpful assistant. Answer the user's request using only the supplied context." },
              ...(item.defaultEffort ? { default_reasoning_level: item.defaultEffort } : {}),
            }));
            const catalogPath = path.win32.join(input.jobDirectory, "deepseek-models.json");
            return { args: ["-c", `model_catalog_json=${JSON.stringify(catalogPath)}`, "-c", 'model_provider="deepseek"', "-c", 'model_providers.deepseek={name="DeepSeek",base_url="https://api.deepseek.com/",env_key="DEEPSEEK_API_KEY",wire_api="responses"}'], files: [{ relativePath: "deepseek-models.json", contents: JSON.stringify({ models }) }] };
          }
          if (id === "xai") return { args: ["models"], files: [] };
          if (id === "google") return { args: ["--output-format", "json", "models"], files: [] };
          if (id === "anthropic") return { args: ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"], files: [] };
          if (id === "moonshot") return { args: ["acp"], files: [] };
          return { args: [], files: [] };
        },
        ...(id === "openai" || id === "deepseek" || id === "anthropic" || id === "moonshot" ? { parseMessage(input) { return common.parseCliModelMessage(input, id); } } : {}),
        ...(id === "xai" || id === "google" ? { parseOutput(input) { return common.parseCliModelsOutput(input, id); } } : {}),
      },
      quota: {
        driver: quotaDriver,
        ...(id === "openai" ? { parseResult({ result } = {}) { return common.codexQuota(result); } } : {}),
        ...(id === "anthropic" ? { parseMessage({ message } = {}) {
          if (!message || !["rate_limit_event", "rate-limit-event"].includes(message.type)) return null;
          return common.claudeQuota(message.rate_limit_info ?? message.rateLimitInfo) || null;
        } } : {}),
      },
      loginArgs: [],
      auth: providerAuth.descriptor(id),
      profile: providerProfile.descriptor(id),
    },
    pricing,
    runtime: {
      id: runtimeId,
      executable: ({ codex: "codex.exe", claude: "claude.exe", grok: "grok.exe", agy: "agy.exe", kimi: "kimi.exe" })[runtimeId],
      allowedHosts: runtimeHosts(runtimeId),
      resolveRelease(context, host) { return commonRuntime(id, context, host); },
    },
  };
  return adapter;
}

function runtimeHosts(id) {
  if (id === "codex" || id === "grok") return ["registry.npmjs.org"];
  if (id === "claude") return ["downloads.claude.ai"];
  if (id === "agy") return ["antigravity-cli-auto-updater-974169037036.us-central1.run.app", "storage.googleapis.com"];
  return ["code.kimi.com", "cdn.kimi.com", "code.kimi.ai", "cdn.kimi.ai"];
}
function commonRuntime(id, context, host) {
  return resolveRuntimeRelease(id, context, host);
}

module.exports = { descriptor };
