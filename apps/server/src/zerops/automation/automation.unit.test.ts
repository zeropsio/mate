import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerSettingsError, VcsProcessExitError, type ServerSettings } from "@t3tools/contracts";
import {
  defaultOpenCodeInstance,
  OPENCODE_KEY_PROVIDERS,
} from "@t3tools/shared/openCodeKeyProviders";
import type { LinkedMate } from "@t3tools/shared/mateLink";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as PlatformError from "effect/PlatformError";

import * as ServerConfig from "../../config.ts";
import * as ServerSettingsModule from "../../serverSettings.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { VcsProcess, type VcsProcessInput } from "../../vcs/VcsProcess.ts";
import * as ZeropsAutomationModule from "../ZeropsAutomation.ts";
import { ZeropsAutomation } from "../ZeropsAutomation.ts";
import { ZeropsRepositorySource } from "../ZeropsRepositorySource.ts";
import * as ZeropsTaskLedgerModule from "../ZeropsTaskLedger.ts";
import { ZeropsTaskLedger } from "../ZeropsTaskLedger.ts";
import * as ZeropsWorkingCopyModule from "../ZeropsWorkingCopy.ts";
import { ZeropsWorkingCopy } from "../ZeropsWorkingCopy.ts";

const nebius = OPENCODE_KEY_PROVIDERS[0]!;
// Built from parts: no scanner takes a fixture for a key.
const KEY = ["nb", "acme", "fixture", "0042"].join("-");
const keys = [{ env: nebius.variable, value: KEY }];

const mate = (automated: boolean | undefined): LinkedMate =>
  ({
    mateId: "mate-nova",
    name: "Nova",
    ...(automated === undefined ? {} : { automated }),
  }) as unknown as LinkedMate;

const nebiusKey = (settings: ServerSettings) =>
  defaultOpenCodeInstance(settings).environment?.find(
    (variable) => variable.name === nebius.variable,
  );

/** A server's automation, its state kept under `baseDir` (a new one each time by default). */
const withAutomation = <A, E>(
  body: Effect.Effect<A, E, ZeropsAutomation | ServerSettingsService>,
  settings: Layer.Layer<
    ServerSettingsService,
    ServerSettingsError
  > = ServerSettingsModule.layerTest(),
  baseDir: string | { readonly prefix: string } = { prefix: "automation-test-" },
) =>
  body.pipe(
    Effect.provide(
      ZeropsAutomationModule.layer.pipe(
        Layer.provideMerge(settings),
        Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

/** A directory that outlives one server: the same Mate, started again on it. */
const keptDirectory = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "automation-kept-" })),
  Effect.provide(NodeServices.layer),
);

/** One start of the Mate's automation on `directory`, `body` run on it. */
const restartOn =
  (directory: string) => (body: (automation: ZeropsAutomation["Service"]) => Effect.Effect<void>) =>
    withAutomation(
      Effect.gen(function* () {
        yield* body(yield* ZeropsAutomation);
      }),
      ServerSettingsModule.layerTest(),
      directory,
    );

/** A server's ledger, its state kept under `baseDir`. */
const withLedger = <A, E>(body: Effect.Effect<A, E, ZeropsTaskLedger>, baseDir: string) =>
  body.pipe(
    Effect.provide(
      ZeropsTaskLedgerModule.layer.pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

/** A dev service's working copy as git would answer about it. */
interface Copy {
  readonly host: string;
  /** The local branch HEAD is on (zcp's); none when detached. */
  branch: string | undefined;
  head: string;
  dirty: boolean;
  /** Files git does not track, nor ignores. */
  untracked?: boolean;
  /** It has no `origin`: a working copy of no repository on HQ's git. */
  noOrigin?: boolean;
  /** Commits of HEAD on no remote branch. */
  unpushed: number;
  /** The branches HQ's git holds for this repository, by name, at their commits. */
  readonly origin: Record<string, string>;
  /** The repository on HQ's git its `origin` names. */
  readonly repo: string;
  /** Its local branches besides HEAD's, by name, at their commits. */
  readonly local: Record<string, string>;
  /** Fetched so far: `refs/remotes/origin/<name>`. */
  readonly fetched: Record<string, string>;
  /** Git refuses this step (its first argument). */
  readonly failing?: string;
  /** The branch on HQ's git its local branch tracks; none when it tracks none. */
  upstream?: string;
  /** `lease`: the mount of a pool container a thread's agent leased, not a dev service's. */
  readonly kind?: "lease";
}

const copy = (host: string, given: Partial<Copy> = {}): Copy => ({
  host,
  branch: "mate/P_ROBOT",
  head: "aaa",
  dirty: false,
  unpushed: 0,
  origin: { main: "main1" },
  repo: host,
  local: {},
  fetched: {},
  ...given,
});

const ok = (stdout = "", exitCode = 0) =>
  Effect.succeed({
    exitCode: exitCode as never,
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  });

/** The service over `copies`, git answering as each says; every step run, as `host: args`. */
const rig = (copies: ReadonlyArray<Copy>) =>
  Effect.gen(function* () {
    const ran: Array<string> = [];
    const byPath = new Map(copies.map((each) => [`/var/www/${each.host}`, each]));
    const refuse = (input: VcsProcessInput) =>
      Effect.fail(
        new VcsProcessExitError({
          operation: input.operation,
          command: `git ${input.args[0] ?? ""}`,
          cwd: input.cwd,
          exitCode: 128,
          detail: "fatal: refused",
        }),
      );
    const vcs = Layer.mock(VcsProcess)({
      run: (input) =>
        Effect.suspend(() => {
          const at = byPath.get(input.cwd)!;
          const [step, ...rest] = input.command === "zcp" ? input.args.slice(2) : input.args;
          ran.push(`${at.host}: ${[step, ...rest].join(" ")}`);
          if (at.failing === step) return refuse(input);
          switch (step) {
            case "remote":
              return at.noOrigin === true
                ? ok("", 2)
                : ok(`https://hq.test/git/app-1/${encodeURIComponent(at.repo)}.git\n`);
            case "symbolic-ref":
              return at.branch === undefined ? refuse(input) : ok(`${at.branch}\n`);
            case "fetch": {
              const name = rest.at(-1)!.split(":")[0]!.replace("+refs/heads/", "");
              const commit = at.origin[name];
              if (commit === undefined) return refuse(input);
              at.fetched[`refs/remotes/origin/${name}`] = commit;
              return ok();
            }
            case "rev-parse": {
              const ref = rest.at(-1)!.replace("^{commit}", "");
              const commit =
                ref === "HEAD"
                  ? at.head
                  : (at.fetched[ref] ?? at.local[ref.replace("refs/heads/", "")]);
              return commit === undefined ? ok("", 1) : ok(`${commit}\n`);
            }
            case "status":
              return ok(
                (at.dirty ? " M a.txt\n" : "") +
                  (at.untracked === true && !rest.includes("--untracked-files=no")
                    ? "?? new.txt\n"
                    : ""),
              );
            case "stash":
              at.dirty = false;
              return ok();
            case "rev-list":
              return ok(`${String(at.unpushed)}\n`);
            case "branch":
              if (at.local[rest.at(-2)!] !== undefined) return refuse(input);
              at.local[rest.at(-2)!] = at.head;
              return ok();
            case "config":
              if (rest[0]?.endsWith(".merge") === true)
                at.upstream = rest[1]!.replace("refs/heads/", "");
              return ok();
            case "checkout":
              at.head = at.fetched[rest.at(-1)!]!;
              at.unpushed = 0;
              return ok();
            default:
              return ok();
          }
        }),
    });
    const source = Layer.mock(ZeropsRepositorySource)({
      list: Effect.succeed({
        _tag: "available",
        repositories: copies.map((each) => ({
          host: each.host,
          ...(each.kind === undefined ? {} : { kind: each.kind }),
          mountPath: `/var/www/${each.host}`,
          remotePath: "/var/www",
        })),
      }),
    });
    const built = yield* Layer.build(
      ZeropsWorkingCopyModule.layer.pipe(Layer.provide(Layer.mergeAll(vcs, source))),
    );
    return { workingCopy: Context.get(built, ZeropsWorkingCopy), ran };
  });

/** The steps that change a working copy: kept work, and where the branch went. */
const changing = (ran: ReadonlyArray<string>) =>
  ran.filter((step) => /: (stash|branch|checkout) /u.test(step));

// witness: apps/server/src/zerops/ZeropsAutomation.ts | const is = mate.automated === true; → const is = mate.automated !== false;
it.effect("AM1: A Mate is automated only once HQ says it is, and HQ's last word on it wins", () =>
  withAutomation(
    Effect.gen(function* () {
      const automation = yield* ZeropsAutomation;
      assert.isFalse(yield* automation.automated);
      yield* automation.heard(mate(true));
      assert.isTrue(yield* automation.automated);
      yield* automation.heard(mate(undefined));
      assert.isFalse(yield* automation.automated);
    }),
  ),
);

// witness: apps/server/src/zerops/ZeropsAutomation.ts | const automated = yield* Ref.make(kept?.automated === true); → const automated = yield* Ref.make(false);
it.effect(
  "AM2: An automated Mate starts automated again after a restart, before HQ speaks, and a Mate HQ last called ordinary starts ordinary",
  () =>
    Effect.gen(function* () {
      const restart = restartOn(yield* keptDirectory);
      yield* restart((automation) => automation.heard(mate(true)));
      yield* restart((automation) =>
        Effect.map(automation.automated, (automated) => assert.isTrue(automated)),
      );
      yield* restart((automation) => automation.heard(mate(false)));
      yield* restart((automation) =>
        Effect.map(automation.automated, (automated) => assert.isFalse(automated)),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsAutomation.ts | automatedModelOffer(kept?.model) === undefined ? undefined : kept?.model, → undefined,
it.effect(
  "AM3: An automated Mate's agents start on the organization's model once HQ hands it, again after a restart, and on the default once HQ names none",
  () =>
    Effect.gen(function* () {
      const restart = restartOn(yield* keptDirectory);
      const modelOf = (automation: ZeropsAutomation["Service"]) =>
        Effect.map(automation.modelSelection, (selection) => selection.model);
      const flash = "nebius/zai-org/GLM-5.3-Flash";
      yield* restart((automation) =>
        Effect.gen(function* () {
          yield* automation.heard(mate(true));
          assert.strictEqual(yield* modelOf(automation), "nebius/zai-org/GLM-5.3");
          yield* automation.keysHeard(keys, flash);
          assert.deepStrictEqual(yield* automation.modelSelection, {
            instanceId: ZeropsAutomationModule.AUTOMATED_MODEL_SELECTION.instanceId,
            model: flash,
          });
        }),
      );
      yield* restart((automation) =>
        Effect.map(modelOf(automation), (model) => assert.strictEqual(model, flash)),
      );
      yield* restart((automation) => automation.keysHeard(keys));
      yield* restart((automation) =>
        Effect.map(modelOf(automation), (model) =>
          assert.strictEqual(model, "nebius/zai-org/GLM-5.3"),
        ),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsAutomation.ts | const was = yield* Ref.getAndSet(picked, offered); → const was = yield* Ref.getAndSet(picked, offered ?? (model === undefined ? undefined : yield* Ref.get(picked)));
it.effect(
  "AM4: A model outside the offered list, of the same provider or another, is refused and the default runs",
  () =>
    Effect.gen(function* () {
      for (const model of ["nebius/moonshotai/Kimi-K2.7-Code", "anthropic/claude-opus-4"]) {
        yield* withAutomation(
          Effect.gen(function* () {
            const automation = yield* ZeropsAutomation;
            yield* automation.heard(mate(true));
            yield* automation.keysHeard(keys, "nebius/zai-org/GLM-5.3-Flash");
            yield* automation.keysHeard(keys, model);
            assert.strictEqual(
              (yield* automation.modelSelection).model,
              ZeropsAutomationModule.AUTOMATED_MODEL_SELECTION.model,
            );
          }),
        );
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsAutomation.ts | Effect.flatMap((is) => (is ? apply(keys) : Effect.void)), → Effect.flatMap(() => apply(keys)),
it.effect(
  "AM5: An automated Mate sets the organization's key on its default OpenCode as a secret variable and turns OpenCode on, and an ordinary Mate sets none",
  () =>
    Effect.gen(function* () {
      yield* withAutomation(
        Effect.gen(function* () {
          const automation = yield* ZeropsAutomation;
          yield* automation.heard(mate(true));
          yield* automation.keysHeard(keys);
          const settings = yield* (yield* ServerSettingsService).getSettings;
          assert.deepStrictEqual(nebiusKey(settings), {
            name: nebius.variable,
            value: KEY,
            sensitive: true,
          });
          assert.isTrue(defaultOpenCodeInstance(settings).enabled);
          assert.isTrue(yield* automation.keySet);
        }),
      );
      yield* withAutomation(
        Effect.gen(function* () {
          const automation = yield* ZeropsAutomation;
          yield* automation.heard(mate(false));
          yield* automation.keysHeard(keys);
          assert.isUndefined(nebiusKey(yield* (yield* ServerSettingsService).getSettings));
          assert.isFalse(yield* automation.keySet);
        }),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsAutomation.ts | Effect.andThen(Ref.set(heldKeys, keys)), → Effect.andThen(Effect.void),
it.effect("AM6: Keys heard before HQ says the Mate is automated are set once it does", () =>
  withAutomation(
    Effect.gen(function* () {
      const automation = yield* ZeropsAutomation;
      yield* automation.keysHeard(keys);
      assert.isFalse(yield* automation.keySet);
      yield* automation.heard(mate(true));
      assert.isTrue(yield* automation.keySet);
    }),
  ),
);

// witness: apps/server/src/zerops/ZeropsAutomation.ts | if (value === "") { → if (value === "" && keys.length > 0) {
it.effect("AM7: An empty key list clears the key the Mate set", () =>
  withAutomation(
    Effect.gen(function* () {
      const automation = yield* ZeropsAutomation;
      yield* automation.heard(mate(true));
      yield* automation.keysHeard(keys);
      yield* automation.keysHeard([]);
      assert.isUndefined(nebiusKey(yield* (yield* ServerSettingsService).getSettings));
      assert.isFalse(yield* automation.keySet);
    }),
  ),
);

// witness: apps/server/src/zerops/ZeropsAutomation.ts | } else if (openCodeKeyValue(next, provider) !== value || next.enabled !== true) { → } else {
it.effect(
  "AM8: The same key told again, or HQ's same word again, writes the settings no second time",
  () => {
    let writes = 0;
    const counting = Layer.effect(
      ServerSettingsService,
      Effect.gen(function* () {
        const inner = yield* ServerSettingsService;
        return ServerSettingsService.of({
          ...inner,
          updateSettings: (patch) =>
            Effect.sync(() => void writes++).pipe(Effect.andThen(inner.updateSettings(patch))),
        });
      }),
    ).pipe(Layer.provide(ServerSettingsModule.layerTest()));
    return withAutomation(
      Effect.gen(function* () {
        const automation = yield* ZeropsAutomation;
        yield* automation.heard(mate(true));
        yield* automation.keysHeard(keys);
        yield* automation.keysHeard(keys);
        yield* automation.heard(mate(true));
        assert.strictEqual(writes, 1);
      }),
      counting,
    );
  },
);

// witness: apps/server/src/zerops/ZeropsAutomation.ts | operation: error.operation, → operation: String(error.cause),
it.effect("AM9: A key the Mate could not set never reaches a log line", () => {
  const lines: string[] = [];
  const logger = Logger.make(({ message, cause }) => {
    lines.push(`${JSON.stringify(message)} ${Cause.pretty(cause)}`);
  });
  const failing = Layer.effect(
    ServerSettingsService,
    Effect.gen(function* () {
      const inner = yield* ServerSettingsService;
      return ServerSettingsService.of({
        ...inner,
        updateSettings: (patch) =>
          Effect.fail(
            new ServerSettingsError({
              settingsPath: "/tmp/settings.json",
              operation: "write-secret",
              cause: new Error(JSON.stringify(patch)),
            }),
          ),
      });
    }),
  ).pipe(Layer.provide(ServerSettingsModule.layerTest()));
  return withAutomation(
    Effect.gen(function* () {
      const automation = yield* ZeropsAutomation;
      yield* automation.heard(mate(true));
      yield* automation.keysHeard(keys);
      assert.isFalse(yield* automation.keySet);
      assert.isAbove(lines.length, 0);
      assert.isFalse(lines.some((line) => line.includes(KEY)));
    }),
    failing,
  ).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
});

// witness: apps/server/src/zerops/ZeropsTaskLedger.ts | ).pipe(Effect.andThen(fs.rename(temp, file))); → );
it.effect("AM10: A task's stop, limits, spending and turns outlive the Mate's restart", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "task-ledger-" });
    yield* withLedger(
      Effect.gen(function* () {
        const ledger = yield* ZeropsTaskLedger;
        yield* ledger.update("task-1", (entry) => ({
          ...entry,
          limits: { minutes: 30, costUsd: 5 },
          runMs: { "task-task-1/r/1": 120_000 },
          costNano: "2500000000",
          turns: ["ses_1/turn-1"],
        }));
        yield* ledger.update("task-1", (entry) => ({
          ...entry,
          stopped: "The issue was closed.",
        }));
      }),
      baseDir,
    );
    const kept = yield* withLedger(
      Effect.gen(function* () {
        return yield* (yield* ZeropsTaskLedger).entry("task-1");
      }),
      baseDir,
    );
    assert.deepStrictEqual(kept, {
      limits: { minutes: 30, costUsd: 5 },
      runMs: { "task-task-1/r/1": 120_000 },
      costNano: "2500000000",
      turns: ["ses_1/turn-1"],
      stopped: "The issue was closed.",
    });
  }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsTaskLedger.ts | const next = yield* fs.open(temp, { flag: "w" }); → const next = yield* fs.open(file, { flag: "w" });
it.effect(
  "AM11: A ledger write the Mate could not finish leaves the last whole ledger, never a half-written one",
  () =>
    Effect.gen(function* () {
      const real = yield* FileSystem.FileSystem;
      const baseDir = yield* real.makeTempDirectoryScoped({ prefix: "task-ledger-" });
      const crash = { now: false };
      // A disk that dies halfway through a write: half the words land, then the write fails.
      const died = (path: string) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            module: "FileSystem",
            method: "write",
            pathOrDescriptor: path,
          }),
        );
      const dying = Layer.succeed(FileSystem.FileSystem, {
        ...real,
        writeFileString: (path, data, options) =>
          crash.now
            ? real
                .writeFileString(path, data.slice(0, Math.floor(data.length / 2)), options)
                .pipe(Effect.andThen(died(path)))
            : real.writeFileString(path, data, options),
        open: (path, options) =>
          Effect.map(real.open(path, options), (file) => {
            const writeAll = (buffer: Uint8Array) =>
              crash.now
                ? file
                    .writeAll(buffer.subarray(0, Math.floor(buffer.length / 2)))
                    .pipe(Effect.andThen(died(path)))
                : file.writeAll(buffer);
            return new Proxy(file, {
              get: (target, key) => (key === "writeAll" ? writeAll : Reflect.get(target, key)),
            });
          }),
      });
      yield* Effect.gen(function* () {
        const ledger = yield* ZeropsTaskLedger;
        yield* ledger.update("task-1", (entry) => ({ ...entry, stopped: "The issue was closed." }));
        crash.now = true;
        yield* ledger.update("task-2", (entry) => ({ ...entry, costNano: "1000000000" }));
      }).pipe(
        Effect.provide(
          ZeropsTaskLedgerModule.layer.pipe(
            Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
            Layer.provide(dying),
            Layer.provide(NodeServices.layer),
          ),
        ),
      );
      const kept = yield* withLedger(
        Effect.gen(function* () {
          return yield* (yield* ZeropsTaskLedger).entry("task-1");
        }),
        baseDir,
      );
      assert.strictEqual(kept?.stopped, "The issue was closed.");
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsWorkingCopy.ts | const kept = `mate-kept/${shortOf(held ?? "work")}-${head.slice(0, 7)}`; → const kept = `mate-kept/${shortOf(taskId)}-${head.slice(0, 7)}`;
it.effect(
  "AM12: A new task moves a working copy to main, first stashing its uncommitted work and keeping its unpushed commits on a `mate-kept/` branch named after the task the copy held and its commit",
  () =>
    Effect.gen(function* () {
      const appdev = copy("appdev", { dirty: true, unpushed: 2 });
      const { workingCopy, ran } = yield* rig([appdev]);
      const held = yield* workingCopy.hold("task-2abcdef9", { kind: "main" }, "task-1abcdef9");
      assert.deepStrictEqual(held, { missed: [], unlisted: false });
      assert.deepStrictEqual(changing(ran), [
        "appdev: stash push -u -m mate: kept before task task-2abcdef9",
        "appdev: branch mate-kept/task-1ab-aaa HEAD",
        "appdev: checkout -q --no-track -B mate/P_ROBOT refs/remotes/origin/main",
      ]);
      assert.strictEqual(appdev.head, "main1");
    }),
);

// witness: apps/server/src/zerops/ZeropsWorkingCopy.ts | repoOfOrigin(origin.stdout) === base.repo; → origin.stdout !== "";
it.effect(
  "AM13: A follow-up starts on its own change's branch only in the repository that holds that change, and on main in every other",
  () =>
    Effect.gen(function* () {
      // Numbers are per repository: apidev's git holds a #3 of its own, another task's.
      const appdev = copy("appdev", { origin: { main: "main1", "mate/P_ROBOT/3": "change3" } });
      const apidev = copy("apidev", {
        head: "bbb",
        origin: { main: "main1", "mate/P_ROBOT/3": "other3" },
      });
      const { workingCopy, ran } = yield* rig([appdev, apidev]);
      yield* workingCopy.hold("task-1", {
        kind: "change",
        repo: "appdev",
        branch: "mate/P_ROBOT/3",
      });
      assert.deepStrictEqual(changing(ran).toSorted(), [
        "apidev: checkout -q --no-track -B mate/P_ROBOT refs/remotes/origin/main",
        "appdev: checkout -q --no-track -B mate/P_ROBOT refs/remotes/origin/mate/P_ROBOT/3",
      ]);
      assert.strictEqual(appdev.head, "change3");
      assert.strictEqual(apidev.head, "main1");
    }),
);

// witness: apps/server/src/zerops/ZeropsWorkingCopy.ts | const kept = `mate-kept/${shortOf(held ?? "work")}-${head.slice(0, 7)}`; → const kept = `mate-kept/${shortOf(held ?? "work")}`;
it.effect(
  "AM14: Commits kept again after more work get a branch of their own, and a kept branch is never written over",
  () =>
    Effect.gen(function* () {
      const appdev = copy("appdev", { unpushed: 1 });
      const { workingCopy, ran } = yield* rig([appdev]);
      yield* workingCopy.hold("task-2", { kind: "main" }, "task-1");
      // Worked on again before the next move, the same task coming to it once more.
      appdev.head = "ccc";
      appdev.unpushed = 1;
      yield* workingCopy.hold("task-2", { kind: "main" }, "task-1");
      assert.deepStrictEqual(appdev.local, {
        "mate-kept/task-1-aaa": "aaa",
        "mate-kept/task-1-ccc": "ccc",
      });
      assert.isFalse(ran.some((step) => step.includes("branch -f")));
    }),
);

// witness: apps/server/src/zerops/ZeropsWorkingCopy.ts | git(["config", `branch.${branch}.merge`, `refs/heads/${ref}`]), → git(["config", `branch.${branch}.merge`, `refs/heads/${MAIN}`]),
it.effect(
  "AM15: A task's working copy tracks the base it starts from, never the change an earlier task pushed",
  () =>
    Effect.gen(function* () {
      for (const [given, base, tracks] of [
        [copy("appdev"), { kind: "main" }, "main"],
        [copy("appdev", { head: "main1" }), { kind: "main" }, "main"],
        [
          copy("appdev", { origin: { main: "main1", "mate/P_ROBOT/3": "change3" } }),
          { kind: "change", repo: "appdev", branch: "mate/P_ROBOT/3" },
          "mate/P_ROBOT/3",
        ],
      ] as const) {
        // zcp's `push -u` left it tracking the change an earlier task delivered to.
        const appdev = { ...given, upstream: "mate/P_ROBOT/11" };
        const { workingCopy } = yield* rig([appdev]);
        yield* workingCopy.hold("task-2", base);
        assert.strictEqual(appdev.upstream, tracks);
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsWorkingCopy.ts | repositories.filter((repository) => !isLeaseRepository(repository)); → [...repositories];
it.effect(
  "AM16: A pool container a thread's agent leased is never put on a task's base nor named as holding undelivered work",
  () =>
    Effect.gen(function* () {
      const webpool = copy("webpool-3", { kind: "lease", dirty: true, unpushed: 1 });
      const { workingCopy, ran } = yield* rig([copy("appdev"), webpool]);
      const held = yield* workingCopy.hold("task-2", { kind: "main" });
      assert.deepStrictEqual(held, { missed: [], unlisted: false });
      assert.isFalse(ran.some((step) => step.startsWith("webpool-3:")));
      assert.deepStrictEqual([webpool.head, webpool.dirty], ["aaa", true]);

      const leased = yield* rig([
        copy("appdev", { dirty: true }),
        copy("webpool-3", { kind: "lease", dirty: true, unpushed: 2 }),
      ]);
      assert.deepStrictEqual(yield* leased.workingCopy.undelivered(true), ["appdev"]);
      assert.isFalse(leased.ran.some((step) => step.startsWith("webpool-3:")));
    }),
);

// witness: apps/server/src/zerops/ZeropsWorkingCopy.ts | return { missed: missed.filter((host) => host !== undefined), unlisted: false }; → return { missed: [], unlisted: false };
it.effect(
  "AM17: A failing git step leaves its working copy as it was and names it, while the other working copies move on",
  () =>
    Effect.gen(function* () {
      for (const [failing, tried] of [
        ["fetch", []],
        ["stash", ["stash push -u -m mate: kept before task task-2"]],
        ["symbolic-ref", []],
      ] as const) {
        const appdev = copy("appdev", { dirty: true, failing });
        const apidev = copy("apidev");
        const { workingCopy, ran } = yield* rig([appdev, apidev]);
        const held = yield* workingCopy.hold("task-2", { kind: "main" });
        assert.deepStrictEqual(held, { missed: ["appdev"], unlisted: false });
        assert.deepStrictEqual(
          changing(ran).filter((step) => step.startsWith("appdev")),
          tried.map((step) => `appdev: ${step}`),
        );
        assert.strictEqual(appdev.head, "aaa");
        assert.strictEqual(apidev.head, "main1");
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsWorkingCopy.ts | if ((yield* git(["remote", "get-url", "origin"])) === undefined) return false; → if ((yield* git(["remote", "get-url", "origin"])) === "") return false;
it.effect(
  "AM18: The working copies holding undelivered work (uncommitted files, or commits on no remote branch) are named by a read that changes nothing, never one of no repository on HQ's git, and new files count only where the task's work started clean",
  () =>
    Effect.gen(function* () {
      const { workingCopy, ran } = yield* rig([
        copy("appdev", { dirty: true }),
        copy("apidev", { unpushed: 2 }),
        copy("webdev"),
        copy("docsdev", { failing: "status" }),
        // A working copy of no repository on HQ's git delivers nowhere: never named.
        copy("scratchdev", { dirty: true, noOrigin: true }),
      ]);
      assert.deepStrictEqual((yield* workingCopy.undelivered(true)).toSorted(), [
        "apidev",
        "appdev",
      ]);
      // Read only: nothing kept, fetched or moved.
      assert.deepStrictEqual(changing(ran), []);
      assert.isFalse(ran.some((step) => step.includes(": fetch ")));

      const untracked = yield* rig([copy("appdev", { untracked: true })]);
      assert.deepStrictEqual(yield* untracked.workingCopy.undelivered(true), ["appdev"]);
      assert.deepStrictEqual(yield* untracked.workingCopy.undelivered(false), []);
    }),
);
