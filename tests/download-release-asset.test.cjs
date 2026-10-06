"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { buildPack } = require("../scripts/build-pack.cjs");
const { makeCatalog } = require("../scripts/build-catalog.cjs");
const { validateCatalogAsset } = require("../scripts/aggregate-catalog.cjs");
const { downloadReleaseAsset, apiAssetUrl } = require("../scripts/download-release-asset.cjs");

const owner = "yechankun";
const repo = "streamer-assist-ai-connectors";
const token = "workflow-token-must-not-reach-cdn";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

test("mutable catalog asset is read by its GitHub asset ID and follows redirects without forwarding authorization", async () => {
  const packageMetadata = buildPack("openai").metadata;
  const currentBytes = Buffer.from(`${JSON.stringify(makeCatalog(null, packageMetadata, "2026-10-07T01:02:03.000Z"), null, 2)}\n`);
  const staleCdnBytes = Buffer.from(`${JSON.stringify(makeCatalog(null, packageMetadata, "2026-10-07T01:02:02.000Z"), null, 2)}\n`);
  const cdnUrl = "https://release-assets.githubusercontent.com/asset?temporary-signature=secret";
  const asset = {
    id: 424242,
    name: "catalog.json",
    size: currentBytes.length,
    digest: `sha256:${hash(currentBytes)}`,
    browser_download_url: `https://github.com/${owner}/${repo}/releases/download/catalog-v1/catalog.json`,
  };
  const release = { tag_name: "catalog-v1", draft: false, assets: [asset] };
  const calls = [];
  let staleCanonicalUrlCalls = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === `https://github.com/${owner}/${repo}/releases/download/catalog-v1/catalog.json`) {
      staleCanonicalUrlCalls += 1;
      return new Response(staleCdnBytes, { status: 200 });
    }
    if (url === apiAssetUrl(owner, repo, 424242)) {
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      assert.equal(options.headers.accept, "application/octet-stream");
      return new Response(null, { status: 302, headers: { location: cdnUrl } });
    }
    if (url === cdnUrl) {
      assert.equal(options.headers.authorization, undefined, "the workflow token never leaves api.github.com");
      assert.deepEqual(options.headers, { accept: "application/octet-stream" });
      assert.equal(options.redirect, "manual");
      return new Response(currentBytes, { status: 200, headers: { "content-length": String(currentBytes.length) } });
    }
    throw new Error("Unexpected URL");
  };

  const actual = await downloadReleaseAsset({ owner, repo, assetId: 424242, maxBytes: 512 * 1024, token, fetchImpl });
  assert.deepEqual(actual, currentBytes);
  assert.equal(hash(actual), hash(currentBytes));
  assert.deepEqual(validateCatalogAsset({ release, asset, bytes: actual, owner, repo }), JSON.parse(currentBytes.toString("utf8")));
  assert.throws(() => validateCatalogAsset({ release, asset, bytes: staleCdnBytes, owner, repo }), /do not match GitHub's digest/);
  assert.equal(staleCanonicalUrlCalls, 0, "the mutable browser_download_url is not used to read existing catalog bytes");
  assert.deepEqual(calls.map(call => call.url), [apiAssetUrl(owner, repo, 424242), cdnUrl]);
});

test("release asset downloader rejects untrusted redirects, API failures, and oversized bodies", async () => {
  const firstRedirect = async location => async () => new Response(null, { status: 302, headers: { location } });
  await assert.rejects(downloadReleaseAsset({ owner, repo, assetId: 7, maxBytes: 1024, token,
    fetchImpl: await firstRedirect("https://attacker.example/file?token=x") }), /redirect host is not trusted/);
  await assert.rejects(downloadReleaseAsset({ owner, repo, assetId: 7, maxBytes: 1024, token,
    fetchImpl: async () => new Response("not found", { status: 404 }) }), /HTTP 404/);
  await assert.rejects(downloadReleaseAsset({ owner, repo, assetId: 7, maxBytes: 4, token,
    fetchImpl: async () => new Response("too large", { status: 200 }) }), /size limit/);
  await assert.rejects(downloadReleaseAsset({ owner, repo, assetId: 0, maxBytes: 1024, token,
    fetchImpl: async () => { throw new Error("should not be called"); } }), /identity is invalid/);
});
