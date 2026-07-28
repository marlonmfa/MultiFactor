const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:3000",
    env: {
      ...process.env,
      STORAGE_DIR: "/tmp/cipher-share-playwright-storage",
    },
    reuseExistingServer: !process.env.CI,
  },
});
