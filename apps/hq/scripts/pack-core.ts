/**
 * Builds HQ Core and packs it into a web build, which carries it same-origin under `hq-core/`:
 * the archive an HQ birth deploys (`core.tgz.bin`: a gzipped tar of `dist/main.mjs` and
 * `zerops.yml`, as the rig's deploy packs it) and the `zerops.yml` it deploys it with. The web and
 * the Core it stands up are then of one commit. The archive is not named `*.gz`: a static server
 * serves that with `Content-Encoding: gzip`, and the browser unpacks it on the way (measured on the
 * rig, 2026-10-02).
 *
 * The bundle is stamped `HQ_BUILD` when the caller sets one, else `<short sha>.<UTC>`, so `/health`
 * says which build an HQ runs.
 *
 * Usage: node apps/hq/scripts/pack-core.ts <web outDir>
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const outDir = process.argv[2];
if (outDir === undefined) throw new Error("usage: pack-core.ts <web outDir>");

const app = NodePath.resolve(import.meta.dirname, "..");
const vp = NodePath.join(app, "node_modules", ".bin", "vp");
const utc = new Date().toISOString().replace(/[-:]/gu, "").slice(0, 15);
const sha = (() => {
  try {
    return NodeChildProcess.execFileSync("git", ["-C", app, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "nogit";
  }
})();
const stamp = process.env["HQ_BUILD"] ?? `${sha}.${utc}`;

NodeChildProcess.execFileSync(vp, ["pack"], {
  cwd: app,
  env: { ...process.env, HQ_BUILD: stamp },
  stdio: "inherit",
});
const bundle = NodePath.join(app, "dist", "main.mjs");
if (!NodeFS.readFileSync(bundle, "utf8").includes(JSON.stringify(stamp))) {
  throw new Error(`${bundle} does not carry the stamp ${stamp}`);
}

const target = NodePath.join(NodePath.resolve(outDir), "hq-core");
const stage = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-core-"));
try {
  NodeFS.mkdirSync(NodePath.join(stage, "dist"));
  NodeFS.copyFileSync(bundle, NodePath.join(stage, "dist", "main.mjs"));
  NodeFS.copyFileSync(NodePath.join(app, "zerops.yml"), NodePath.join(stage, "zerops.yml"));
  NodeFS.mkdirSync(target, { recursive: true });
  // COPYFILE_DISABLE: macOS tar would add AppleDouble `._*` entries.
  NodeChildProcess.execFileSync(
    "tar",
    ["czf", NodePath.join(target, "core.tgz.bin"), "-C", stage, "dist", "zerops.yml"],
    {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    },
  );
  NodeFS.copyFileSync(NodePath.join(app, "zerops.yml"), NodePath.join(target, "zerops.yml"));
} finally {
  NodeFS.rmSync(stage, { recursive: true, force: true });
}
console.log(`hq-core: ${stamp} → ${target}`);
