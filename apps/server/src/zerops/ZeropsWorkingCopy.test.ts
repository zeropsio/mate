import { assert, describe, it } from "@effect/vitest";
import { VcsProcessExitError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { VcsProcess, type VcsProcessInput } from "../vcs/VcsProcess.ts";
import { ZeropsRepositorySource } from "./ZeropsRepositorySource.ts";
import * as ZeropsWorkingCopyModule from "./ZeropsWorkingCopy.ts";
import { ZeropsWorkingCopy } from "./ZeropsWorkingCopy.ts";

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
          const [step, ...rest] = input.args;
          ran.push(`${at.host}: ${input.args.join(" ")}`);
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

describe("an automated Mate's working copies hold the task it works", () => {
  it.effect("a new task starts on a working copy at main, its earlier work kept", () =>
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

  it.effect(
    "a follow-up starts on its own change's branch, where its repository holds it, and on main elsewhere",
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

  it.effect("kept commits keep their branch when the working copies move again", () =>
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

  it.effect.each([
    ["a new task on a moved working copy", copy("appdev"), { kind: "main" }, "main"],
    [
      "a new task on a working copy at main",
      copy("appdev", { head: "main1" }),
      { kind: "main" },
      "main",
    ],
    [
      "a follow-up",
      copy("appdev", { origin: { main: "main1", "mate/P_ROBOT/3": "change3" } }),
      { kind: "change", repo: "appdev", branch: "mate/P_ROBOT/3" },
      "mate/P_ROBOT/3",
    ],
  ] as const)(
    "a task's working copy tracks the base it starts from, never the change an earlier task pushed (%s)",
    ([, given, base, tracks]) =>
      Effect.gen(function* () {
        // zcp's `push -u` left it tracking the change an earlier task delivered to.
        const appdev = { ...given, upstream: "mate/P_ROBOT/11" };
        const { workingCopy } = yield* rig([appdev]);
        yield* workingCopy.hold("task-2", base);
        assert.strictEqual(appdev.upstream, tracks);
      }),
  );

  it.effect("a pool container a thread's agent leased is never put on a task's base", () =>
    Effect.gen(function* () {
      const webpool = copy("webpool-3", { kind: "lease", dirty: true, unpushed: 1 });
      const { workingCopy, ran } = yield* rig([copy("appdev"), webpool]);
      const held = yield* workingCopy.hold("task-2", { kind: "main" });
      assert.deepStrictEqual(held, { missed: [], unlisted: false });
      assert.isFalse(ran.some((step) => step.startsWith("webpool-3:")));
      assert.deepStrictEqual([webpool.head, webpool.dirty], ["aaa", true]);
    }),
  );

  it.effect("a clean working copy already at its base is left alone", () =>
    Effect.gen(function* () {
      const { workingCopy, ran } = yield* rig([copy("appdev", { head: "main1" })]);
      yield* workingCopy.hold("task-2", { kind: "main" });
      assert.deepStrictEqual(changing(ran), []);
    }),
  );

  it.effect.each([
    ["the fetch", "fetch", []],
    ["the stash", "stash", ["stash push -u -m mate: kept before task task-2"]],
    ["a detached HEAD", "symbolic-ref", []],
  ] as const)(
    "a failing git step (%s) leaves its working copy as it was, named, and the others move on",
    ([, failing, tried]) =>
      Effect.gen(function* () {
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
      }),
  );

  it.effect("working copies the Mate cannot list are said unreached, and none is touched", () =>
    Effect.gen(function* () {
      const ran: Array<VcsProcessInput> = [];
      const vcs = Layer.mock(VcsProcess)({
        run: (input) => Effect.suspend(() => (ran.push(input), ok())),
      });
      const source = Layer.mock(ZeropsRepositorySource)({
        list: Effect.succeed({ _tag: "unavailable", reason: "mount table unreadable" }),
      });
      const built = yield* Layer.build(
        ZeropsWorkingCopyModule.layer.pipe(Layer.provide(Layer.mergeAll(vcs, source))),
      );
      const held = yield* Context.get(built, ZeropsWorkingCopy).hold("task-2", { kind: "main" });
      assert.deepStrictEqual(held, { missed: [], unlisted: true });
      assert.deepStrictEqual(ran, []);
    }),
  );

  it.effect(
    "the working copies holding work never delivered are named: uncommitted files, or commits on no remote branch",
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
      }),
  );

  it.effect("a leased pool container's work is its thread's, never named undelivered", () =>
    Effect.gen(function* () {
      const { workingCopy, ran } = yield* rig([
        copy("appdev", { dirty: true }),
        copy("webpool-3", { kind: "lease", dirty: true, unpushed: 2 }),
      ]);
      assert.deepStrictEqual(yield* workingCopy.undelivered(true), ["appdev"]);
      assert.isFalse(ran.some((step) => step.startsWith("webpool-3:")));
    }),
  );

  it.effect(
    "new files count as undelivered only on working copies the task's work started clean",
    () =>
      Effect.gen(function* () {
        const { workingCopy } = yield* rig([copy("appdev", { untracked: true })]);
        assert.deepStrictEqual(yield* workingCopy.undelivered(true), ["appdev"]);
        assert.deepStrictEqual(yield* workingCopy.undelivered(false), []);
      }),
  );
});
