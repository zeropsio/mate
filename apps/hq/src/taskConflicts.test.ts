// @effect-diagnostics nodeBuiltinImport:off -- the robot's work reaches HQ as a Mate's does: over git.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { MateTask, MateTaskMessage } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { automatedPool } from "../test/harness/automated.ts";
import { gitClient } from "../test/harness/gitClient.ts";
import { remoteOf, rowsWhere } from "../test/harness/mates.ts";
import type { SocketMessage } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { TASK_CHANGES_SINCE } from "@t3tools/shared/hqIntake";

type Core = Effect.Success<ReturnType<typeof automatedPool>>;

/** The robot's link, its repository `appdev` made, and its checkout of it. */
const poolWithRepo = Effect.gen(function* () {
  const core = yield* automatedPool({ version: TASK_CHANGES_SINCE });
  yield* core.call("POST", "/api/mate/repos", {
    headers: core.robot.auth,
    body: { name: "appdev" },
  });
  const git = yield* gitClient;
  yield* git.checked([
    "clone",
    remoteOf(core.origin, core.robot.credential, core.appId, "appdev"),
    "robot",
  ]);
  const work = NodePath.join(git.dir, "robot");
  /**
   * The robot's work on its change `number`, from `main` as HQ holds it or from the change's own
   * branch: `files` written, committed and pushed to the change; its head once HQ recorded it.
   */
  const push = (number: number, files: Record<string, string>, from: "main" | "change" = "main") =>
    Effect.gen(function* () {
      const branch = `mate/P_ROBOT/${String(number)}`;
      yield* git.checked(["fetch", "-q", "origin"], work);
      yield* git.checked(
        ["checkout", "-q", "-B", "work", from === "main" ? "origin/main" : `origin/${branch}`],
        work,
      );
      for (const [file, content] of Object.entries(files))
        NodeFS.writeFileSync(NodePath.join(work, file), content);
      yield* git.checked(["add", "-A"], work);
      yield* git.checked(["commit", "-q", "-m", `Work on #${String(number)}`], work);
      yield* git.checked(["push", "-q", "origin", `HEAD:refs/heads/${branch}`], work);
      const head = yield* git.checked(["rev-parse", "HEAD"], work);
      yield* rowsWhere(
        core.url,
        `SELECT head FROM hq_change WHERE repo = 'appdev' AND number = ${String(number)}`,
        (rows) => rows[0]?.["head"] === head,
      );
      return head;
    });
  return { core, push };
});

/** The task of issue `number`, told to the robot and taken, its change opened as `title`. */
const taskWithChange = (core: Core, number: number, title: string) =>
  Effect.gen(function* () {
    yield* core.issue(number);
    const told = yield* core.robot.link.takeWhere(
      `the task of issue ${String(number)}`,
      (frame: SocketMessage) => {
        const task = frame["task"] as MateTask | undefined;
        return (
          frame.type === "task" &&
          task?.source.kind === "github-issue" &&
          task.source.number === number
        );
      },
    );
    const id = (told["task"] as MateTask).id;
    const word = (report: Record<string, unknown>) =>
      core.robot.link.send({ type: "task-state", report: { taskId: id, ...report } });
    yield* word({ state: "accepted", conversationId: "conversation-1" });
    yield* core.tasks((rows) =>
      rows.some((row) => row["number"] === number && row["state"] === "working"),
    );
    const opened = yield* core.call("POST", "/api/mate/changes", {
      headers: core.robot.auth,
      body: { repo: "appdev", title },
    });
    const change = (opened.body as { readonly change: { readonly number: number } }).change.number;
    /** The robot is done with it: its change waits for review. */
    const done = Effect.andThen(
      word({ state: "done" }),
      core.tasks((rows) => rows.some((row) => row["number"] === number && row["state"] === "done")),
    );
    return { id, change, done };
  });

/** The owner merges the change `number` at `head`. */
const merge = (core: Core, number: number, head: string) =>
  Effect.map(
    core.call("POST", `/api/apps/${core.appId}/changes/appdev/${String(number)}/merge`, {
      session: core.owner,
      body: { expectedHead: head },
    }),
    (answer) => assert.strictEqual(answer.status, 200),
  );

/** What was said of the task `taskId`, oldest first. */
const saidOf = (core: Core, taskId: string, count: number) =>
  rowsWhere(
    core.url,
    `SELECT id, source, author, text FROM hq_task_message WHERE task_id::text = '${taskId}' ORDER BY seq`,
    (rows) => rows.length === count,
  );

/** The next follow-up told to the robot. */
const toldMessage = (core: Core) =>
  Effect.map(core.robot.link.take("task-message"), (frame) => ({
    taskId: frame["taskId"] as string,
    message: frame["message"] as MateTaskMessage,
  }));

describe("a task's change when main moves", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a task's open change that no longer merges after another lands is handed back to its Mate with the conflicting files",
      () =>
        Effect.gen(function* () {
          const { core, push } = yield* poolWithRepo;
          const first = yield* taskWithChange(core, 1, "Hotter tea");
          yield* push(first.change, { "kettle.js": "hot\n", "README.md": "tea\n" });
          yield* first.done;
          const second = yield* taskWithChange(core, 2, "Cooler cups");
          const landing = yield* push(second.change, { "kettle.js": "cold\n" });
          yield* second.done;
          yield* merge(core, second.change, landing);
          const told = yield* toldMessage(core);
          assert.strictEqual(told.taskId, first.id);
          assert.strictEqual(told.message.from, "review");
          assert.strictEqual(told.message.author, "HQ");
          assert.include(told.message.text, `Cooler cups (#${String(second.change)})`);
          assert.include(told.message.text, "conflicts in kettle.js)");
          assert.notInclude(told.message.text, "README.md");
          assert.include(
            told.message.text,
            "Fetch origin, merge origin/main into your change (never rebase)",
          );
          // Its record says so too, until it is delivered again.
          yield* rowsWhere(
            core.url,
            `SELECT mergeability FROM hq_change WHERE number = ${String(first.change)}`,
            (rows) => rows[0]?.["mergeability"] === "conflict",
          );
        }),
    );

    it.effect("a change that still merges cleanly after another lands gets no message", () =>
      Effect.gen(function* () {
        const { core, push } = yield* poolWithRepo;
        const first = yield* taskWithChange(core, 1, "Hotter tea");
        yield* push(first.change, { "kettle.js": "hot\n" });
        yield* first.done;
        const second = yield* taskWithChange(core, 2, "Cooler cups");
        const clean = yield* push(second.change, { "cups.css": "cold\n" });
        yield* second.done;
        const third = yield* taskWithChange(core, 3, "Warm kettle");
        const conflicting = yield* push(third.change, { "kettle.js": "warm\n" });
        yield* third.done;
        yield* merge(core, second.change, clean);
        yield* merge(core, third.change, conflicting);
        // Main moved twice; the first move left the first change merging cleanly.
        const said = yield* saidOf(core, first.id, 1);
        assert.include(said[0]!["text"] as string, `Warm kettle (#${String(third.change)})`);
      }),
    );

    it.effect(
      "the same conflict is told once, and again only after its Mate delivered and main conflicts anew",
      () =>
        Effect.gen(function* () {
          const { core, push } = yield* poolWithRepo;
          const first = yield* taskWithChange(core, 1, "Hotter tea");
          yield* push(first.change, { "kettle.js": "hot\n" });
          yield* first.done;
          const landings = [];
          for (const [number, title, files] of [
            [2, "Cooler cups", { "kettle.js": "cold\n" }],
            [3, "Bigger pot", { "pot.js": "big\n" }],
            [4, "Lid on", { "lid.js": "lid\n" }],
            [5, "Smaller pot", { "pot.js": "small\n" }],
          ] as const) {
            const task = yield* taskWithChange(core, number, title);
            landings.push({
              id: task.id,
              change: task.change,
              head: yield* push(task.change, files),
            });
            yield* task.done;
          }
          const [cooler, bigger, lid, smaller] = landings;
          yield* merge(core, cooler!.change, cooler!.head);
          yield* saidOf(core, first.id, 1);
          // Still conflicting at the head it was told at: nothing more to say.
          yield* merge(core, bigger!.change, bigger!.head);
          // That move's look at every task's change is through once another it made conflict is
          // told: the first change was judged at the head it was told at, before it moves.
          yield* saidOf(core, smaller!.id, 1);
          // Its Mate delivers again, its conflict not resolved; the next landing conflicts anew.
          yield* push(first.change, { "lid.js": "glass\n" }, "change");
          yield* merge(core, lid!.change, lid!.head);
          const said = yield* saidOf(core, first.id, 2);
          assert.include(said[0]!["text"] as string, `(#${String(cooler!.change)})`);
          assert.include(said[1]!["text"] as string, `(#${String(lid!.change)})`);
          assert.include(said[1]!["text"] as string, "conflicts in kettle.js, lid.js)");
        }),
    );

    it.effect("a conflict on a change whose Mate works another task waits for it", () =>
      Effect.gen(function* () {
        const { core, push } = yield* poolWithRepo;
        const first = yield* taskWithChange(core, 1, "Hotter tea");
        yield* push(first.change, { "kettle.js": "hot\n" });
        yield* first.done;
        const second = yield* taskWithChange(core, 2, "Cooler cups");
        const landing = yield* push(second.change, { "kettle.js": "cold\n" });
        yield* second.done;
        const third = yield* taskWithChange(core, 3, "Bigger pot");
        yield* merge(core, second.change, landing);
        yield* saidOf(core, first.id, 1);
        // On the third task: the first's conflict waits.
        assert.isFalse(
          (yield* core.robot.link.collected).some((frame) => frame.type === "task-message"),
        );
        yield* third.done;
        const told = yield* toldMessage(core);
        assert.strictEqual(told.taskId, first.id);
        assert.include(told.message.text, "conflicts in kettle.js)");
      }),
    );
  });
});
