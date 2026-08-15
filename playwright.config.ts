import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  fullyParallel: true,
  forbidOnly: true,
  reporter: "line",
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "e2e",
      testDir: "./tests/e2e",
      use: devices["Desktop Chrome"],
    },
    {
      name: "visual",
      testDir: "./tests/visual",
      snapshotPathTemplate:
        "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
      use: devices["Desktop Chrome"],
    },
  ],
});
