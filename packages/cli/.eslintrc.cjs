module.exports = {
  extends: [require.resolve("@grackle/heft-rig/profiles/default/config/eslint.cjs")],
  parserOptions: { tsconfigRootDir: __dirname }
};
