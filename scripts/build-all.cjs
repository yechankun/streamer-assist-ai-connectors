"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { IDS, buildPack } = require("./build-pack.cjs");
const output = path.resolve(__dirname, "..", "dist");
fs.mkdirSync(output, { recursive: true });
for (const id of IDS) {
  const pack = buildPack(id);
  fs.writeFileSync(path.join(output, pack.asset), pack.envelopeBytes);
  fs.writeFileSync(path.join(output, `${id}.metadata.json`), `${JSON.stringify(pack.metadata, null, 2)}\n`);
}
process.stdout.write(`Built ${IDS.length} provider packages in ${output}\n`);
