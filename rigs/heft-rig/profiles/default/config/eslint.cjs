/** Shared ESLint base config for Node packages using the default rig profile. */
require("@rushstack/eslint-patch/modern-module-resolution");
module.exports = {
  extends: ["@rushstack/eslint-config/profile/node"],
  rules: {
    // The codebase does not use the Microsoft "I" prefix convention for interfaces.
    "@typescript-eslint/naming-convention": [
      "warn",
      { selector: "interface", format: ["PascalCase"] }
    ],
    // Escalate from "warn" (inherited) to "error" so violations block the build.
    // Options duplicated from @rushstack/eslint-config — ESLint replaces the
    // entire rule config on override, and the parent can't be require()'d at
    // config-load time (it uses @rushstack/eslint-patch/modern-module-resolution).
    "@typescript-eslint/typedef": [
      "error",
      {
        arrayDestructuring: false,
        arrowParameter: false,
        memberVariableDeclaration: true,
        objectDestructuring: false,
        parameter: true,
        propertyDeclaration: true,
        variableDeclaration: false,
        variableDeclarationIgnoreFunction: true,
      }
    ],
    "@typescript-eslint/explicit-member-accessibility": "error",
  }
};
