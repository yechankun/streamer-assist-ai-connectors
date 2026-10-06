"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { buildPack } = require("../scripts/build-pack.cjs");
const {
  compareVersions, parseReleaseTag, selectNewestReleases,
  validatePackageBytes, validateReleaseAsset, validateCatalogAsset, selectCatalogRows,
} = require("../scripts/aggregate-catalog.cjs");

const owner = "yechankun";
const repo = "streamer-assist-ai-connectors";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const row = (id, version, marker = "a") => ({ id, version, abiVersion: 1, asset: `${id}-v${version}.saip.json`, sha256: marker.repeat(64), size: 10 });

test("semantic version selection picks the greatest provider release, including prerelease ordering", () => {
  assert.equal(compareVersions("1.0.0-rc.10", "1.0.0-rc.2"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.10"), 1);
  assert.equal(compareVersions("2.0.0+build.1", "2.0.0+build.2"), 0);
  assert.deepEqual(parseReleaseTag("google-v1.2.3"), { id: "google", version: "1.2.3", tag: "google-v1.2.3" });
  assert.equal(parseReleaseTag("catalog-v1"), null);
  assert.throws(() => parseReleaseTag("openai-v01.2.3"), /invalid semantic version/);

  const newest = selectNewestReleases([
    { tag_name: "openai-v0.1.1" },
    { tag_name: "openai-v0.1.2-rc.2" },
    { tag_name: "openai-v0.1.2-rc.10" },
    { tag_name: "openai-v0.1.2" },
    { tag_name: "anthropic-v2.0.0+build.4" },
    { tag_name: "catalog-v1" },
  ]);
  assert.deepEqual(newest.map(item => [item.id, item.version]), [["openai", "0.1.2"], ["anthropic", "2.0.0+build.4"]]);
  assert.throws(() => selectNewestReleases([{ tag_name: "openai-v1.0.0" }, { tag_name: "openai-v1.0.0" }]), /duplicate provider release tag/);
});

test("GitHub provider asset bytes must match metadata, release identity, envelope and file schema", () => {
  const built = buildPack("openai");
  const tag = built.metadata.releaseTag;
  const name = built.metadata.asset;
  const asset = {
    id: 101,
    name,
    size: built.envelopeBytes.length,
    digest: `sha256:${hash(built.envelopeBytes)}`,
    browser_download_url: `https://github.com/${owner}/${repo}/releases/download/${tag}/${name}`,
  };
  const release = { tag_name: tag, draft: false, assets: [asset] };
  const verified = validateReleaseAsset({ release, asset, bytes: built.envelopeBytes, owner, repo });
  assert.deepEqual(verified, {
    id: "openai", version: built.metadata.version, abiVersion: 1, asset: name,
    sha256: hash(built.envelopeBytes), size: built.envelopeBytes.length,
  });
  assert.throws(() => validateReleaseAsset({ release, asset: { ...asset, browser_download_url: "https://example.com/pack" }, bytes: built.envelopeBytes, owner, repo }), /metadata is invalid/);
  assert.throws(() => validateReleaseAsset({ release, asset, bytes: Buffer.from("changed"), owner, repo }), /do not match GitHub/);
  assert.throws(() => validatePackageBytes(Buffer.from(JSON.stringify({ payload: Buffer.from("{} ").toString("base64") })), { id: "openai", version: built.metadata.version }), /payload/);
});

test("existing catalog and its GitHub asset are digest-checked before latest rows are merged", () => {
  const previousRows = [row("openai", "1.0.0"), row("xai", "2.0.0", "b")];
  const candidateRows = [row("openai", "1.1.0-rc.1", "c"), row("xai", "1.9.0", "d"), row("google", "1.0.0", "e")];
  const catalog = selectCatalogRows(previousRows, candidateRows, "2026-10-06T00:00:00.000Z");
  assert.deepEqual(catalog.components.map(item => [item.id, item.version]), [
    ["openai", "1.1.0-rc.1"], ["xai", "2.0.0"], ["google", "1.0.0"],
  ]);

  const bytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`);
  const asset = {
    id: 202, name: "catalog.json", size: bytes.length, digest: `sha256:${hash(bytes)}`,
    browser_download_url: `https://github.com/${owner}/${repo}/releases/download/catalog-v1/catalog.json`,
  };
  const release = { tag_name: "catalog-v1", draft: false, assets: [asset] };
  assert.deepEqual(validateCatalogAsset({ release, asset, bytes, owner, repo }), catalog);
  assert.throws(() => validateCatalogAsset({ release, asset, bytes: Buffer.from("{}"), owner, repo }), /do not match GitHub/);
  assert.throws(() => selectCatalogRows([row("openai", "1.0.0"), row("openai", "1.1.0")], [], "2026-10-06T00:00:00.000Z"), /invalid or duplicated/);
});
