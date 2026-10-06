"use strict";

const crypto = require("node:crypto");
const { validRow, REPOSITORY } = require("./build-catalog.cjs");
const { IDS } = require("./build-pack.cjs");

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_BYTES = 512 * 1024;
const SHA256 = /^sha256:([a-f0-9]{64})$/i;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseVersion(value) {
  if (typeof value !== "string") return null;
  const match = SEMVER.exec(value);
  if (!match) return null;
  const prerelease = match[4] === undefined ? null : match[4].split(".");
  if (prerelease?.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw new Error("Catalog version is not valid semantic versioning.");
  for (let index = 0; index < 3; index++) if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index++) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const leftId = a.prerelease[index], rightId = b.prerelease[index];
    if (leftId === rightId) continue;
    const leftNumeric = /^\d+$/.test(leftId), rightNumeric = /^\d+$/.test(rightId);
    if (leftNumeric && rightNumeric) return BigInt(leftId) < BigInt(rightId) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftId < rightId ? -1 : 1;
  }
  return 0;
}

function parseReleaseTag(tag) {
  if (typeof tag !== "string") return null;
  const id = IDS.find(providerId => tag.startsWith(`${providerId}-v`));
  if (!id) return null;
  const version = tag.slice(id.length + 2);
  if (!parseVersion(version)) throw new Error(`Provider release tag ${tag} has an invalid semantic version.`);
  return { id, version, tag };
}

function selectNewestReleases(releases) {
  if (!Array.isArray(releases)) throw new Error("GitHub release rows are invalid.");
  const selected = new Map();
  const seenTags = new Set();
  for (const release of releases) {
    const parsed = parseReleaseTag(release?.tag_name);
    if (!parsed) continue;
    if (seenTags.has(parsed.tag)) throw new Error(`GitHub returned duplicate provider release tag ${parsed.tag}.`);
    seenTags.add(parsed.tag);
    if (release.draft === true) continue;
    const current = selected.get(parsed.id);
    const comparison = current ? compareVersions(parsed.version, current.version) : 1;
    if (!current || comparison > 0 || (comparison === 0 && parsed.version > current.version)) selected.set(parsed.id, { ...parsed, release });
  }
  return IDS.filter(id => selected.has(id)).map(id => selected.get(id));
}

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function plainObject(value) { return !!value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exactKeys(value, keys) { return plainObject(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"); }

function decodeBase64(value, label, maxBytes) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error(`${label} is not canonical base64.`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maxBytes || bytes.toString("base64") !== value) throw new Error(`${label} exceeds limits or is not canonical.`);
  return bytes;
}

function validatePackageBytes(bytes, { id, version }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_PACKAGE_BYTES) throw new Error("Provider package bytes exceed limits.");
  if (!Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) throw new Error("Provider package envelope is not valid UTF-8.");
  let envelope;
  try { envelope = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Provider package envelope is invalid JSON."); }
  if (!exactKeys(envelope, ["payload"])) throw new Error("Provider package envelope schema is invalid.");
  const payloadBytes = decodeBase64(envelope.payload, "Provider package payload", MAX_PACKAGE_BYTES);
  if (!Buffer.from(payloadBytes.toString("utf8"), "utf8").equals(payloadBytes)) throw new Error("Provider package payload is not valid UTF-8.");
  let payload;
  try { payload = JSON.parse(payloadBytes.toString("utf8")); } catch { throw new Error("Provider package payload is invalid JSON."); }
  if (!exactKeys(payload, ["schemaVersion", "abiVersion", "id", "version", "entry", "files"]) ||
      payload.schemaVersion !== 1 || payload.abiVersion !== 1 || payload.id !== id || payload.version !== version ||
      payload.entry !== "adapter.cjs" || !Array.isArray(payload.files) || payload.files.length < 1 || payload.files.length > 32) {
    throw new Error("Provider package payload does not match its release tag or schema.");
  }
  const paths = new Set();
  for (const file of payload.files) {
    if (!exactKeys(file, ["path", "content", "sha256"]) || typeof file.path !== "string" ||
        file.path.length > 240 || !/^[A-Za-z0-9._/-]+$/.test(file.path) || file.path.startsWith("/") ||
        file.path.split("/").some(part => !part || part === "." || part === "..") || paths.has(file.path) ||
        !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Provider package file schema is invalid.");
    paths.add(file.path);
    const content = decodeBase64(file.content, "Provider package file", MAX_PACKAGE_BYTES);
    if (sha256(content) !== file.sha256) throw new Error("Provider package file digest does not match its content.");
  }
  if (!paths.has("adapter.cjs")) throw new Error("Provider package entry file is missing.");
}

function expectedAssetUrl(owner, repo, tag, name) {
  return `https://github.com/${owner}/${repo}/releases/download/${tag}/${name}`;
}

function validateReleaseAsset({ release, asset, bytes, owner, repo }) {
  const parsed = parseReleaseTag(release?.tag_name);
  if (!parsed || release.draft === true || typeof owner !== "string" || typeof repo !== "string") throw new Error("Provider release identity is invalid.");
  const name = `${parsed.id}-v${parsed.version}.saip.json`;
  if (!Array.isArray(release.assets) || release.assets.filter(item => item?.name === name).length !== 1 ||
      !asset || asset.name !== name || release.assets.find(item => item?.name === name)?.id !== asset.id ||
      !Number.isSafeInteger(asset.id) || asset.id < 1 || !Number.isSafeInteger(asset.size) ||
      asset.size < 1 || asset.size > MAX_PACKAGE_BYTES || typeof asset.digest !== "string" ||
      !SHA256.test(asset.digest) || asset.browser_download_url !== expectedAssetUrl(owner, repo, parsed.tag, name)) {
    throw new Error(`Provider release asset metadata is invalid for ${parsed.tag}.`);
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== asset.size || sha256(bytes) !== asset.digest.slice("sha256:".length).toLowerCase()) {
    throw new Error(`Provider release asset bytes do not match GitHub's digest for ${parsed.tag}.`);
  }
  validatePackageBytes(bytes, parsed);
  return { id: parsed.id, version: parsed.version, abiVersion: 1, asset: name, sha256: sha256(bytes), size: bytes.length };
}

function validateCatalog(catalog, repository = REPOSITORY) {
  if (!exactKeys(catalog, ["schemaVersion", "repository", "generatedAt", "abiVersion", "components"]) ||
      catalog.schemaVersion !== 1 || catalog.repository !== repository || catalog.abiVersion !== 1 ||
      typeof catalog.generatedAt !== "string" || !Number.isFinite(Date.parse(catalog.generatedAt)) ||
      !Array.isArray(catalog.components) || catalog.components.length > IDS.length) throw new Error("Catalog schema is invalid.");
  const seen = new Set();
  for (const row of catalog.components) {
    if (!validRow(row) || !parseVersion(row.version) || seen.has(row.id)) throw new Error("Catalog component row is invalid or duplicated.");
    seen.add(row.id);
  }
  return catalog;
}

function validateCatalogAsset({ release, asset, bytes, owner, repo }) {
  if (release?.tag_name !== "catalog-v1" || release.draft === true || !Array.isArray(release.assets) ||
      release.assets.filter(item => item?.name === "catalog.json").length !== 1 || asset?.name !== "catalog.json" ||
      release.assets.find(item => item?.name === "catalog.json")?.id !== asset.id || !Number.isSafeInteger(asset.id) || asset.id < 1 ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_CATALOG_BYTES || typeof asset.digest !== "string" ||
      !SHA256.test(asset.digest) || asset.browser_download_url !== expectedAssetUrl(owner, repo, "catalog-v1", "catalog.json")) {
    throw new Error("Existing catalog GitHub asset metadata is invalid.");
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== asset.size || sha256(bytes) !== asset.digest.slice("sha256:".length).toLowerCase()) {
    throw new Error("Existing catalog bytes do not match GitHub's digest.");
  }
  let catalog;
  try { catalog = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Existing catalog is invalid JSON."); }
  return validateCatalog(catalog, `${owner}/${repo}`);
}

function selectCatalogRows(previousRows, candidateRows, generatedAt = new Date().toISOString()) {
  if (!Array.isArray(previousRows) || !Array.isArray(candidateRows) || !Number.isFinite(Date.parse(generatedAt))) throw new Error("Catalog rows or timestamp are invalid.");
  const byId = new Map();
  for (const [rows, label] of [[previousRows, "existing"], [candidateRows, "candidate"]]) {
    const seen = new Set();
    for (const row of rows) {
      if (!validRow(row) || !parseVersion(row.version) || seen.has(row.id)) throw new Error(`${label} catalog rows are invalid or duplicated.`);
      seen.add(row.id);
      const current = byId.get(row.id);
      const comparison = current ? compareVersions(row.version, current.version) : 1;
      if (!current || comparison > 0 || (comparison === 0 && row.version > current.version)) byId.set(row.id, { ...row, sha256: row.sha256.toLowerCase() });
    }
  }
  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    generatedAt,
    abiVersion: 1,
    components: IDS.filter(id => byId.has(id)).map(id => byId.get(id)),
  };
}

module.exports = {
  MAX_PACKAGE_BYTES, MAX_CATALOG_BYTES, compareVersions, parseReleaseTag, selectNewestReleases,
  validatePackageBytes, validateReleaseAsset, validateCatalog, validateCatalogAsset, selectCatalogRows,
};
