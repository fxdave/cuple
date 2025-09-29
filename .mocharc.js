"use strict";

module.exports = {
  require: "ts-node/register",
  spec: ["./test/**/*.test.ts"],
  "watch-files": ["./packages/**/*.ts", "./test/**/*.ts"],
  "node-option": ["preserve-symlinks"],
  exit: true,
};
