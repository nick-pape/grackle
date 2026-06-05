import { createVitestConfig } from "@grackle-ai/heft-rig/vitest-base.mjs";

// forceExit needed because tests that use setupTestDatabase() load the real
// @grackle-ai/database module (including better-sqlite3 native addon), and
// the native handle can keep the vitest worker process alive after all tests
// and afterAll hooks have completed.
export default createVitestConfig({ test: { forceExit: true } });
