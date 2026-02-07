import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/mocks/chrome.js"],
    include: ["tests/**/*.test.js"],
  },
});
