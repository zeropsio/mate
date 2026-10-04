/**
 * Builds HQ Core and packs it into a web build, which carries it same-origin under `hq-core/`:
 * the archive an HQ birth or update deploys (`core.tgz.bin`: a gzipped tar of `dist/main.mjs` and
 * `zerops.yml`, as the rig's deploy packs it), the `zerops.yml` it deploys it with, and
 * `build.json` (`{ "build": <identity> }`), which Core this web carries. The web and the Core it
 * stands up are then of one commit. The archive is not named `*.gz`: a static server serves that
 * with `Content-Encoding: gzip`, and the browser unpacks it on the way (measured on the rig,
 * 2026-10-02).
 *
 * The bundle is stamped with its identity (`src/coreIdentity.ts`), so `/health` says which Core an
 * HQ runs: the commit's time — the build's own where no git answers — and the digest of the
 * deployed files.
 *
 * Usage: node apps/hq/scripts/pack-core.ts <web outDir>
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { CORE_BUILD_PLACEHOLDER, coreIdentity, stampBundle } from "../src/coreIdentity.ts";

const outDir = process.argv[2];
if (outDir === undefined) throw new Error("usage: pack-core.ts <web outDir>");

const app = NodePath.resolve(import.meta.dirname, "..");
const vp = NodePath.join(app, "node_modules", ".bin", "vp");
const committedAt = (() => {
  try {
    return NodeChildProcess.execFileSync(
      "git",
      ["-C", app, "log", "-1", "--format=%cd", "--date=format-local:%Y%m%dT%H%M%SZ"],
      { encoding: "utf8", env: { ...process.env, TZ: "UTC" } },
    ).trim();
  } catch {
    return new Date().toISOString().replace(/[-:]/gu, "").slice(0, 15) + "Z";
  }
})();

NodeChildProcess.execFileSync(vp, ["pack"], {
  cwd: app,
  env: { ...process.env, HQ_BUILD: CORE_BUILD_PLACEHOLDER },
  stdio: "inherit",
});
const built = NodePath.join(app, "dist", "main.mjs");
const zeropsYaml = NodeFS.readFileSync(NodePath.join(app, "zerops.yml"), "utf8");
const placeheld = NodeFS.readFileSync(built, "utf8");
const identity = coreIdentity({ committedAt, bundle: placeheld, zeropsYaml });
const bundle = stampBundle(placeheld, identity);

const target = NodePath.join(NodePath.resolve(outDir), "hq-core");
const stage = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-core-"));
try {
  NodeFS.mkdirSync(NodePath.join(stage, "dist"));
  NodeFS.writeFileSync(NodePath.join(stage, "dist", "main.mjs"), bundle);
  NodeFS.writeFileSync(NodePath.join(stage, "zerops.yml"), zeropsYaml);
  NodeFS.mkdirSync(target, { recursive: true });
  // COPYFILE_DISABLE: macOS tar would add AppleDouble `._*` entries.
  NodeChildProcess.execFileSync(
    "tar",
    ["czf", NodePath.join(target, "core.tgz.bin"), "-C", stage, "dist", "zerops.yml"],
    {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    },
  );
  NodeFS.writeFileSync(NodePath.join(target, "zerops.yml"), zeropsYaml);
  NodeFS.writeFileSync(NodePath.join(target, "build.json"), JSON.stringify({ build: identity }));
} finally {
  NodeFS.rmSync(stage, { recursive: true, force: true });
}
console.log(`hq-core: ${identity} → ${target}`);
