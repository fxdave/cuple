#!/usr/bin/env node
import { generateMcpTools } from "./index.js";

const USAGE = "Usage: cuple-mcp tools <routes-file> <variable> [--tsconfig <path>]";

const args = process.argv.slice(2);
const tsconfigAt = args.indexOf("--tsconfig");
const tsconfigPath = tsconfigAt >= 0 ? args.splice(tsconfigAt, 2)[1] : undefined;
const [command, filePath, variableName] = args;

if (command !== "tools" || !filePath || !variableName) {
  console.error(USAGE);
  process.exit(1);
}

const tools = generateMcpTools(filePath, variableName, { tsconfigPath });
process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`);
