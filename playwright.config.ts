import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const BASE = `http://localhost:${PORT}/personal-finance-dashboard/`;

// UI tests run a production build of the app against a fake backend (e2e/mockBackend.ts),
// on phone, tablet and desktop sizes. The build uses development settings so every backend call
// goes to the local address that the fake backend intercepts.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  reporter: [["list"]],
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    // A service worker would answer requests before the fake backend could
    serviceWorkers: "block",
  },
  webServer: {
    command: `npx vite build --mode development && npx vite preview --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
