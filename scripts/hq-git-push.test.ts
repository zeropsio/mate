// HQ moves a person's Git branch only forward: git and the remote refuse a non-fast-forward
// themselves, so no push HQ builds may carry a force form. This is a source scan, not an AST:
// HQ writes every push argv as an array literal holding the element "push", so the array
// around that element is the whole argv.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

const repoRootUrl = new URL("..", import.meta.url);
const ZONES = ["apps/hq/src", "packages/hq-git/src"];
const PUSH_SITES = ["apps/hq/src/gitPushChild.ts", "packages/hq-git/src/operations.ts"];

/** `--force`, `--force-with-lease`, `--force-if-includes`, `-f`, or a `+<src>:<dst>` refspec. */
const FORCE_FORM = /--force|["'`]-f["'`]|["'`]\+/u;

interface PushArgv {
  readonly file: string;
  readonly argv: string;
}

/** Every array literal holding the element "push", as its source text. */
export function collectPushArgvs(source: string, file: string): ReadonlyArray<PushArgv> {
  const found: Array<PushArgv> = [];
  for (const match of source.matchAll(/"push"/gu)) {
    let depth = 0;
    let start = -1;
    for (let at = match.index - 1; at >= 0; at--) {
      const char = source[at]!;
      if (char === "]" || char === ")" || char === "}") depth++;
      else if (char === "[" || char === "(" || char === "{") {
        if (depth === 0) {
          if (char === "[") start = at;
          break;
        }
        depth--;
      }
    }
    if (start < 0) continue;
    depth = 0;
    for (let at = start; at < source.length; at++) {
      const char = source[at]!;
      if (char === "[" || char === "(" || char === "{") depth++;
      else if (char === "]" || char === ")" || char === "}") depth--;
      if (depth === 0) {
        found.push({ file, argv: source.slice(start, at + 1) });
        break;
      }
    }
  }
  return found;
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
      if (stat.type === "Directory") files.push(...(yield* collectSourceFiles(entryPath)));
      else if (/\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry)) files.push(entryPath);
    }
    return files;
  });
}

const scanZones = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(repoRootUrl);
  const argvs: Array<PushArgv> = [];
  for (const zone of ZONES)
    for (const file of yield* collectSourceFiles(path.join(repoRoot, zone)))
      argvs.push(
        ...collectPushArgvs(yield* fs.readFileString(file), path.relative(repoRoot, file)),
      );
  return argvs;
});

it.layer(NodeServices.layer)("HQ Git pushes", (it) => {
  it.effect.each([
    { argv: '["push", "--force", url, ref]', forced: true },
    { argv: '["push", "-f", url, ref]', forced: true },
    {
      argv: '["push", `--force-with-lease=${ref}:${expected}`, url, `${sha}:${ref}`]',
      forced: true,
    },
    { argv: '["push", url, `+${sha}:${ref}`]', forced: true },
    {
      argv: '["-C", dir, "push", "--porcelain", "--no-verify", url, `${sha}:${ref}`]',
      forced: false,
    },
  ])("a push argv is forced exactly when it carries a force form: $argv", ({ argv, forced }) =>
    Effect.sync(() => {
      const collected = collectPushArgvs(`run(${argv}, signal);`, "x.ts").map((push) => push.argv);
      assert.deepStrictEqual(collected, [argv]);
      assert.strictEqual(FORCE_FORM.test(argv), forced);
    }),
  );

  it.effect("HQ never pushes to a Git remote with a force flag", () =>
    Effect.gen(function* () {
      const argvs = yield* scanZones;
      for (const site of PUSH_SITES)
        assert.isTrue(
          argvs.some((argv) => argv.file === site),
          `${site} builds a push argv`,
        );
      assert.deepStrictEqual(
        argvs.filter((argv) => FORCE_FORM.test(argv.argv)),
        [],
      );
    }),
  );
});
