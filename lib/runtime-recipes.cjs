"use strict";

const NPM = "https://registry.npmjs.org";
const CLAUDE = "https://downloads.claude.ai/claude-code-releases";
const KIMI_BASES = ["https://code.kimi.com/kimi-code", "https://code.kimi.ai/kimi-code"];
const AGY = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests";

function safeVersion(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,100}$/.test(value.trim())) throw new Error("Official runtime metadata returned an invalid version.");
  return value.trim();
}
function digest(value, algorithm = "sha256") {
  const hexLength = algorithm === "sha512" ? 128 : 64;
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${hexLength}}$`, "i").test(value)) throw new Error("Official runtime metadata returned an invalid checksum.");
  return { algorithm, value: value.toLowerCase() };
}
function npmArch(arch) {
  if (arch === "x64") return "win32-x64";
  if (arch === "arm64") return "win32-arm64";
  throw new Error("This runtime is not available for the current architecture.");
}
function targetArch(arch, id) {
  if (id === "agy") {
    if (arch === "x64") return "windows_amd64";
    if (arch === "arm64") return "windows_arm64";
    throw new Error("Antigravity is not available for the current architecture.");
  }
  return npmArch(arch);
}
async function npmRelease({ version, arch, rootPackage, registryPackage, id }, host) {
  const target = targetArch(arch, id);
  const requested = version ? encodeURIComponent(safeVersion(version)) : "latest";
  const root = await host.fetchJson(`${NPM}/${encodeURIComponent(rootPackage)}/${requested}`);
  const mainVersion = safeVersion(root?.version);
  if (version && mainVersion !== version) throw new Error("The requested runtime version is unavailable.");
  const optional = root.optionalDependencies;
  if (!optional || typeof optional !== "object" || Array.isArray(optional)) throw new Error("Official runtime metadata has no platform package.");
  const desired = Object.entries(optional).find(([name, spec]) => {
    const text = `${name} ${String(spec)}`.toLowerCase();
    return text.includes(target.toLowerCase()) && (String(spec).startsWith("npm:") || name.toLowerCase().includes("win32"));
  });
  if (!desired) throw new Error("Official runtime metadata has no matching Windows package.");
  let alias = String(desired[1]);
  let nativePackage = desired[0];
  let nativeVersion = alias;
  if (alias.startsWith("npm:")) {
    const spec = alias.slice(4);
    const at = spec.lastIndexOf("@");
    if (at <= 0) throw new Error("Official runtime package alias is invalid.");
    nativePackage = spec.slice(0, at);
    nativeVersion = spec.slice(at + 1);
    if (![desired[0].toLowerCase(), rootPackage.toLowerCase()].includes(nativePackage.toLowerCase())) throw new Error("Official runtime package alias does not match its dependency.");
  }
  nativeVersion = safeVersion(nativeVersion);
  if (nativePackage.toLowerCase() === rootPackage.toLowerCase()) {
    if (id === "openai" || id === "deepseek") nativePackage = "@openai/codex";
    else nativePackage = `@xai-official/grok-${target}`;
  }
  const native = await host.fetchJson(`${NPM}/${encodeURIComponent(nativePackage)}/${encodeURIComponent(nativeVersion)}`);
  if (safeVersion(native?.version) !== nativeVersion) throw new Error("The registry returned a mismatched platform package version.");
  const sri = native.dist?.integrity;
  if (typeof sri !== "string" || !/^sha512-[A-Za-z0-9+/]{80,90}={0,2}$/.test(sri)) throw new Error("Official runtime metadata has no SHA-512 package integrity.");
  const url = new URL(native.dist?.tarball || "");
  if (url.hostname !== "registry.npmjs.org" || url.protocol !== "https:") throw new Error("The runtime archive is outside the official npm registry.");
  return { version: mainVersion, url: url.href, artifact: "tar.gz", integrity: sri,
    ...(id === "xai" ? { executableCompression: "brotli" } : {}),
    provenance: `npm:${nativePackage}@${nativeVersion}` };
}

async function resolveRuntimeRelease(id, context, host) {
  if (context?.platform !== "win32") throw new Error("This runtime is only available on Windows.");
  const version = context.version ? safeVersion(context.version) : "";
  if (id === "openai" || id === "deepseek") return npmRelease({ version, arch: context.arch, rootPackage: "@openai/codex", registryPackage: "@openai/codex", id }, host);
  if (id === "xai") return npmRelease({ version, arch: context.arch, rootPackage: "@xai-official/grok", registryPackage: `@xai-official/grok-${targetArch(context.arch, id)}`, id }, host);
  if (id === "anthropic") {
    const latest = version || safeVersion((await host.fetchText(`${CLAUDE}/latest`)).trim());
    const metadata = await host.fetchJson(`${CLAUDE}/${encodeURIComponent(latest)}/manifest.json`);
    const platform = targetArch(context.arch, id);
    const checksum = digest(metadata?.platforms?.[platform]?.checksum, "sha256");
    return { version: latest, url: `${CLAUDE}/${encodeURIComponent(latest)}/${platform}/claude.exe`, artifact: "exe", checksum, executable: "claude.exe", provenance: `claude:${latest}:${platform}` };
  }
  if (id === "google") {
    const platform = targetArch(context.arch, "agy");
    const metadata = await host.fetchJson(`${AGY}/${platform}.json`);
    const resolved = safeVersion(metadata?.version);
    if (version && resolved !== version) throw new Error("The requested Antigravity version is no longer available.");
    const url = new URL(metadata?.url || "");
    if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com" || !url.pathname.startsWith("/antigravity-public/antigravity-cli/")) throw new Error("Antigravity binary URL is outside its official release directory.");
    const checksum = digest(metadata?.sha512, "sha512");
    return { version: resolved, url: url.href, artifact: "exe", checksum, executable: "agy.exe", provenance: `antigravity:${resolved}:${platform}` };
  }
  if (id === "moonshot") {
    let lastError;
    for (const base of KIMI_BASES) {
      try {
        const resolved = version || safeVersion((await host.fetchText(`${base}/latest`)).trim());
        const metadata = await host.fetchJson(`${base}/binaries/${encodeURIComponent(resolved)}/manifest.json`);
        const platform = targetArch(context.arch, id);
        const row = metadata?.platforms?.[platform];
        const filename = row?.filename;
        if (typeof filename !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(filename) || filename === "." || filename === "..") throw new Error("Kimi release filename is invalid.");
        const checksum = digest(row?.checksum, "sha256");
        return { version: resolved, url: `${base}/binaries/${encodeURIComponent(resolved)}/${encodeURIComponent(filename)}`, artifact: "exe", checksum, executable: "kimi.exe", provenance: `kimi:${resolved}:${platform}` };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error("Kimi runtime metadata is unavailable.");
  }
  throw new Error("Unknown runtime recipe.");
}

module.exports = { resolveRuntimeRelease };
