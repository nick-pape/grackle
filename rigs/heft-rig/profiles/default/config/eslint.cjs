/** Shared ESLint base config for Node packages using the default rig profile. */
require("@rushstack/eslint-patch/modern-module-resolution");
module.exports = {
  extends: ["@rushstack/eslint-config/profile/node"],
  rules: {
    // The codebase does not use the Microsoft "I" prefix convention for interfaces.
    "@typescript-eslint/naming-convention": [
      "warn",
      { selector: "interface", format: ["PascalCase"] }
    ]
  }
};
