// Publishes every package whose version isn't on npm yet, dependencies first,
// and tags each release `@cuple/<name>@<version>`. A release is a commit that
// bumps the versions; run on main by .github/workflows/release.yml.
//
//   node scripts/publish.mjs            publish and tag
//   node scripts/publish.mjs --dry-run  only say what it would publish

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");
const root = path.resolve(import.meta.dirname, "..");

const packages = readdirSync(path.join(root, "packages")).flatMap((dir) => {
  const json = JSON.parse(
    readFileSync(path.join(root, "packages", dir, "package.json"), "utf8"),
  );
  return json.private ? [] : [{ dir: path.join(root, "packages", dir), json }];
});

const isPublished = ({ name, version }) => {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], { stdio: "pipe" });
    return true;
  } catch (e) {
    if (String(e.stderr).includes("E404")) return false;
    throw e;
  }
};

/** Dependencies first, so a release never points at a version that isn't out yet. */
function ordered(list) {
  const byName = new Map(list.map((pkg) => [pkg.json.name, pkg]));
  const done = new Set();
  const out = [];
  const visit = (pkg) => {
    if (done.has(pkg.json.name)) return;
    done.add(pkg.json.name);
    const { dependencies = {}, peerDependencies = {} } = pkg.json;
    for (const dep of Object.keys({ ...dependencies, ...peerDependencies })) {
      const inner = byName.get(dep);
      if (inner) visit(inner);
    }
    out.push(pkg);
  };
  list.forEach(visit);
  return out;
}

const pending = ordered(packages).filter((pkg) => !isPublished(pkg.json));
if (!pending.length) {
  console.log("Every package's version is on npm already.");
  process.exit(0);
}

for (const { dir, json } of pending) {
  const tag = `${json.name}@${json.version}`;
  console.log(`${dryRun ? "Would publish" : "Publishing"} ${tag}`);
  if (dryRun) continue;
  execFileSync("npm", ["publish", "--access", "public", "--provenance"], {
    cwd: dir,
    stdio: "inherit",
  });
  execFileSync("git", ["tag", tag], { cwd: root, stdio: "inherit" });
  execFileSync("git", ["push", "origin", tag], { cwd: root, stdio: "inherit" });
}
