import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Copy static assets (icons, CSS) from src into dist. */
function copyStaticAssets() {
  return {
    name: "copy-static-assets",
    writeBundle() {
      const dist = resolve("dist/extension");
      mkdirSync(resolve(dist, "icons"), { recursive: true });
      mkdirSync(resolve(dist, "assets"), { recursive: true });

      cpSync("src/assets/icons", resolve(dist, "icons"), { recursive: true });
      cpSync(
        "src/content-scripts/content.css",
        resolve(dist, "assets/content.css"),
      );
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist/extension",
    emptyOutDir: true,
  },
  plugins: [
    webExtension({
      manifest: "src/manifest/manifest.base.json",
    }),
    copyStaticAssets(),
  ],
});
