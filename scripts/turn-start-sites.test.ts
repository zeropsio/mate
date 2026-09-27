// D6: a turn spends the login of whoever signed its agent in, so every place
// a turn can start either passes `ZeropsTurnAdmission` or is named here with
// the reason it needs no admission of its own. A turn starts from a
// `thread.turn.start` command, or from a message-mode answer
// (`thread.user-input.respond`) the decider turns into one. Two shapes of site
// are scanned: a file that accepts commands from a client (it normalizes them
// with `normalizeDispatchCommand`), and a file that builds a turn command
// itself. This is a source scan, not an AST: every such command in the server
// is an object literal whose literal `type` is followed by more fields, which
// also keeps a type expression (`Extract<…, { type: "thread.turn.start" }>`)
// from counting as one.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

const repoRootUrl = new URL("..", import.meta.url);
const SERVER = "apps/server/src";

const TURN_COMMAND_PATTERN = /\btype:\s*"(?:thread\.turn\.start|thread\.user-input\.respond)",/u;
const CLIENT_COMMAND_PATTERN = /\bnormalizeDispatchCommand\(/u;
const ADMISSION_PATTERN = /\.admit\(/u;

/** The files that accept commands from a client. Each must admit them. */
const CLIENT_ENTRY_POINTS = ["apps/server/src/ws.ts", "apps/server/src/orchestration/http.ts"];

/** Files that build a turn without admitting it, and why that is sound. */
const UNADMITTED_TURN_BUILDERS: Readonly<Record<string, string>> = {
  "apps/server/src/orchestration/decider.ts":
    "the turn a message-mode answer becomes; admission gates the answer itself (isTurnStartingCommand)",
  "apps/server/src/orchestration/Layers/ProviderCommandReactor.ts":
    "re-dispatches a turn already admitted, after its session had to be replaced",
  "apps/server/src/orchestration/Layers/ThreadUsagePauseReactor.ts":
    "resumes a turn the usage limit paused; it was admitted when it started (a signer change during the pause is an open D6 question)",
};

export interface TurnStartSite {
  readonly file: string;
  readonly acceptsClientCommands: boolean;
  readonly buildsTurns: boolean;
  readonly admits: boolean;
}

export function classifyTurnStartSite(source: string, file: string): TurnStartSite {
  return {
    file,
    acceptsClientCommands: CLIENT_COMMAND_PATTERN.test(source),
    buildsTurns: TURN_COMMAND_PATTERN.test(source),
    admits: ADMISSION_PATTERN.test(source),
  };
}

/** Why a site breaks the rule, or `undefined` when it keeps it. */
export function turnStartViolation(site: TurnStartSite): string | undefined {
  if (site.acceptsClientCommands && !CLIENT_ENTRY_POINTS.includes(site.file)) {
    return `${site.file} accepts client commands but is not a listed entry point`;
  }
  if (site.acceptsClientCommands && !site.admits) {
    return `${site.file} accepts client commands without admitting them`;
  }
  if (site.buildsTurns && !site.admits && UNADMITTED_TURN_BUILDERS[site.file] === undefined) {
    return `${site.file} builds a turn without admitting it`;
  }
  return undefined;
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

const scanServer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(repoRootUrl);
  const sites: Array<TurnStartSite> = [];
  for (const file of yield* collectSourceFiles(path.join(repoRoot, SERVER))) {
    const site = classifyTurnStartSite(
      yield* fs.readFileString(file),
      path.relative(repoRoot, file).split(path.sep).join("/"),
    );
    if (site.acceptsClientCommands || site.buildsTurns) sites.push(site);
  }
  return sites;
});

it.layer(NodeServices.layer)("turn start sites (D6)", (it) => {
  it.effect("flags a turn built outside every listed site", () =>
    Effect.sync(() => {
      const site = classifyTurnStartSite(
        'yield* engine.dispatch({ type: "thread.turn.start", commandId, threadId });',
        "apps/server/src/somewhere/NewReactor.ts",
      );
      assert.strictEqual(
        turnStartViolation(site),
        "apps/server/src/somewhere/NewReactor.ts builds a turn without admitting it",
      );
    }),
  );

  it.effect("does not count a type that names a turn command as a turn built", () =>
    Effect.sync(() => {
      const site = classifyTurnStartSite(
        'command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,',
        "apps/server/src/somewhere/types.ts",
      );
      assert.isFalse(site.buildsTurns);
    }),
  );

  it.effect("accepts a turn built by a site that admits it first", () =>
    Effect.sync(() => {
      const site = classifyTurnStartSite(
        [
          "yield* admission.admit({ command, principal });",
          'yield* engine.dispatch({ type: "thread.turn.start", commandId, threadId });',
        ].join("\n"),
        "apps/server/src/somewhere/NewEngine.ts",
      );
      assert.isUndefined(turnStartViolation(site));
    }),
  );

  it.effect("flags a listed entry point that stopped admitting", () =>
    Effect.sync(() => {
      const site = classifyTurnStartSite(
        "const command = yield* normalizeDispatchCommand(args.payload);",
        "apps/server/src/orchestration/http.ts",
      );
      assert.strictEqual(
        turnStartViolation(site),
        "apps/server/src/orchestration/http.ts accepts client commands without admitting them",
      );
    }),
  );

  it.effect("flags a new place that accepts client commands, admitting or not", () =>
    Effect.sync(() => {
      const site = classifyTurnStartSite(
        [
          "const command = yield* normalizeDispatchCommand(input);",
          "yield* admission.admit({ command, principal });",
        ].join("\n"),
        "apps/server/src/somewhere/newRoute.ts",
      );
      assert.strictEqual(
        turnStartViolation(site),
        "apps/server/src/somewhere/newRoute.ts accepts client commands but is not a listed entry point",
      );
    }),
  );

  it.effect("every place in the server that can start a turn keeps the rule", () =>
    Effect.gen(function* () {
      const sites = yield* scanServer;
      assert.deepStrictEqual(
        sites.flatMap((site) => turnStartViolation(site) ?? []),
        [],
      );
    }),
  );

  it.effect("every listed site still starts turns, so no entry outlives its code", () =>
    Effect.gen(function* () {
      const sites = yield* scanServer;
      assert.deepStrictEqual(
        sites
          .filter((site) => site.acceptsClientCommands)
          .map((site) => site.file)
          .toSorted(),
        CLIENT_ENTRY_POINTS.toSorted(),
      );
      const builders = new Set(sites.filter((site) => site.buildsTurns).map((site) => site.file));
      assert.deepStrictEqual(
        Object.keys(UNADMITTED_TURN_BUILDERS).filter((file) => !builders.has(file)),
        [],
      );
    }),
  );
});
