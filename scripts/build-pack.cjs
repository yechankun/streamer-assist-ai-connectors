"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const IDS = ["openai", "anthropic", "xai", "google", "deepseek", "moonshot"];

function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function readManifest(id) {
  if (!IDS.includes(id)) throw new Error("Select one of the six supported provider IDs.");
  const manifestPath = path.join(ROOT, "providers", id, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.id !== id || manifest.abiVersion !== 1 || manifest.entry !== "adapter.cjs" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error("Provider manifest is invalid.");
  return manifest;
}

function buildPack(id) {
  const manifest = readManifest(id);
  const files = [
    ["adapter.cjs", Buffer.from(`\"use strict\";\nmodule.exports = require(\"./providers/${id}/adapter.cjs\");\n`, "utf8")],
    [`providers/${id}/adapter.cjs`, fs.readFileSync(path.join(ROOT, "providers", id, "adapter.cjs"))],
    ["lib/provider-adapter.cjs", fs.readFileSync(path.join(ROOT, "lib", "provider-adapter.cjs"))],
    ["lib/provider-common.cjs", fs.readFileSync(path.join(ROOT, "lib", "provider-common.cjs"))],
    ["lib/provider-auth.cjs", fs.readFileSync(path.join(ROOT, "lib", "provider-auth.cjs"))],
    ["lib/provider-profile.cjs", fs.readFileSync(path.join(ROOT, "lib", "provider-profile.cjs"))],
    ["lib/runtime-recipes.cjs", fs.readFileSync(path.join(ROOT, "lib", "runtime-recipes.cjs"))],
  ].map(([filePath, bytes]) => ({ path: filePath, content: bytes.toString("base64"), sha256: hash(bytes) }));
  const payload = { schemaVersion: 1, abiVersion: 1, id, version: manifest.version, entry: manifest.entry, files };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const asset = `${id}-v${manifest.version}.saip.json`;
  const envelopeBytes = Buffer.from(`${JSON.stringify({ payload: payloadBytes.toString("base64") })}\n`, "utf8");
  const metadata = { id, version: manifest.version, abiVersion: 1, asset, sha256: hash(envelopeBytes), size: envelopeBytes.length, releaseTag: `${id}-v${manifest.version}` };
  if (envelopeBytes.length > 2 * 1024 * 1024) throw new Error("Pack exceeds the component manager size limit.");
  return { asset, envelopeBytes, metadata };
}

function main(argv) {
  const id = argv[2];
  if (!id) throw new Error("Usage: node scripts/build-pack.cjs <provider-id> [--out directory]");
  let output = path.join(ROOT, "dist");
  const outIndex = argv.indexOf("--out");
  if (outIndex >= 0) {
    if (!argv[outIndex + 1]) throw new Error("The --out option requires a directory.");
    output = path.resolve(argv[outIndex + 1]);
  }
  const built = buildPack(id);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, built.asset), built.envelopeBytes);
  fs.writeFileSync(path.join(output, `${id}.metadata.json`), `${JSON.stringify(built.metadata, null, 2)}\n`);
  process.stdout.write(`${built.asset}\n`);
}

if (require.main === module) {
  try { main(process.argv); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { buildPack, readManifest, IDS };
