const fs = require("node:fs");
const path = require("node:path");

/**
 * Fills a code block from a region of a real file, so the docs show code that
 * is type-checked and tested instead of a copy that drifts:
 *
 *     ```tsx file=../../../examples/docs/todos/app.tsx#new-todo
 *     ```
 *
 * The path is relative to the page. The region is the lines between
 * `// #region new-todo` and `// #endregion`. Without `#name`, the whole file.
 * A missing file or region fails the build.
 */
function codeRegion() {
  return (tree, file) => {
    visit(tree, (node) => {
      const match = node.type === "code" && /(?:^|\s)file=(\S+)/.exec(node.meta ?? "");
      if (!match) return;

      const [filePath, region] = match[1].split("#");
      const source = path.resolve(path.dirname(file.path), filePath);
      if (!fs.existsSync(source)) throw new Error(`${file.path}: no such file ${source}`);

      const lines = fs.readFileSync(source, "utf8").trimEnd().split("\n");
      node.value = dedent(region ? extract(lines, region, source) : lines).join("\n");
      node.meta = node.meta.replace(match[0], "").trim() || null;
    });
  };
}

function extract(lines, region, source) {
  const start = lines.findIndex((line) => line.trim() === `// #region ${region}`);
  if (start === -1) throw new Error(`${source}: no region "${region}"`);

  const body = [];
  let depth = 0;
  for (const line of lines.slice(start + 1)) {
    const marker = line.trim();
    if (marker.startsWith("// #region")) depth++;
    else if (marker === "// #endregion") {
      if (depth === 0) return body;
      depth--;
    } else body.push(line);
  }
  throw new Error(`${source}: region "${region}" is never closed`);
}

function dedent(lines) {
  const indents = lines.filter((line) => line.trim()).map((line) => /^ */.exec(line)[0].length);
  const indent = Math.min(...indents);
  return lines.map((line) => line.slice(indent));
}

function visit(node, callback) {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
}

module.exports = codeRegion;
