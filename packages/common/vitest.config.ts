import { createVitestConfig } from "@grackle-ai/heft-rig/vitest-base.mjs";

export default createVitestConfig({
  test: {
    coverage: {
      exclude: ["src/errors.ts"],
    },
  },
});
