#!/usr/bin/env node
/*
 * Write update.json for the Zotero update channel.
 *
 * Zotero polls the URL in the plugin manifest, which points at the rolling
 * `release` tag. That release must always carry the newest update.json, so this
 * script regenerates it from the manifest, the XPI, and the git tag.
 *
 * Usage:
 *   node scripts/update-manifest.mjs --xpi dist/sidebrowser.xpi \
 *     --tag v0.1.0 --repo 00sapo/zotero-sidebrowser --out update.json
 *
 * The hash is the one Zotero verifies: sha512 of the XPI, base64 encoded.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  let args = {};
  for (let i = 0; i < argv.length; i += 2) {
    let key = argv[i];
    let value = argv[i + 1];
    if (!key.startsWith("--") || value === undefined) {
      throw new Error(`Bad argument near ${key}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main() {
  let args = parseArgs(process.argv.slice(2));
  let xpi = args.xpi || "dist/sidebrowser.xpi";
  let out = args.out || "update.json";
  let repo = args.repo || process.env.GITHUB_REPOSITORY;
  let tag = args.tag || process.env.GITHUB_REF_NAME;

  if (!repo) {
    throw new Error("Pass --repo, for example 00sapo/zotero-sidebrowser");
  }
  if (!tag) {
    throw new Error("Pass --tag, for example v0.1.0");
  }

  let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  let addon = manifest.applications?.zotero;
  if (!addon?.id) {
    throw new Error("manifest.json has no applications.zotero.id");
  }

  let bytes = readFileSync(xpi);
  let digest = "sha512:" + createHash("sha512").update(bytes).digest("base64");

  let data = {
    addons: {
      [addon.id]: {
        updates: [
          {
            version: manifest.version,
            update_link: `https://github.com/${repo}/releases/download/${tag}/sidebrowser.xpi`,
            update_hash: digest,
            applications: {
              zotero: {
                strict_min_version: addon.strict_min_version,
                strict_max_version: addon.strict_max_version,
              },
            },
          },
        ],
      },
    },
  };

  writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote ${out} for ${manifest.version} (${digest})`);
}

main();
