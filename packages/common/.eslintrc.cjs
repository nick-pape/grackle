module.exports = {
  extends: [require.resolve("@grackle-ai/heft-rig/profiles/protobuf/config/eslint.cjs")],
  parserOptions: { tsconfigRootDir: __dirname },
  rules: {
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
