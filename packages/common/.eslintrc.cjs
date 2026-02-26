module.exports = {
  extends: [require.resolve("@grackle/heft-rig/profiles/protobuf/config/eslint.cjs")],
  parserOptions: { tsconfigRootDir: __dirname }
};
