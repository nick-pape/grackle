#!/usr/bin/env node
import { main } from "./proxy.js";

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
