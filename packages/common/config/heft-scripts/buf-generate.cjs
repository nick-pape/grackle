"use strict";

const { execSync } = require("child_process");
const path = require("path");

/** @type {import("@rushstack/heft").IRunScriptOptions} */
module.exports.runAsync = async ({ heftConfiguration }) => {
  const cwd = heftConfiguration.buildFolderPath;
  const bufBin = path.join(cwd, "node_modules", ".bin", "buf");
  execSync(`"${bufBin}" generate`, {
    cwd,
    stdio: "inherit"
  });
};
