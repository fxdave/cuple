/**
 * Puts one version's docs build into the published site, leaving every other
 * version as it is.
 *
 *   node docs/scripts/publish-version.mjs <site dir> <build dir> <major version>
 *
 * `<site dir>` is a checkout of the gh-pages branch. Afterwards it has:
 *
 *   v1/, v2/, ...   one folder per major version, each a full Docusaurus build
 *   versions.json   the versions it has, newest first (read by the version menu)
 *   index.html      redirects to the newest version
 *   404.html        sends old or missing links to the right version
 *
 * Publishing a version again replaces only its folder.
 */
import fs from "node:fs";
import path from "node:path";

const siteRoot = "/cuple/";
const [site, build, version] = process.argv.slice(2);
if (!site || !build || !/^\d+$/.test(version ?? ""))
  throw new Error("usage: publish-version.mjs <site dir> <build dir> <major version>");

const target = path.join(site, `v${version}`);
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(build, target, { recursive: true });

const versionsFile = path.join(site, "versions.json");
const known = fs.existsSync(versionsFile)
  ? JSON.parse(fs.readFileSync(versionsFile, "utf8"))
  : [];
const versions = [...new Set([...known, Number(version)])].sort((a, b) => b - a);
fs.writeFileSync(versionsFile, `${JSON.stringify(versions)}\n`);

const latest = `${siteRoot}v${versions[0]}/`;

fs.writeFileSync(
  path.join(site, "index.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>Cuple RPC</title>
<meta http-equiv="refresh" content="0; url=${latest}">
<script>location.replace(${JSON.stringify(latest)} + location.search + location.hash)</script>
<a href="${latest}">Cuple RPC documentation</a>
`,
);

// GitHub Pages serves this for any path that doesn't exist.
// - /cuple/v1/some/page that v1 doesn't have: v1's home.
// - /cuple/v9/, a version that isn't published: the newest version's home.
// - /cuple/docs/client/installation, a link from before versions: the same
//   page in the newest version.
fs.writeFileSync(
  path.join(site, "404.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>Cuple RPC</title>
<script>
  var root = ${JSON.stringify(siteRoot)};
  var rest = location.pathname.startsWith(root) ? location.pathname.slice(root.length) : "";
  var versions = ${JSON.stringify(versions)};
  var version = /^v(\\d+)\\//.exec(rest);
  if (version && versions.indexOf(Number(version[1])) !== -1) location.replace(root + version[0]);
  else location.replace(${JSON.stringify(latest)} + (version ? "" : rest) + location.search + location.hash);
</script>
<a href="${latest}">Cuple RPC documentation</a>
`,
);

// Serve folders starting with "_" as they are.
fs.writeFileSync(path.join(site, ".nojekyll"), "");

console.log(`Published v${version} into ${site}; versions: ${versions.join(", ")}`);
