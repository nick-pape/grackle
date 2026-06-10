import { createVitestConfig } from "@grackle-ai/heft-rig/vitest-base.mjs";

export default createVitestConfig({
  test: {
    // Tests that use setupTestDatabase() load the real @grackle-ai/database
    // module (including better-sqlite3 native addon). On Linux CI, an open
    // handle from the addon can keep the vitest worker alive after all tests
    // and afterAll hooks complete, hanging `rush test`. The globalTeardown
    // schedules process.exit(0) as a safety net.
    globalTeardown: ["./vitest-teardown.ts"],
  },
});
