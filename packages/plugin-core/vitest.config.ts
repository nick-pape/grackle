import { createVitestConfig } from "@grackle-ai/heft-rig/vitest-base.mjs";

// forceExit: better-sqlite3 native addon keeps vitest workers alive after tests complete
export default createVitestConfig({ test: { forceExit: true } });
