// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { ThreadId, type CheckpointRef } from "@t3tools/contracts";
import { VcsProcessExitError } from "@t3tools/contracts";

import type * as CheckpointStoreTypes from "../checkpointing/CheckpointStore.ts";
import type * as VcsProcess from "../vcs/VcsProcess.ts";
import type { ZeropsRepositories, ZeropsRepository } from "./ZeropsRepositorySource.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcessLayer from "../vcs/VcsProcess.ts";
import * as ServerConfig from "../config.ts";
import {
  checkpointRefForThreadTurn,
  checkpointRefsPrefixForThread,
} from "../checkpointing/Utils.ts";
import {
  UNTRACKED_PROBE_MAX_BYTES,
  captureAcrossTargets,
  captureBaselineAcrossTargets,
  diffAcrossTargets,
  mergeCheckpointFiles,
  resolveCheckpointTargets,
  pruneThreadRefsAcrossTargets,
  resolvePruneTargets,
  restoreAcrossTargets,
} from "./ZeropsCheckpointTargets.ts";

const RealServerConfigLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-zerops-checkpoint-targets-test-",
});
const RealVcsProcessLayer = VcsProcessLayer.layer.pipe(Layer.provide(NodeServices.layer));
const RealVcsDriverLayer = VcsDriverRegistry.layer.pipe(Layer.provide(RealVcsProcessLayer));
const RealCheckpointStoreLayer = CheckpointStore.layer.pipe(
  Layer.provideMerge(RealVcsDriverLayer),
  Layer.provideMerge(NodeServices.layer),
);
const RealFanOutLayer = RealCheckpointStoreLayer.pipe(
  Layer.provideMerge(RealVcsProcessLayer),
  Layer.provideMerge(RealVcsDriverLayer),
  Layer.provideMerge(RealServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

const kanban: ZeropsRepository = {
  host: "kanbandev",
  mountPath: "/var/www/kanbandev",
  remotePath: "/var/www",
};
const api: ZeropsRepository = {
  host: "apidev",
  mountPath: "/var/www/apidev",
  remotePath: "/var/www",
};

const available = (repositories: ReadonlyArray<ZeropsRepository>): ZeropsRepositories => ({
  _tag: "available",
  repositories,
});

const ref = (value: string) => value as CheckpointRef;

describe("resolveCheckpointTargets", () => {
  it("keeps the single upstream target when this is not a Zerops environment", () => {
    assert.deepStrictEqual(resolveCheckpointTargets("/home/me/repo", { _tag: "disabled" }), [
      { cwd: "/home/me/repo", prefix: "" },
    ]);
  });

  it("keeps the single upstream target when the topology could not be read", () => {
    assert.deepStrictEqual(
      resolveCheckpointTargets("/var/www", { _tag: "unavailable", reason: "no credentials" }),
      [{ cwd: "/var/www", prefix: "" }],
    );
  });

  it("fans a workspace root out over every repository mounted inside it", () => {
    assert.deepStrictEqual(resolveCheckpointTargets("/var/www", available([kanban, api])), [
      { cwd: "/var/www/kanbandev", prefix: "kanbandev/" },
      { cwd: "/var/www/apidev", prefix: "apidev/" },
    ]);
  });

  it("uses the one repository a narrower cwd sits in, with no prefix to add", () => {
    assert.deepStrictEqual(
      resolveCheckpointTargets("/var/www/kanbandev", available([kanban, api])),
      [{ cwd: "/var/www/kanbandev", prefix: "" }],
    );
    assert.deepStrictEqual(
      resolveCheckpointTargets("/var/www/kanbandev/packages/app", available([kanban, api])),
      [{ cwd: "/var/www/kanbandev/packages/app", prefix: "" }],
    );
  });

  it("has nothing to check point when a Zerops project has no mounted repository", () => {
    assert.deepStrictEqual(resolveCheckpointTargets("/var/www", available([])), []);
  });

  it("leaves an ordinary repository elsewhere on the container alone", () => {
    assert.deepStrictEqual(resolveCheckpointTargets("/home/zerops/scratch", available([kanban])), [
      { cwd: "/home/zerops/scratch", prefix: "" },
    ]);
  });
});

describe("mergeCheckpointFiles", () => {
  it("prefixes each repository's paths and sorts, so the list reads grouped by service", () => {
    assert.deepStrictEqual(
      mergeCheckpointFiles([
        {
          prefix: "kanbandev/",
          files: [
            { path: "src/board.ts", additions: 3, deletions: 1 },
            { path: "README.md", additions: 1, deletions: 0 },
          ],
        },
        { prefix: "apidev/", files: [{ path: "main.go", additions: 9, deletions: 2 }] },
      ]),
      [
        { path: "apidev/main.go", kind: "modified", additions: 9, deletions: 2 },
        { path: "kanbandev/README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "kanbandev/src/board.ts", kind: "modified", additions: 3, deletions: 1 },
      ],
    );
  });

  it("leaves paths untouched for the single unprefixed target", () => {
    assert.deepStrictEqual(
      mergeCheckpointFiles([{ prefix: "", files: [{ path: "a.ts", additions: 1, deletions: 0 }] }]),
      [{ path: "a.ts", kind: "modified", additions: 1, deletions: 0 }],
    );
  });
});

interface StoreCall {
  readonly op: string;
  readonly cwd: string;
}

const storeError = (cwd: string) =>
  new VcsProcessExitError({
    operation: "captureCheckpoint",
    command: "git",
    cwd,
    exitCode: 1,
    detail: "boom",
  });

const makeStore = (options?: {
  readonly failCapture?: ReadonlySet<string>;
  readonly failDiff?: ReadonlySet<string>;
  readonly failRestore?: ReadonlySet<string>;
  readonly missingBaseline?: ReadonlySet<string>;
  readonly diffByCwd?: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<StoreCall>>([]);
    const record = (op: string, cwd: string) =>
      Ref.update(calls, (previous) => [...previous, { op, cwd }]);
    const service = {
      isGitRepository: () => Effect.succeed(true),
      hasCheckpointRef: (input: { readonly cwd: string }) =>
        record("hasCheckpointRef", input.cwd).pipe(
          Effect.as(!(options?.missingBaseline?.has(input.cwd) ?? false)),
        ),
      captureCheckpoint: (input: { readonly cwd: string }) =>
        record("captureCheckpoint", input.cwd).pipe(
          Effect.andThen(
            options?.failCapture?.has(input.cwd) === true
              ? Effect.fail(storeError(input.cwd))
              : Effect.void,
          ),
        ),
      restoreCheckpoint: (input: { readonly cwd: string }) =>
        record("restoreCheckpoint", input.cwd).pipe(
          Effect.andThen(
            options?.failRestore?.has(input.cwd) === true
              ? Effect.fail(storeError(input.cwd))
              : Effect.succeed(true),
          ),
        ),
      diffCheckpoints: (input: { readonly cwd: string }) =>
        record("diffCheckpoints", input.cwd).pipe(
          Effect.andThen(
            options?.failDiff?.has(input.cwd) === true
              ? Effect.fail(storeError(input.cwd))
              : Effect.succeed(options?.diffByCwd?.[input.cwd] ?? ""),
          ),
        ),
      deleteCheckpointRefs: (input: { readonly cwd: string }) =>
        record("deleteCheckpointRefs", input.cwd).pipe(Effect.asVoid),
    } as unknown as CheckpointStoreTypes.CheckpointStore["Service"];
    return { service, calls } as const;
  });

/** A `ls-files --others` probe that reports whichever cwds overflow the cap. */
const makeVcsProcess = (
  overflowing?: ReadonlySet<string>,
  refsByCwd?: Record<string, string>,
  unreachable?: ReadonlySet<string>,
) =>
  Effect.gen(function* () {
    const probes = yield* Ref.make<ReadonlyArray<VcsProcess.VcsProcessInput>>([]);
    const service = {
      run: (input: VcsProcess.VcsProcessInput) =>
        Ref.update(probes, (previous) => [...previous, input]).pipe(
          Effect.andThen(
            unreachable?.has(input.cwd) === true
              ? Effect.fail(storeError(input.cwd))
              : Effect.succeed({
                  exitCode: 0,
                  stdout: input.args.includes("for-each-ref") ? (refsByCwd?.[input.cwd] ?? "") : "",
                  stderr: "",
                  stdoutTruncated: overflowing?.has(input.cwd) ?? false,
                  stderrTruncated: false,
                }),
          ),
        ),
    } as unknown as VcsProcess.VcsProcess["Service"];
    return { service, probes } as const;
  });

const diffFor = (path: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+one\n`;

/** `captureAcrossTargets` reads numstat, not a patch - one addition, no deletions. */
const numstatFor = (path: string) => `1\t0\t${path}\0`;

const targets = [
  { cwd: "/var/www/kanbandev", prefix: "kanbandev/" },
  { cwd: "/var/www/apidev", prefix: "apidev/" },
];

const fanOut = (
  store: { readonly service: CheckpointStoreTypes.CheckpointStore["Service"] },
  vcs: { readonly service: VcsProcess.VcsProcess["Service"] },
) => ({ store: store.service, vcsProcess: vcs.service });

describe("diffAcrossTargets", () => {
  it("merges two repositories into one host-prefixed patch without rewriting hunk content", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({
        diffByCwd: {
          "/var/www/kanbandev": [
            "diff --git a/src/old.ts b/src/new.ts",
            "similarity index 90%",
            "rename from src/old.ts",
            "rename to src/new.ts",
            "--- a/src/old.ts",
            "+++ b/src/new.ts",
            "@@ -1 +1 @@",
            "--- a/header-looking-hunk-content.ts",
            "+++ b/header-looking-hunk-content.ts",
            "",
          ].join("\n"),
          "/var/www/apidev": diffFor("main.go"),
        },
      });

      const result = yield* diffAcrossTargets(store.service, {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
        fallbackFromToHead: false,
        ignoreWhitespace: true,
      });

      assert.strictEqual(
        result,
        [
          "diff --git a/kanbandev/src/old.ts b/kanbandev/src/new.ts",
          "similarity index 90%",
          "rename from kanbandev/src/old.ts",
          "rename to kanbandev/src/new.ts",
          "--- a/kanbandev/src/old.ts",
          "+++ b/kanbandev/src/new.ts",
          "@@ -1 +1 @@",
          "--- a/header-looking-hunk-content.ts",
          "+++ b/header-looking-hunk-content.ts",
          "diff --git a/apidev/main.go b/apidev/main.go",
          "--- a/apidev/main.go",
          "+++ b/apidev/main.go",
          "@@ -0,0 +1 @@",
          "+one",
          "",
        ].join("\n"),
      );
      assert.deepStrictEqual(
        (yield* Ref.get(store.calls))
          .filter((call) => call.op === "diffCheckpoints")
          .map((call) => call.cwd),
        ["/var/www/kanbandev", "/var/www/apidev"],
      );
    }).pipe(Effect.runPromise));
});

describe("captureAcrossTargets", () => {
  it("captures once per repository and merges the diffs into one grouped list", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({
        diffByCwd: {
          "/var/www/kanbandev": numstatFor("src/board.ts"),
          "/var/www/apidev": numstatFor("main.go"),
        },
      });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      const captured = (yield* Ref.get(store.calls))
        .filter((call) => call.op === "captureCheckpoint")
        .map((call) => call.cwd);
      assert.deepStrictEqual(captured, ["/var/www/kanbandev", "/var/www/apidev"]);
      assert.deepStrictEqual(
        result.files.map((file) => file.path),
        ["apidev/main.go", "kanbandev/src/board.ts"],
      );
      assert.deepStrictEqual(result.skipped, []);
    }).pipe(Effect.runPromise));

  // A repository whose turn diff exceeds diffCheckpoints' patch-format output
  // cap must still summarise every file it touched - a 10MB+ diff, not just
  // the large file, silently losing every entry (not merely the large file's)
  // is the bug this reproduces against the un-migrated unified-diff parser.
  it("summarises every file even when one repository's turn diff is oversized", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const tmp = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "zerops-checkpoint-targets-large-",
      });
      const vcsProcess = yield* VcsProcessLayer.VcsProcess;
      const git = (args: ReadonlyArray<string>) =>
        vcsProcess.run({
          operation: "ZeropsCheckpointTargets.test.git",
          command: "git",
          cwd: tmp,
          args,
          timeoutMs: 10_000,
        });
      yield* git(["init"]);
      yield* git(["config", "user.email", "test@test.com"]);
      yield* git(["config", "user.name", "Test"]);
      yield* fileSystem.writeFileString(NodePath.join(tmp, "README.md"), "# test\n");
      yield* git(["add", "."]);
      yield* git(["commit", "-m", "initial commit"]);

      const checkpointStore = yield* CheckpointStore.CheckpointStore;
      const threadId = ThreadId.make("thread-zerops-checkpoint-targets-large");
      const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: fromCheckpointRef });

      yield* fileSystem.writeFileString(NodePath.join(tmp, "README.md"), "v2\n");
      const largeFileLineCount = 25_000;
      yield* fileSystem.writeFileString(
        NodePath.join(tmp, "large.txt"),
        `${"payload".repeat(64)}\n`.repeat(largeFileLineCount),
      );
      yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: toCheckpointRef });

      const result = yield* captureAcrossTargets(
        { store: checkpointStore, vcsProcess },
        {
          targets: [{ cwd: tmp, prefix: "" }],
          fromCheckpointRef,
          toCheckpointRef,
        },
      );

      assert.deepStrictEqual(result.captured, [tmp]);
      assert.deepStrictEqual(result.files.map((file) => file.path).toSorted(), [
        "README.md",
        "large.txt",
      ]);
      // The full-patch format truncates at CHECKPOINT_DIFF_MAX_OUTPUT_BYTES
      // (10MB, this file's diff exceeds it) and the unified-diff parser then
      // under-reports the cut-off file's own line count instead of failing
      // loudly - a silently wrong summary, not just a missing one.
      const largeFile = result.files.find((file) => file.path === "large.txt");
      assert.strictEqual(largeFile?.additions, largeFileLineCount);
    }).pipe(Effect.scoped, Effect.provide(RealFanOutLayer), Effect.runPromise));

  it("names the turn with one ref in every repository, which is what keeps the projection flat", () =>
    Effect.gen(function* () {
      const refs: Array<string> = [];
      const store = yield* makeStore();
      const capturing = {
        ...store.service,
        captureCheckpoint: (input: { readonly cwd: string; readonly checkpointRef: string }) => {
          refs.push(input.checkpointRef);
          return store.service.captureCheckpoint(input as never);
        },
      } as unknown as CheckpointStoreTypes.CheckpointStore["Service"];
      const vcs = yield* makeVcsProcess();

      yield* captureAcrossTargets(
        { store: capturing, vcsProcess: vcs.service },
        {
          targets,
          fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
          toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
        },
      );

      // Each repository has its own ref store, so one string is unambiguous in
      // all of them - and the projection keeps its single checkpoint_ref column.
      assert.deepStrictEqual(refs, [
        "refs/t3/checkpoints/x/turn/1",
        "refs/t3/checkpoints/x/turn/1",
      ]);
    }).pipe(Effect.runPromise));

  it("keeps the checkpoint when only its diff could not be read, and says so", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({
        failDiff: new Set(["/var/www/kanbandev"]),
        diffByCwd: { "/var/www/apidev": numstatFor("main.go") },
      });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      assert.deepStrictEqual(result.captured, ["/var/www/kanbandev", "/var/www/apidev"]);
      assert.deepStrictEqual(result.skipped, []);
      assert.deepStrictEqual(
        result.diffUnavailable.map((entry) => entry.cwd),
        ["/var/www/kanbandev"],
      );
      assert.deepStrictEqual(
        result.files.map((file) => file.path),
        ["apidev/main.go"],
      );
    }).pipe(Effect.runPromise));

  it("keeps one repository's checkpoint when another's fails", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({
        failCapture: new Set(["/var/www/kanbandev"]),
        diffByCwd: { "/var/www/apidev": numstatFor("main.go") },
      });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      assert.deepStrictEqual(
        result.files.map((file) => file.path),
        ["apidev/main.go"],
      );
      assert.deepStrictEqual(
        result.skipped.map((entry) => entry.cwd),
        ["/var/www/kanbandev"],
      );
      assert.deepStrictEqual(result.captured, ["/var/www/apidev"]);
    }).pipe(Effect.runPromise));

  it("reports a missing baseline per repository without skipping the capture", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({ missingBaseline: new Set(["/var/www/apidev"]) });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      assert.deepStrictEqual(result.missingBaseline, ["/var/www/apidev"]);
      assert.deepStrictEqual(result.captured, ["/var/www/kanbandev", "/var/www/apidev"]);
    }).pipe(Effect.runPromise));

  it("refuses only the repository whose untracked set overflows the probe", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({ diffByCwd: { "/var/www/apidev": numstatFor("main.go") } });
      const vcs = yield* makeVcsProcess(new Set(["/var/www/kanbandev"]));

      const result = yield* captureAcrossTargets(fanOut(store, vcs), {
        targets,
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });

      assert.deepStrictEqual(result.captured, ["/var/www/apidev"]);
      const [skipped] = result.skipped;
      assert.strictEqual(skipped?.cwd, "/var/www/kanbandev");
      assert.include(skipped?.reason ?? "", ".gitignore");
      assert.deepStrictEqual(
        (yield* Ref.get(store.calls))
          .filter((call) => call.op === "captureCheckpoint")
          .map((call) => call.cwd),
        ["/var/www/apidev"],
      );
    }).pipe(Effect.runPromise));

  it("probes cheaply before every capture, so a fixed .gitignore lifts the refusal", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      const vcs = yield* makeVcsProcess();
      const context = fanOut(store, vcs);

      yield* captureAcrossTargets(context, {
        targets: [targets[0]!],
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/0"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
      });
      yield* captureAcrossTargets(context, {
        targets: [targets[0]!],
        fromCheckpointRef: ref("refs/t3/checkpoints/x/turn/1"),
        toCheckpointRef: ref("refs/t3/checkpoints/x/turn/2"),
      });

      const probes = yield* Ref.get(vcs.probes);
      assert.strictEqual(probes.length, 2);
      const [probe] = probes;
      assert.deepStrictEqual(probe?.args, ["ls-files", "--others", "--exclude-standard", "-z"]);
      assert.strictEqual(probe?.maxOutputBytes, UNTRACKED_PROBE_MAX_BYTES);
    }).pipe(Effect.runPromise));
});

describe("restoreAcrossTargets", () => {
  it("restores every repository the checkpoint covers", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();

      const result = yield* restoreAcrossTargets(store.service, {
        targets,
        checkpointRef: ref("refs/t3/checkpoints/x/turn/1"),
        fallbackToHead: false,
      });

      assert.deepStrictEqual(result.restored, ["/var/www/kanbandev", "/var/www/apidev"]);
      assert.deepStrictEqual(result.failed, []);
    }).pipe(Effect.runPromise));

  it("reports the repository that could not be restored without losing the others", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({ failRestore: new Set(["/var/www/apidev"]) });

      const result = yield* restoreAcrossTargets(store.service, {
        targets,
        checkpointRef: ref("refs/t3/checkpoints/x/turn/1"),
        fallbackToHead: false,
      });

      assert.deepStrictEqual(result.restored, ["/var/www/kanbandev"]);
      assert.deepStrictEqual(
        result.failed.map((entry) => entry.cwd),
        ["/var/www/apidev"],
      );
    }).pipe(Effect.runPromise));
});

describe("captureBaselineAcrossTargets", () => {
  it("writes the baseline only where it is missing", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({ missingBaseline: new Set(["/var/www/apidev"]) });
      const vcs = yield* makeVcsProcess();

      const result = yield* captureBaselineAcrossTargets(fanOut(store, vcs), {
        targets,
        checkpointRef: ref("refs/t3/checkpoints/x/turn/0"),
      });

      assert.deepStrictEqual(result.captured, ["/var/www/apidev"]);
      assert.deepStrictEqual(result.alreadyPresent, ["/var/www/kanbandev"]);
    }).pipe(Effect.runPromise));

  it("keeps refusing while the repository still overflows, however often it is asked", () =>
    Effect.gen(function* () {
      // The reactor drives the baseline twice per turn - once for
      // thread.turn-start-requested and once for thread.message-sent - through
      // one shared fan-out. A guard that only refuses the first time lets the
      // second call commit the very tree it just refused.
      const store = yield* makeStore({ missingBaseline: new Set(["/var/www/kanbandev"]) });
      const vcs = yield* makeVcsProcess(new Set(["/var/www/kanbandev"]));
      const context = fanOut(store, vcs);
      const input = {
        targets: [{ cwd: "/var/www/kanbandev", prefix: "" }],
        checkpointRef: ref("refs/t3/checkpoints/x/turn/0"),
      };

      const first = yield* captureBaselineAcrossTargets(context, input);
      const second = yield* captureBaselineAcrossTargets(context, input);

      assert.deepStrictEqual(first.captured, []);
      assert.deepStrictEqual(second.captured, []);
      assert.strictEqual(second.skipped.length, 1);
      assert.deepStrictEqual(
        (yield* Ref.get(store.calls))
          .filter((call) => call.op === "captureCheckpoint")
          .map((call) => call.cwd),
        [],
      );
    }).pipe(Effect.runPromise));

  it("refuses the repository whose first checkpoint would swallow its untracked tree", () =>
    Effect.gen(function* () {
      const store = yield* makeStore({
        missingBaseline: new Set(["/var/www/kanbandev", "/var/www/apidev"]),
      });
      const vcs = yield* makeVcsProcess(new Set(["/var/www/kanbandev"]));

      const result = yield* captureBaselineAcrossTargets(fanOut(store, vcs), {
        targets,
        checkpointRef: ref("refs/t3/checkpoints/x/turn/0"),
      });

      assert.deepStrictEqual(result.captured, ["/var/www/apidev"]);
      assert.deepStrictEqual(
        result.skipped.map((entry) => entry.cwd),
        ["/var/www/kanbandev"],
      );
    }).pipe(Effect.runPromise));
});

describe("pruneThreadRefsAcrossTargets", () => {
  it("names the same refs the capture side writes", () => {
    const threadId = "thread-1" as never;
    assert.isTrue(
      checkpointRefForThreadTurn(threadId, 3).startsWith(checkpointRefsPrefixForThread(threadId)),
    );
  });

  it("deletes every ref the thread left in every repository it covered", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      const vcs = yield* makeVcsProcess(undefined, {
        "/var/www/kanbandev":
          "refs/t3/checkpoints/dGhyZWFk/turn/0\nrefs/t3/checkpoints/dGhyZWFk/turn/1\n",
        "/var/www/apidev": "refs/t3/checkpoints/dGhyZWFk/turn/0\n",
      });

      const result = yield* pruneThreadRefsAcrossTargets(fanOut(store, vcs), {
        targets,
        threadId: "thread-1" as never,
      });

      assert.deepStrictEqual(
        result.pruned.map((entry) => [entry.cwd, entry.refs]),
        [
          ["/var/www/kanbandev", 2],
          ["/var/www/apidev", 1],
        ],
      );
      assert.deepStrictEqual(result.failed, []);
      assert.deepStrictEqual(
        (yield* Ref.get(store.calls))
          .filter((call) => call.op === "deleteCheckpointRefs")
          .map((call) => call.cwd),
        ["/var/www/kanbandev", "/var/www/apidev"],
      );
    }).pipe(Effect.runPromise));

  it("tolerates a repository that is gone and still prunes the rest", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      const vcs = yield* makeVcsProcess(
        undefined,
        {
          "/var/www/apidev": "refs/t3/checkpoints/dGhyZWFk/turn/0\n",
        },
        new Set(["/var/www/kanbandev"]),
      );

      const result = yield* pruneThreadRefsAcrossTargets(fanOut(store, vcs), {
        targets,
        threadId: "thread-1" as never,
      });

      assert.deepStrictEqual(
        result.pruned.map((entry) => entry.cwd),
        ["/var/www/apidev"],
      );
      assert.deepStrictEqual(
        result.failed.map((entry) => entry.cwd),
        ["/var/www/kanbandev"],
      );
    }).pipe(Effect.runPromise));

  it("asks for no deletion when a repository holds none of the thread's refs", () =>
    Effect.gen(function* () {
      const store = yield* makeStore();
      const vcs = yield* makeVcsProcess(undefined, {});

      yield* pruneThreadRefsAcrossTargets(fanOut(store, vcs), {
        targets,
        threadId: "thread-1" as never,
      });

      assert.deepStrictEqual(
        (yield* Ref.get(store.calls)).filter((call) => call.op === "deleteCheckpointRefs"),
        [],
      );
    }).pipe(Effect.runPromise));
});

describe("resolvePruneTargets", () => {
  it("sweeps every mounted repository, without needing the deleted thread's cwd", () => {
    assert.deepStrictEqual(resolvePruneTargets(undefined, available([kanban, api])), [
      { cwd: "/var/www/kanbandev", prefix: "" },
      { cwd: "/var/www/apidev", prefix: "" },
    ]);
  });

  it("falls back to the thread's own cwd off Zerops", () => {
    assert.deepStrictEqual(resolvePruneTargets("/home/me/repo", { _tag: "disabled" }), [
      { cwd: "/home/me/repo", prefix: "" },
    ]);
  });

  it("has nothing to sweep when neither a repository set nor a cwd survives", () => {
    assert.deepStrictEqual(resolvePruneTargets(undefined, { _tag: "disabled" }), []);
  });
});
