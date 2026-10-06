"use strict";

const fs = require("node:fs");
const { IDS } = require("./build-pack.cjs");

const REPOSITORY = "yechankun/streamer-assist-ai-connectors";
function validRow(row) {
  return row && IDS.includes(row.id) && row.abiVersion === 1 && typeof row.version === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(row.version) &&
    row.asset === `${row.id}-v${row.version}.saip.json` && /^[a-f0-9]{64}$/i.test(row.sha256) && Number.isSafeInteger(row.size) && row.size > 0 && row.size <= 2 * 1024 * 1024;
}
function makeCatalog(previous, next, generatedAt = new Date().toISOString()) {
  if (!validRow(next)) throw new Error("Component digest metadata is invalid.");
  const prior = previous == null ? { schemaVersion: 1, repository: REPOSITORY, generatedAt, abiVersion: 1, components: [] } : previous;
  if (!prior || prior.schemaVersion !== 1 || prior.repository !== REPOSITORY || prior.abiVersion !== 1 || !Array.isArray(prior.components) || prior.components.length > IDS.length) throw new Error("Existing component catalog is invalid.");
  if (!Number.isFinite(Date.parse(prior.generatedAt))) throw new Error("Existing component catalog timestamp is invalid.");
  const components = [...prior.components];
  for (const row of components) if (!validRow(row)) throw new Error("Existing component catalog row is invalid.");
  const seen = new Set();
  for (const row of components) { if (seen.has(row.id)) throw new Error("Existing component catalog has duplicate IDs."); seen.add(row.id); }
  const updated = components.filter(row => row.id !== next.id);
  updated.push({ id: next.id, version: next.version, abiVersion: 1, asset: next.asset, sha256: next.sha256.toLowerCase(), size: next.size });
  return { schemaVersion: 1, repository: REPOSITORY, generatedAt, abiVersion: 1, components: updated };
}
function main(argv) {
  const [, , previousFile, metadataFile, outputFile] = argv;
  if (!metadataFile || !outputFile) throw new Error("Usage: node scripts/build-catalog.cjs <existing-catalog.json|-> <component.metadata.json> <output.json>");
  const previous = previousFile && previousFile !== "-" ? JSON.parse(fs.readFileSync(previousFile, "utf8")) : null;
  const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
  const catalog = makeCatalog(previous, metadata);
  fs.writeFileSync(outputFile, `${JSON.stringify(catalog, null, 2)}\n`);
}
if (require.main === module) {
  try { main(process.argv); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { makeCatalog, validRow, REPOSITORY };
