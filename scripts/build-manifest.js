#!/usr/bin/env node

/**
 * Build the production manifest from the base manifest.
 *
 * Injects version from package.json and any build-time metadata.
 * This is called automatically by the Vite build, but can also be
 * run standalone for inspection:
 *
 *   node scripts/build-manifest.js
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manifest = JSON.parse(
  readFileSync(resolve(root, "src/manifest/manifest.base.json"), "utf8"),
);

// Sync version from package.json
manifest.version = pkg.version;

const output = resolve(root, "dist", "extension", "manifest.json");
writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Manifest written to ${output} (v${manifest.version})`);
