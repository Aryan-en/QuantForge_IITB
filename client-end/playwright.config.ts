import { defineConfig } from "@playwright/test";

// Uses the locally installed Chrome (no browser download). Run: npm run test:e2e
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: "http://localhost:3100", channel: "chrome", viewport: { width: 1500, height: 900 } },
  webServer: { command: "npm run build && npx next start -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 240_000 },
});
