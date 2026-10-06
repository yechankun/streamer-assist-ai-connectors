"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { buildPack } = require("../scripts/build-pack.cjs");
const { selectCatalogRows, validateReleaseAsset } = require("../scripts/aggregate-catalog.cjs");
const { buildDistributionIndex, validateDistributionIndex } = require("../scripts/distribution-index.cjs");

const owner = "yechankun";
const repo = "streamer-assist-ai-connectors";
const generatedAt = "2026-10-07T00:00:00.000Z";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const providers = ["openai", "google"].map((id, index) => {
    const built = buildPack(id);
    const tag = built.metadata.releaseTag;
    const asset = {
      id: 101 + index,
      name: built.metadata.asset,
      size: built.envelopeBytes.length,
      digest: `sha256:${hash(built.envelopeBytes)}`,
      browser_download_url: `https://github.com/${owner}/${repo}/releases/download/${tag}/${built.metadata.asset}`,
    };
    const release = { tag_name: tag, draft: false, assets: [asset] };
    const row = validateReleaseAsset({ release, asset, bytes: built.envelopeBytes, owner, repo });
    return { release, bytes: built.envelopeBytes, row };
  });
  const catalog = selectCatalogRows([], providers.map(item => item.row), generatedAt);
  const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  const catalogAsset = {
    id: 100,
    name: "catalog.json",
    size: catalogBytes.length,
    digest: `sha256:${hash(catalogBytes)}`,
    browser_download_url: `https://github.com/${owner}/${repo}/releases/download/catalog-v1/catalog.json`,
  };
  const index = buildDistributionIndex({
    owner,
    repo,
    catalog,
    catalogBytes,
    catalogAsset,
    providerReleases: providers,
    generatedAt,
  });
  return { index, catalog, catalogBytes, catalogAsset, providers };
}

test("distribution index carries exact catalog bytes and API-verified receipts for each selected release", () => {
  const { index, catalog, catalogBytes, catalogAsset, providers } = fixture();
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.repository, `${owner}/${repo}`);
  assert.equal(index.catalogBytes, catalogBytes.toString("base64"));
  assert.deepEqual(index.catalog, catalog);
  assert.deepEqual(index.catalogReceipt, {
    tag_name: "catalog-v1",
    assets: [{ ...catalogAsset }],
  });
  assert.deepEqual(index.releaseReceipts.map(item => item.tag_name), catalog.components.map(row => `${row.id}-v${row.version}`));
  for (const [position, receipt] of index.releaseReceipts.entries()) {
    const asset = providers[position].release.assets[0];
    assert.deepEqual(receipt.assets, [asset]);
  }
  assert.equal(validateDistributionIndex(index), index);
});

test("distribution validator rejects bytes, catalog, release receipt and URL mismatches", () => {
  const { index } = fixture();

  const badBytes = structuredClone(index);
  badBytes.catalogBytes = Buffer.from("{}\n").toString("base64");
  assert.throws(() => validateDistributionIndex(badBytes), /catalog bytes do not match/);

  const badCatalog = structuredClone(index);
  badCatalog.catalog.components[0].version = "9.9.9";
  assert.throws(() => validateDistributionIndex(badCatalog), /Catalog component row|differs from its exact published bytes/);

  const badReceipt = structuredClone(index);
  badReceipt.releaseReceipts[0].assets[0].digest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateDistributionIndex(badReceipt), /does not match catalog row/);

  const badUrl = structuredClone(index);
  badUrl.releaseReceipts[0].assets[0].browser_download_url = "https://mirror.invalid/provider.saip.json";
  assert.throws(() => validateDistributionIndex(badUrl), /metadata is invalid/);

  const badRepository = structuredClone(index);
  badRepository.repository = "someone-else/streamer-assist-ai-connectors";
  assert.throws(() => validateDistributionIndex(badRepository), /schema or repository identity/);

  const badTag = structuredClone(index);
  badTag.releaseReceipts[0].tag_name = "openai-v9.9.9";
  assert.throws(() => validateDistributionIndex(badTag), /missing or out of order/);

  const missingDigest = structuredClone(index);
  delete missingDigest.releaseReceipts[0].assets[0].digest;
  assert.throws(() => validateDistributionIndex(missingDigest), /metadata is invalid/);

  const badSize = structuredClone(index);
  badSize.releaseReceipts[0].assets[0].size += 1;
  assert.throws(() => validateDistributionIndex(badSize), /does not match catalog row/);

  const missing = structuredClone(index);
  missing.releaseReceipts.pop();
  assert.throws(() => validateDistributionIndex(missing), /do not cover the catalog exactly/);
});

test("distribution builder rejects a provider payload that differs from its catalog receipt", () => {
  const { index, catalog, catalogBytes, catalogAsset, providers } = fixture();
  const broken = providers.map(item => ({ ...item }));
  broken[0].bytes = Buffer.from("tampered");
  assert.throws(() => buildDistributionIndex({
    owner,
    repo,
    catalog,
    catalogBytes,
    catalogAsset,
    providerReleases: broken,
    generatedAt,
  }), /do not match GitHub/);

  assert.throws(() => buildDistributionIndex({
    owner,
    repo,
    catalog,
    catalogBytes,
    catalogAsset: { ...catalogAsset, digest: `sha256:${"f".repeat(64)}` },
    providerReleases: providers,
    generatedAt,
  }), /do not match GitHub/);
});

test("distribution builder rejects package source whose individual file hash was altered", () => {
  const { catalog, catalogBytes, catalogAsset, providers } = fixture();
  const tamperedProviders = providers.map(item => ({ ...item }));
  const provider = tamperedProviders[0];
  const envelope = JSON.parse(provider.bytes.toString("utf8"));
  const payloadBytes = Buffer.from(envelope.payload, "base64");
  const payload = JSON.parse(payloadBytes.toString("utf8"));
  const source = payload.files.find(file => file.path === "adapter.cjs");
  source.content = Buffer.from(`${Buffer.from(source.content, "base64").toString("utf8")}\n// tampered`).toString("base64");
  envelope.payload = Buffer.from(JSON.stringify(payload)).toString("base64");
  provider.bytes = Buffer.from(JSON.stringify(envelope));
  const asset = provider.release.assets[0];
  asset.size = provider.bytes.length;
  asset.digest = `sha256:${hash(provider.bytes)}`;

  assert.throws(() => buildDistributionIndex({
    owner,
    repo,
    catalog,
    catalogBytes,
    catalogAsset,
    providerReleases: tamperedProviders,
    generatedAt,
  }), /file digest does not match/);
});
