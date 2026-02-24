"use strict";

const { execSync } = require("child_process");
const path = require("path");

/** @type {import("@rushstack/heft").IRunScriptOptions} */
module.exports.runAsync = async ({ heftConfiguration }) => {
  const cwd = heftConfiguration.buildFolderPath;
  const playwrightBin = path.join(cwd, "node_modules", ".bin", "playwright");
  execSync(`"${playwrightBin}" test`, {
    cwd,
    stdio: "inherit"
  });
};
