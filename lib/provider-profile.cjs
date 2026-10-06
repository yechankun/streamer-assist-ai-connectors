"use strict";

// Paths are relative to a provider-specific root created by the desktop host.
// These are vendor-supported overrides, not replacements for OS home variables.
const PROFILES = Object.freeze({
  openai: {
    supported: true,
    env: { CODEX_HOME: ".", CODEX_SQLITE_HOME: "sqlite" },
    files: [{ relativePath: "config.toml", contents: 'cli_auth_credentials_store = "file"\n' }],
    docs: "https://learn.chatgpt.com/docs/auth",
  },
  deepseek: {
    supported: true,
    env: { CODEX_HOME: ".", CODEX_SQLITE_HOME: "sqlite" },
    files: [{ relativePath: "config.toml", contents: 'cli_auth_credentials_store = "file"\n' }],
    docs: "https://learn.chatgpt.com/docs/auth",
  },
  anthropic: {
    supported: true,
    env: { CLAUDE_CONFIG_DIR: ".", ANTHROPIC_CONFIG_DIR: "anthropic" },
    files: [],
    docs: "https://code.claude.com/docs/en/authentication",
  },
  xai: {
    supported: true,
    env: { GROK_HOME: "." },
    files: [],
    docs: "https://docs.x.ai/build/settings",
  },
  moonshot: {
    supported: true,
    env: { KIMI_CODE_HOME: ".", KIMI_SHARE_DIR: "." },
    files: [],
    docs: "https://moonshotai.github.io/kimi-code/en/configuration/env-vars.html",
  },
  google: {
    supported: false,
    reason: "Antigravity는 PC의 공용 인증 저장소를 사용합니다. 앱 전용 로그인은 API 연결을 이용하세요.",
    docs: "https://www.antigravity.google/docs/cli/install/",
  },
});

function descriptor(id) {
  const profile = PROFILES[id];
  if (!profile) throw new Error("Unknown provider authentication profile.");
  if (!profile.supported) return { ...profile };
  return { ...profile, env: { ...profile.env }, files: profile.files.map(file => ({ ...file })) };
}

module.exports = { descriptor };
