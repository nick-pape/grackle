module.exports = {
  extends: [require.resolve("@grackle/heft-rig/profiles/web/config/eslint.cjs")],
  parserOptions: { tsconfigRootDir: __dirname }
};
