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
  },
  xai: {
    kind: "browser",
    loginArgs: ["login"],
    requiresTty: false,
    authHosts: ["auth.x.ai"],
    instructions: "Sign in to your xAI account in the browser opened by Grok CLI.",
    keyUrl: "https://console.x.ai",
    progress: "url",
  },
  google: {
    kind: "terminal",
    loginArgs: [],
    requiresTty: true,
    authHosts: [],
    instructions: "Complete Google sign-in in the Antigravity CLI window. Authentication is checked by listing models.",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  deepseek: {
    kind: "api-key",
    loginArgs: [],
    requiresTty: false,
    authHosts: [],
    instructions: "DeepSeek has no official CLI sign-in command. Add a DeepSeek API key to connect.",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  moonshot: {
    kind: "device",
    loginArgs: ["login"],
    requiresTty: false,
    authHosts: ["www.kimi.com", "www.kimi.ai"],
    instructions: "Open the Kimi verification page and enter the one-time code printed by Kimi Code.",
    keyUrl: "https://platform.kimi.ai/console/api-keys",
    progress: "device",
  },
});

const SAFE_OAUTH_QUERY = new Set([
  "audience", "client_id", "code_challenge", "code_challenge_method", "nonce",
  "prompt", "redirect_uri", "resource", "response_mode", "response_type", "scope", "state",
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

    const retained = [];
    let valid = true;
    for (const [name, value] of parsed.searchParams) {
      if (!SAFE_OAUTH_QUERY.has(name.toLowerCase()) || value.length > 2048) { valid = false; break; }
      retained.push([name, value]);
    }
    if (!valid) continue;
    parsed.search = "";
    for (const [name, value] of retained) parsed.searchParams.append(name, value);
    return parsed.href;
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
  return result;
}

module.exports = { descriptor, safeAuthUrl, oneTimeCode, authStatus, authProgress };
