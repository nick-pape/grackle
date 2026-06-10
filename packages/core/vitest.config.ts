import { createVitestConfig } from "@grackle-ai/heft-rig/vitest-base.mjs";

export default createVitestConfig({
  test: {
    pool: "forks",
    teardownTimeout: 5000,
  },
});
