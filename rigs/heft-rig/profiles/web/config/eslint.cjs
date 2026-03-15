/** Shared ESLint base config for the web package using the web rig profile. */
require("@rushstack/eslint-patch/modern-module-resolution");
module.exports = {
  extends: [
    "@rushstack/eslint-config/profile/web-app",
    "@rushstack/eslint-config/mixins/react"
  ],
  rules: {
    // The codebase does not use the Microsoft "I" prefix convention for interfaces.
    "@typescript-eslint/naming-convention": [
      "warn",
      { selector: "interface", format: ["PascalCase"] }
    ],
    // Modern React with hooks: inline handlers are the standard pattern.
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
};
