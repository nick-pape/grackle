const rigConfig = require("@grackle-ai/heft-rig/profiles/default/config/eslint.config.cjs");

module.exports = [
  ...rigConfig,
  {
    files: ["src/ws-bridge.ts", "src/grpc-service.ts"],
    rules: {
      "max-lines": "off",
    },
  },
];
