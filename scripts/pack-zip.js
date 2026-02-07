#!/usr/bin/env node

/**
 * Pack the built extension into a .zip for Chrome Web Store upload.
 * Usage: node scripts/pack-zip.js
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const distDir = resolve(root, "dist", "extension");

if (!existsSync(distDir)) {
  console.error("dist/extension/ not found. Run `npm run build` first.");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const zipName = `scroll-rack-v${pkg.version}.zip`;

execSync(`cd "${distDir}" && zip -r "../../${zipName}" . -x '*.DS_Store'`, {
  stdio: "inherit",
});

console.log(`\nPacked: ${zipName}`);
