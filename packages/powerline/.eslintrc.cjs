module.exports = {
  extends: [require.resolve("@grackle-ai/heft-rig/profiles/default/config/eslint.cjs")],
  parserOptions: { tsconfigRootDir: __dirname },
  rules: {
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
