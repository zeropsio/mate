// Spec §0 Boundaries, invariant MA-6: the mate server spawns `zcp` for exactly
// one thing, `agent mark-oauth`. Everything else the product needs from the
// platform is read by the client with the user's own token (rule 1), and zcp
// never grows a layer for mate (rule 3). This is a source scan, not an AST:
// every `zcp` argv in the zone is written as `[...baseArgs, "<verb>", …]`
// (ZeropsCli.ts), so a literal-sequence match is exact.
//
// The allowlist below is temporary and dated: it names the two `zcp studio`
// spawns of the server topology feed until slice S4 of the
// mate-architecture-boundaries plan deletes them. The test fails in both
// directions — a new spawn outside the allowlist, and an allowlist entry
// whose spawn no longer exists — so the list cannot outlive its reason.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ZONE = "apps/server/src/zerops";
const ALLOWED_ARGV = "agent mark-oauth";

/** file (repo-relative) → argv prefixes still tolerated there. Delete with the spawns (S4). */
const TEMPORARY_ALLOWLIST: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ["apps/server/src/zerops/ZeropsCli.ts", ["studio topology", "studio watch"]],
]);

// The leading string literals of the argv; a trailing identifier (`agentId`) is not a verb.
const ZCP_ARGV_PATTERN = /\[\s*\.\.\.baseArgs\s*,\s*((?:"[^"\n]*"\s*,\s*)*"[^"\n]*")/g;

function collectSourceFiles(dir: string): ReadonlyArray<string> {
  const files: Array<string> = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    if (statSync(entryPath).isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (/\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry)) {
      files.push(entryPath);
    }
  }
  return files;
}

interface ZcpSpawn {
  readonly file: string;
  readonly argv: string;
}

export function collectZcpSpawns(source: string, file: string): ReadonlyArray<ZcpSpawn> {
  const spawns: Array<ZcpSpawn> = [];
  for (const match of source.matchAll(ZCP_ARGV_PATTERN)) {
    const literals = [...match[1]!.matchAll(/"([^"\n]*)"/g)].map((literal) => literal[1]!);
    spawns.push({ file, argv: literals.join(" ") });
  }
  return spawns;
}

function scanZone(): ReadonlyArray<ZcpSpawn> {
  const zoneDir = join(repoRoot, ZONE);
  return collectSourceFiles(zoneDir).flatMap((path) =>
    collectZcpSpawns(readFileSync(path, "utf8"), relative(repoRoot, path)),
  );
}

describe("mate boundaries (spec §0)", () => {
  it("collects every literal zcp argv of the zone", () => {
    const source = [
      'const a = spawn({ args: [...baseArgs, "agent", "mark-oauth", agentId] });',
      'const b = ChildProcess.make(command, [...baseArgs, "studio", "watch"], {});',
    ].join("\n");
    expect(collectZcpSpawns(source, "x.ts").map((spawn) => spawn.argv)).toEqual([
      "agent mark-oauth",
      "studio watch",
    ]);
  });

  it("MA-6: apps/server/src/zerops spawns zcp only for agent mark-oauth (plus the dated allowlist)", () => {
    const spawns = scanZone();
    expect(spawns.length).toBeGreaterThan(0);

    const violations = spawns.filter((spawn) => {
      if (spawn.argv.startsWith(ALLOWED_ARGV)) return false;
      const tolerated = TEMPORARY_ALLOWLIST.get(spawn.file) ?? [];
      return !tolerated.some((prefix) => spawn.argv.startsWith(prefix));
    });
    expect(violations).toEqual([]);
  });

  it("the allowlist names only spawns that still exist (delete the entry with the spawn)", () => {
    const spawns = scanZone();
    const stale: Array<string> = [];
    for (const [file, prefixes] of TEMPORARY_ALLOWLIST) {
      for (const prefix of prefixes) {
        const present = spawns.some(
          (spawn) => spawn.file === file && spawn.argv.startsWith(prefix),
        );
        if (!present) stale.push(`${file}: ${prefix}`);
      }
    }
    expect(stale).toEqual([]);
  });
});
