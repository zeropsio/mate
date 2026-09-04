// Spec §0 Boundaries, invariant MA-6: the mate server spawns `zcp` for exactly
// one thing, `agent mark-oauth`. Everything else the product needs from the
// platform is read by the client with the user's own token (rule 1), and zcp
// never grows a layer for mate (rule 3). This is a source scan, not an AST:
// every `zcp` argv in the zone is written as `[...baseArgs, "<verb>", …]`
// (ZeropsCli.ts), so a literal-sequence match is exact.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

const repoRootUrl = new URL("..", import.meta.url);
const ZONE = "apps/server/src/zerops";
const ALLOWED_ARGV = "agent mark-oauth";

// The leading string literals of the argv; a trailing identifier (`agentId`) is not a verb.
const ZCP_ARGV_PATTERN = /\[\s*\.\.\.baseArgs\s*,\s*((?:"[^"\n]*"\s*,\s*)*"[^"\n]*")/g;

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

function collectSourceFiles(
  dir: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files: Array<string> = [];
    for (const entry of yield* fs.readDirectory(dir)) {
      const entryPath = path.join(dir, entry);
      const stat = yield* fs.stat(entryPath);
      if (stat.type === "Directory") {
        files.push(...(yield* collectSourceFiles(entryPath)));
      } else if (/\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry)) {
        files.push(entryPath);
      }
    }
    return files;
  });
}

const scanZone = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(repoRootUrl);
  const zoneDir = path.join(repoRoot, ZONE);
  const spawns: Array<ZcpSpawn> = [];
  for (const file of yield* collectSourceFiles(zoneDir)) {
    const source = yield* fs.readFileString(file);
    spawns.push(...collectZcpSpawns(source, path.relative(repoRoot, file)));
  }
  return spawns;
});

it.layer(NodeServices.layer)("mate boundaries (spec §0)", (it) => {
  it.effect("collects every literal zcp argv of the zone", () =>
    Effect.sync(() => {
      const source = [
        'const a = spawn({ args: [...baseArgs, "agent", "mark-oauth", agentId] });',
        'const b = ChildProcess.make(command, [...baseArgs, "studio", "watch"], {});',
      ].join("\n");
      assert.deepStrictEqual(
        collectZcpSpawns(source, "x.ts").map((spawn) => spawn.argv),
        ["agent mark-oauth", "studio watch"],
      );
    }),
  );

  it.effect("MA-6: apps/server/src/zerops spawns zcp only for agent mark-oauth", () =>
    Effect.gen(function* () {
      const spawns = yield* scanZone;
      assert.isAbove(spawns.length, 0);
      const violations = spawns.filter((spawn) => !spawn.argv.startsWith(ALLOWED_ARGV));
      assert.deepStrictEqual(violations, []);
    }),
  );
});
