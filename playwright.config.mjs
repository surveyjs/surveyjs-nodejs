// The shared browser tests (shared/browser-tests): what node --test and the contract test can't see, because they
// never run shared/client/host.js or shared/ui/page-tabs.js. Chromium only.
//
//   npm run test:browser                                    seeds a fresh database in a temp DATA_DIR and starts the
//                                                           app on APP_PORT (default 8000)
//   BASE_URL=http://127.0.0.1:9000 npm run test:browser     against an app that is already running
//
// Outside CI, an app that already answers on APP_PORT is used as it is, with its own database.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = process.env.APP_PORT || "8000";
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "shared/browser-tests",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      // Full Chromium in its new headless mode, not the headless shell: the shell has no PDF viewer and turns a
      // navigation to a PDF into a download, so server-pdf's tab never shows the blob: URL.
      channel: "chromium",
      viewport: { width: 1440, height: 900 },
      // As in the reference: Chrome's Local Network Access checks would block a page the test fulfils itself
      launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
    },
  }],
  webServer: process.env.BASE_URL ? undefined : {
    // A fresh, seeded database every run: the specs expect the seed, not what earlier runs stored
    command: "node scripts/setup.mjs && node server.js",
    env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), "surveyjs-browser-")), APP_PORT: port, APP_HOST: "127.0.0.1", PORT: "" },
    url: `${baseURL}/up`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
