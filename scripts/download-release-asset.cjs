"use strict";

const RELEASE_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const MAX_REDIRECTS = 3;

function apiAssetUrl(owner, repo, assetId) {
  if (typeof owner !== "string" || !/^[A-Za-z0-9-]+$/.test(owner) ||
      typeof repo !== "string" || !/^[A-Za-z0-9._-]+$/.test(repo) ||
      !Number.isSafeInteger(assetId) || assetId < 1) {
    throw new Error("Release asset API identity is invalid.");
  }
  return `https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`;
}

function redirectUrl(location) {
  if (typeof location !== "string" || location.length > 8192) throw new Error("Release asset redirect is invalid.");
  let url;
  try { url = new URL(location); } catch { throw new Error("Release asset redirect is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || !RELEASE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Release asset redirect host is not trusted.");
  }
  return url.href;
}

async function readLimitedResponse(response, maxBytes) {
  const announced = Number(response.headers?.get("content-length"));
  if (Number.isFinite(announced) && announced > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Release asset exceeds the download size limit.");
  }
  if (!response.body) throw new Error("Release asset response has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Release asset exceeds the download size limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function downloadReleaseAsset({ owner, repo, assetId, maxBytes, token, fetchImpl = globalThis.fetch }) {
  const url = apiAssetUrl(owner, repo, assetId);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) throw new Error("Release asset size limit is invalid.");
  if (typeof token !== "string" || token.length < 1 || token.length > 4096) throw new Error("GitHub workflow token is unavailable.");
  if (typeof fetchImpl !== "function") throw new Error("Release asset transport is unavailable.");

  const apiHeaders = {
    accept: "application/octet-stream",
    authorization: `Bearer ${token}`,
    "user-agent": "streamer-assist-catalog-builder",
    "x-github-api-version": "2022-11-28",
  };
  let nextUrl = url;
  let headers = apiHeaders;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let response;
    try {
      response = await fetchImpl(nextUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error("Release asset download request failed.");
    }
    if (response.status === 200) return readLimitedResponse(response, maxBytes);
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Release asset request returned HTTP ${response.status}.`);
    }
    if (redirects === MAX_REDIRECTS) {
      await response.body?.cancel().catch(() => {});
      throw new Error("Release asset redirect limit was exceeded.");
    }
    nextUrl = redirectUrl(response.headers?.get("location"));
    await response.body?.cancel().catch(() => {});
    // GitHub's signed release CDN URL may contain a temporary signature. It is
    // fetched without the workflow credential; only the initial api.github.com
    // request receives the token.
    headers = { accept: "application/octet-stream" };
  }
  throw new Error("Release asset download did not complete.");
}

module.exports = { downloadReleaseAsset, apiAssetUrl, redirectUrl, readLimitedResponse, RELEASE_HOSTS };
