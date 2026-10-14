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
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const flag = process.argv.indexOf("--zcp");
const zcp = resolve(root, flag === -1 ? "../zcp" : (process.argv[flag + 1] ?? ""));
const from = join(zcp, "internal/tools/testdata/mate-contract");
const to = join(root, "packages/client-runtime/src/zerops/fixtures/zcp");

const names = readdirSync(from)
  .filter((name) => name.endsWith(".json"))
  .toSorted();
mkdirSync(to, { recursive: true });
for (const name of readdirSync(to)) {
  if (name.endsWith(".json") && name !== "SOURCE.json" && !names.includes(name)) {
    rmSync(join(to, name));
  }
}
const files: Record<string, string> = {};
for (const name of names) {
  const bytes = readFileSync(join(from, name));
  writeFileSync(join(to, name), bytes);
  files[name] = createHash("sha256").update(bytes).digest("hex");
}
const zcpCommit = execFileSync("git", ["-C", zcp, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
writeFileSync(join(to, "SOURCE.json"), `${JSON.stringify({ zcpCommit, files }, null, 2)}\n`);
console.log(`Synced ${names.length} zcp fixtures from ${zcpCommit}.`);
