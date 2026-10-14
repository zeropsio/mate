#!/usr/bin/env node
/**
 * Copies zcp's monorepo contract fixtures (zcp `docs/spec-mate.md` §2.8a.7,
 * `internal/tools/testdata/mate-contract/`) into
 * `packages/client-runtime/src/zerops/fixtures/zcp/` and records the zcp commit
 * and each file's sha256 in `SOURCE.json`. zcp owns the files; this script is
 * the only writer of the copy, and `zcpFixtures.test.ts` fails on a hand edit.
 *
 * Usage: node scripts/sync-zcp-fixtures.ts [--zcp <zcp checkout>]   (default ../zcp)
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const flag = process.argv.indexOf("--zcp");
const zcp = NodePath.resolve(root, flag === -1 ? "../zcp" : (process.argv[flag + 1] ?? ""));
const from = NodePath.join(zcp, "internal/tools/testdata/mate-contract");
const to = NodePath.join(root, "packages/client-runtime/src/zerops/fixtures/zcp");

const names = NodeFS.readdirSync(from)
  .filter((name) => name.endsWith(".json"))
  .toSorted();
NodeFS.mkdirSync(to, { recursive: true });
for (const name of NodeFS.readdirSync(to)) {
  if (name.endsWith(".json") && name !== "SOURCE.json" && !names.includes(name)) {
    NodeFS.rmSync(NodePath.join(to, name));
  }
}
const files: Record<string, string> = {};
for (const name of names) {
  const bytes = NodeFS.readFileSync(NodePath.join(from, name));
  NodeFS.writeFileSync(NodePath.join(to, name), bytes);
  files[name] = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
}
const zcpCommit = NodeChildProcess.execFileSync("git", ["-C", zcp, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
NodeFS.writeFileSync(
  NodePath.join(to, "SOURCE.json"),
  `${JSON.stringify({ zcpCommit, files }, null, 2)}\n`,
);
console.log(`Synced ${names.length} zcp fixtures from ${zcpCommit}.`);
