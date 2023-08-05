"use strict";

module.exports = {
  require: "ts-node/register",
  spec: ["./test/**/*.test.ts"],
  "watch-files": ["./src/**/*.ts"],
  "node-option": ["preserve-symlinks"],
  exit: true,
};
