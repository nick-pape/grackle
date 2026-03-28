const rigConfig = require("@grackle-ai/heft-rig/profiles/default/config/eslint.config.cjs");

module.exports = [
  ...rigConfig,
  // Ban direct process.env reads — use resolveServerConfig() from config.ts instead.
  {
    files: ["src/**/*.ts"],
    // config.ts is the centralized config reader; local-powerline.ts spreads
    // process.env to a child process (not reading config values).
    ignores: ["src/config.ts", "src/local-powerline.ts"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            "Use ServerConfig from ./config.ts instead of reading process.env directly.",
        },
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Use ServerConfig from ./config.ts instead of reading process.env directly.",
        },
      ],
    },
  },
];
