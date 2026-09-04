// Spec §0 Boundaries, invariant MA-6: the mate server spawns `zcp` for exactly
// one thing, `agent mark-oauth`. Everything else the product needs from the
// platform is read by the client with the user's own token (rule 1), and zcp
// never grows a layer for mate (rule 3). This is a source scan, not an AST:
// every `zcp` argv in the zone is written as `[...baseArgs, "<verb>", …]`
// (ZeropsCli.ts), so a literal-sequence match is exact.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ZONE = "apps/server/src/zerops";
const ALLOWED_ARGV = "agent mark-oauth";

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

  it("MA-6: apps/server/src/zerops spawns zcp only for agent mark-oauth", () => {
    const spawns = scanZone();
    expect(spawns.length).toBeGreaterThan(0);

    const violations = spawns.filter((spawn) => !spawn.argv.startsWith(ALLOWED_ARGV));
    expect(violations).toEqual([]);
  });
});
