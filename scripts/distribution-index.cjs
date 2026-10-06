"use strict";

const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const {
  MAX_CATALOG_BYTES,
  MAX_PACKAGE_BYTES,
  parseReleaseTag,
  validateCatalog,
  validateCatalogAsset,
  validateReleaseAsset,
} = require("./aggregate-catalog.cjs");
const { REPOSITORY } = require("./build-catalog.cjs");

const SCHEMA_VERSION = 1;
const ABI_VERSION = 1;
const DISTRIBUTION_BRANCH = "distribution-v1";
const DISTRIBUTION_PATH = "index.json";
const SHA256 = /^sha256:[a-f0-9]{64}$/i;

function exactKeys(value, keys) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function decodeBase64(value, maxBytes) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Distribution catalog bytes are not canonical base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maxBytes || bytes.toString("base64") !== value) throw new Error("Distribution catalog bytes exceed limits or are not canonical.");
  if (!Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) throw new Error("Distribution catalog is not valid UTF-8.");
  return bytes;
}

function expectedAssetUrl(owner, repo, tag, name) {
  return `https://github.com/${owner}/${repo}/releases/download/${tag}/${name}`;
}

function validateReceiptAsset(asset, { owner, repo, tag, name, maxBytes = MAX_PACKAGE_BYTES }) {
  if (!exactKeys(asset, ["id", "name", "size", "digest", "browser_download_url"]) ||
      !Number.isSafeInteger(asset.id) || asset.id < 1 || asset.name !== name ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maxBytes ||
      typeof asset.digest !== "string" || !SHA256.test(asset.digest) ||
      asset.browser_download_url !== expectedAssetUrl(owner, repo, tag, name)) {
    throw new Error(`Distribution receipt asset metadata is invalid for ${tag}/${name}.`);
  }
  return asset;
}

function normalizeReceiptAsset(asset) {
  return {
    id: asset.id,
    name: asset.name,
    size: asset.size,
    digest: asset.digest.toLowerCase(),
    browser_download_url: asset.browser_download_url,
  };
}

function validateDistributionIndex(index, { owner = "yechankun", repo = "streamer-assist-ai-connectors" } = {}) {
  const repository = `${owner}/${repo}`;
  if (!exactKeys(index, ["schemaVersion", "repository", "abiVersion", "generatedAt", "catalog", "catalogReceipt", "catalogBytes", "releaseReceipts"]) ||
      index.schemaVersion !== SCHEMA_VERSION || index.repository !== REPOSITORY || index.repository !== repository ||
      index.abiVersion !== ABI_VERSION || typeof index.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(index.generatedAt)) || new Date(index.generatedAt).toISOString() !== index.generatedAt ||
      !Array.isArray(index.releaseReceipts)) {
    throw new Error("Distribution index schema or repository identity is invalid.");
  }

  const catalog = validateCatalog(index.catalog, repository);
  const catalogBytes = decodeBase64(index.catalogBytes, MAX_CATALOG_BYTES);
  if (!exactKeys(index.catalogReceipt, ["tag_name", "assets"]) || index.catalogReceipt.tag_name !== "catalog-v1" ||
      !Array.isArray(index.catalogReceipt.assets) || index.catalogReceipt.assets.length !== 1) {
    throw new Error("Distribution catalog receipt schema is invalid.");
  }
  const catalogAsset = validateReceiptAsset(index.catalogReceipt.assets[0], {
    owner, repo, tag: "catalog-v1", name: "catalog.json", maxBytes: MAX_CATALOG_BYTES,
  });
  if (catalogAsset.size !== catalogBytes.length || catalogAsset.digest.toLowerCase() !== `sha256:${sha256(catalogBytes)}`) {
    throw new Error("Distribution catalog bytes do not match the GitHub asset receipt.");
  }
  let parsedCatalog;
  try { parsedCatalog = JSON.parse(catalogBytes.toString("utf8")); } catch { throw new Error("Distribution catalog bytes are invalid JSON."); }
  validateCatalog(parsedCatalog, repository);
  if (!isDeepStrictEqual(catalog, parsedCatalog)) throw new Error("Distribution catalog object differs from its exact published bytes.");

  if (index.releaseReceipts.length !== catalog.components.length) throw new Error("Distribution release receipts do not cover the catalog exactly.");
  const ids = new Set([catalogAsset.id]);
  for (let indexRow = 0; indexRow < catalog.components.length; indexRow++) {
    const row = catalog.components[indexRow];
    const receipt = index.releaseReceipts[indexRow];
    const tag = `${row.id}-v${row.version}`;
    if (!exactKeys(receipt, ["tag_name", "assets"]) || receipt.tag_name !== tag ||
        !Array.isArray(receipt.assets) || receipt.assets.length !== 1) {
      throw new Error(`Distribution release receipt is missing or out of order for ${tag}.`);
    }
    const asset = validateReceiptAsset(receipt.assets[0], { owner, repo, tag, name: row.asset });
    if (asset.digest.toLowerCase() !== `sha256:${row.sha256.toLowerCase()}` || asset.size !== row.size || ids.has(asset.id)) {
      throw new Error(`Distribution release receipt does not match catalog row ${row.id}.`);
    }
    ids.add(asset.id);
  }
  return index;
}

function buildDistributionIndex({
  owner = "yechankun",
  repo = "streamer-assist-ai-connectors",
  catalog,
  catalogBytes,
  catalogAsset,
  providerReleases,
  generatedAt = new Date().toISOString(),
}) {
  const repository = `${owner}/${repo}`;
  validateCatalog(catalog, repository);
  if (!Buffer.isBuffer(catalogBytes) || catalogBytes.length < 1 || catalogBytes.length > MAX_CATALOG_BYTES) {
    throw new Error("Published catalog bytes exceed limits.");
  }
  const parsedCatalog = validateCatalogAsset({
    release: { tag_name: "catalog-v1", draft: false, assets: [catalogAsset] },
    asset: catalogAsset,
    bytes: catalogBytes,
    owner,
    repo,
  });
  if (!isDeepStrictEqual(parsedCatalog, catalog)) throw new Error("Published catalog differs from its exact validated bytes.");
  if (!Array.isArray(providerReleases) || providerReleases.length !== catalog.components.length) {
    throw new Error("Verified provider releases do not cover the catalog exactly.");
  }

  const releasesByTag = new Map();
  for (const item of providerReleases) {
    if (!item || !item.release || releasesByTag.has(item.release.tag_name)) throw new Error("Verified provider release list is invalid or duplicated.");
    const parsedTag = parseReleaseTag(item.release.tag_name);
    if (!parsedTag) throw new Error("Verified provider release tag is invalid.");
    const row = validateReleaseAsset({
      release: item.release,
      asset: item.release.assets?.find(asset => asset?.name === `${parsedTag.id}-v${parsedTag.version}.saip.json`),
      bytes: item.bytes,
      owner,
      repo,
    });
    const catalogRow = catalog.components.find(candidate => candidate.id === row.id);
    if (!catalogRow || !isDeepStrictEqual(catalogRow, row)) throw new Error(`Verified release ${item.release.tag_name} does not match its catalog row.`);
    releasesByTag.set(item.release.tag_name, item.release);
  }

  const releaseReceipts = catalog.components.map(row => {
    const tag = `${row.id}-v${row.version}`;
    const release = releasesByTag.get(tag);
    if (!release) throw new Error(`Verified provider release ${tag} is missing.`);
    return {
      tag_name: tag,
      assets: [normalizeReceiptAsset(release.assets.find(asset => asset?.name === row.asset))],
    };
  });
  const index = {
    schemaVersion: SCHEMA_VERSION,
    repository,
    abiVersion: ABI_VERSION,
    generatedAt,
    catalog,
    catalogReceipt: {
      tag_name: "catalog-v1",
      assets: [normalizeReceiptAsset(catalogAsset)],
    },
    catalogBytes: catalogBytes.toString("base64"),
    releaseReceipts,
  };
  return validateDistributionIndex(index, { owner, repo });
}

module.exports = {
  DISTRIBUTION_BRANCH,
  DISTRIBUTION_PATH,
  buildDistributionIndex,
  validateDistributionIndex,
};
