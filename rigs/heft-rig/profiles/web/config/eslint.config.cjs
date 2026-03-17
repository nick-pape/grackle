const webAppProfile = require("@rushstack/eslint-config/flat/profile/web-app");
const reactMixin = require("@rushstack/eslint-config/flat/mixins/react");

/** Shared ESLint flat config for the web package. */
module.exports = [
  ...webAppProfile,
  ...reactMixin,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        { selector: "interface", format: ["PascalCase"] }
      ],
      "react/jsx-no-bind": "off",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn"
    }
  }
];
