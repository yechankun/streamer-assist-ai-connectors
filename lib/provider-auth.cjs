"use strict";

const DEFINITIONS = Object.freeze({
  openai: {
    kind: "browser",
    loginArgs: ["login"],
    statusArgs: ["login", "status"],
    requiresTty: false,
    authHosts: ["auth.openai.com"],
    instructions: "Sign in to your OpenAI account in the browser opened by Codex.",
    keyUrl: "https://platform.openai.com/api-keys",
    status: "exit-code",
    progress: "url",
    logoutKind: "command",
    logoutArgs: ["logout"],
    logoutInstructions: "Codex logout clears its saved authentication credentials.",
    logoutBeforeLogin: true,
  },
  anthropic: {
    kind: "browser",
    loginArgs: ["auth", "login"],
    statusArgs: ["auth", "status"],
    requiresTty: false,
    authHosts: ["claude.ai", "platform.claude.com"],
    instructions: "Sign in to your Anthropic account in the browser opened by Claude Code.",
    keyUrl: "https://platform.claude.com/settings/keys",
    status: "claude-json",
    progress: "url",
    logoutKind: "command",
    logoutArgs: ["auth", "logout"],
    logoutInstructions: "Claude Code logout signs out of the current Anthropic account.",
    logoutBeforeLogin: true,
  },
  xai: {
    kind: "browser",
    loginArgs: ["login"],
    requiresTty: false,
    authHosts: ["auth.x.ai"],
    instructions: "Sign in to your xAI account in the browser opened by Grok CLI.",
    keyUrl: "https://console.x.ai",
    progress: "url",
    logoutKind: "command",
    logoutArgs: ["logout"],
    logoutInstructions: "Grok logout clears the CLI's cached credentials.",
    logoutBeforeLogin: true,
  },
  google: {
    kind: "terminal",
    loginArgs: [],
    statusArgs: ["-p", "/usage", "--output-format", "json", "--print-timeout", "10s"],
    requiresTty: true,
    authHosts: [],
    instructions: "Complete Google sign-in in the Antigravity CLI window. The app automatically checks your account using the read-only usage command; no model turn is run.",
    keyUrl: "https://aistudio.google.com/apikey",
    status: "antigravity-usage-json",
    logoutKind: "terminal",
    logoutArgs: [],
    logoutInstructions: "In the Antigravity TUI, enter /logout to disconnect the profile and clear its secure-keyring tokens.",
    logoutBeforeLogin: false,
  },
  deepseek: {
    kind: "api-key",
    loginArgs: [],
    requiresTty: false,
    authHosts: [],
    instructions: "DeepSeek has no official CLI sign-in command. Add a DeepSeek API key to connect.",
    keyUrl: "https://platform.deepseek.com/api_keys",
    logoutKind: "api-key",
    logoutArgs: [],
    logoutInstructions: "Remove the saved DeepSeek API key from the app's provider settings.",
    logoutBeforeLogin: false,
  },
  moonshot: {
    kind: "device",
    loginArgs: ["login"],
    requiresTty: false,
    authHosts: ["www.kimi.com", "www.kimi.ai"],
    instructions: "Open the Kimi verification page and enter the one-time code printed by Kimi Code.",
    keyUrl: "https://platform.kimi.ai/console/api-keys",
    progress: "device",
    logoutKind: "acp",
    logoutArgs: ["acp"],
    logoutInstructions: "The host sends ACP v1 initialize and requests logout only when Kimi advertises agentCapabilities.auth.logout.",
    logoutBeforeLogin: true,
  },
});

const SAFE_OAUTH_QUERY = new Set([
  "allowed_workspace_id", "audience", "client_id", "code_challenge", "code_challenge_method",
  "codex_cli_simplified_flow", "id_token_add_organizations", "nonce", "originator", "prompt",
  "redirect_uri", "resource", "response_mode", "response_type", "scope", "state",
]);

function safeAuthUrl(text, hosts) {
  if (typeof text !== "string" || text.length > 16384) return undefined;
  const candidates = text.match(/https?:\/\/[^\s"'<>`]+/gi) || [];
  for (let candidate of candidates) {
    candidate = candidate.replace(/[),.;!?\]}]+$/g, "");
    let parsed;
    try { parsed = new URL(candidate); } catch { continue; }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || (parsed.port && parsed.port !== "443")) continue;
    if (!hosts.includes(parsed.hostname.toLowerCase())) continue;

    for (const [name, value] of parsed.searchParams) {
      if (!SAFE_OAUTH_QUERY.has(name.toLowerCase()) || value.length > 2048) { parsed = null; break; }
    }
    if (!parsed) continue;
    return candidate;
  }
  return undefined;
}

function oneTimeCode(text) {
  if (typeof text !== "string" || text.length > 16384) return undefined;
  const match = text.match(/\b(?:user[\s_-]*code|verification[\s_-]*code|device[\s_-]*code|enter[\s_-]+code)\s*[:：]?\s*([A-Z0-9][A-Z0-9-]{3,15})\b/i);
  return match ? match[1].toUpperCase() : undefined;
}

function authStatus(id, input = {}) {
  const exitCode = input.exitCode;
  if (id === "openai") {
    if (exitCode === 0) return { authenticated: true };
    if (exitCode === 1) return { authenticated: false };
    return null;
  }
  if (id === "anthropic") {
    if (exitCode !== 0 && exitCode !== 1) return null;
    for (const value of [input.stdout, input.stderr]) {
      if (typeof value !== "string" || value.length > 32768) continue;
      try {
        const result = JSON.parse(value);
        if (result && typeof result.authMethod === "string" && ["none", "claude.ai", "oauth_token", "api_key", "api_key_helper", "third_party"].includes(result.authMethod)) {
          return { authenticated: exitCode === 0 && result.authMethod !== "none" };
        }
      } catch { /* ignore output that is not the documented status JSON */ }
    }
    return null;
  }
  if (id === "google") {
    if (typeof input.stdout !== "string" || input.stdout.length > 256 * 1024) return null;
    let result;
    try { result = JSON.parse(input.stdout); } catch { return null; }
    if (!result || typeof result !== "object" || Array.isArray(result)) return null;
    if (result.status === "ERROR" && typeof result.error === "string" &&
        /\b(?:unauthenticated|not authenticated|not logged in|authentication required|sign[- ]in required|login required)\b/i.test(result.error))
      return { authenticated: false };
    // Only the official quota command proves an authenticated account. Neither
    // exit zero, a model list, nor a generic successful print response is proof.
    if (exitCode !== 0 || result.status !== "SUCCESS" || result.num_turns !== 0 || result.usage?.total_tokens !== 0 ||
        result.command?.name !== "usage" || !Array.isArray(result.command.data?.groups)) return null;
    const quota = result.command.data.groups.some(group => group && typeof group === "object" && Array.isArray(group.buckets) &&
      group.buckets.some(bucket => bucket && typeof bucket === "object" &&
        typeof bucket.id === "string" && bucket.id.length > 0 && bucket.id.length <= 160 &&
        typeof bucket.name === "string" && bucket.name.length > 0 && bucket.name.length <= 160 &&
        typeof bucket.window === "string" && bucket.window.length > 0 && bucket.window.length <= 160 &&
        Number.isFinite(bucket.remaining_fraction) && bucket.remaining_fraction >= 0 && bucket.remaining_fraction <= 1 &&
        typeof bucket.reset_time === "string" && bucket.reset_time.length <= 80 && Number.isFinite(Date.parse(bucket.reset_time))));
    return quota ? { authenticated: true } : null;
  }
  return null;
}

function authProgress(id, input = {}) {
  const text = input.text;
  const spec = DEFINITIONS[id];
  if (!spec || !spec.progress || typeof text !== "string") return null;
  const result = {};
  const url = safeAuthUrl(text, spec.authHosts);
  if (url) result.url = url;
  if (spec.progress === "device" && url) {
    const code = oneTimeCode(text);
    if (code) result.code = code;
  }
  return Object.keys(result).length ? result : null;
}

function descriptor(id) {
  const spec = DEFINITIONS[id];
  if (!spec) throw new Error("Unknown provider authentication recipe.");
  const result = {
    kind: spec.kind,
    loginArgs: [...spec.loginArgs],
    requiresTty: spec.requiresTty,
    authHosts: [...spec.authHosts],
    instructions: spec.instructions,
    keyUrl: spec.keyUrl,
  };
  if (spec.statusArgs) result.statusArgs = [...spec.statusArgs];
  if (spec.status) result.parseStatus = input => authStatus(id, input);
  if (spec.progress) result.parseProgress = input => authProgress(id, input);
  if (spec.logoutKind) {
    result.logoutKind = spec.logoutKind;
    result.logoutArgs = [...spec.logoutArgs];
    result.logoutInstructions = spec.logoutInstructions;
    result.logoutBeforeLogin = spec.logoutBeforeLogin;
  }
  return result;
}

module.exports = { descriptor, safeAuthUrl, oneTimeCode, authStatus, authProgress };
