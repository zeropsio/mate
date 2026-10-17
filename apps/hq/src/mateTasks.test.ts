import { assert, describe, it } from "@effect/vitest";
import type { MateTask } from "@t3tools/contracts";
import type { HqNavigationApp, HqNavigationProject } from "@t3tools/shared/hqStream";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import {
  attention,
  connectedRepo,
  deliver,
  intakeOn,
  issueEvent,
  linkOf,
  mateLinked,
} from "../test/harness/automated.ts";
import { githubFake } from "../test/harness/githubFake.ts";
import { addProject, rowsWhere } from "../test/harness/mates.ts";
import type { SocketMessage } from "../test/harness/runningCore.ts";
import { sessionFor, startCore, ticketFor, untilHealth } from "../test/harness/runningCore.ts";
import { nextScopeValue, scopeReset } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { UNTAKEN } from "./mateTasks.ts";

const NAV = { kind: "navigation" } as const;

/**
 * A Core whose application `Tea Shop` takes `acme/tea-shop`'s issues labelled `mate`, with its
 * automated Mate `P_ROBOT` linked and resting.
 */
const withPool = (
  given: { readonly taskAcceptWithin?: Duration.Duration; readonly busy?: boolean } = {},
) =>
  Effect.gen(function* () {
    const github = yield* githubFake;
    const core = yield* startCore(true, {
      githubApi: github.url,
      ...(given.taskAcceptWithin === undefined
        ? {}
        : { taskAcceptWithin: given.taskAcceptWithin, taskSweepEvery: Duration.millis(50) }),
    });
    yield* untilHealth(core.call, "active");
    const owner = yield* sessionFor(core.call, "door-owner");
    const app = yield* core.call("POST", "/api/apps", {
      session: owner,
      body: { name: "Tea Shop" },
    });
    const appId = (app.body as { readonly id: string }).id;
    yield* connectedRepo(core, appId, "web", "acme/tea-shop");
    const hook = yield* intakeOn(core, github, owner, appId);
    addProject(core.fake, "P_ROBOT");
    const robot = yield* mateLinked(core, owner, "P_ROBOT", { appId });
    yield* robot.link.send(attention(given.busy === true ? 1 : 0));
    const issue = (number: number) =>
      deliver(core, hook, "issues", issueEvent("opened", { number, labels: ["mate"] }));
    const tasks = (matches: (rows: ReadonlyArray<Record<string, unknown>>) => boolean) =>
      rowsWhere(
        core.url,
        "SELECT id::text AS id, number, state, mate_project_id, attempts, detail, conversation_id FROM hq_task ORDER BY seq",
        matches,
      );
    return { ...core, github, owner, appId, robot, issue, tasks };
  });

type Link = Effect.Success<ReturnType<typeof withPool>>["robot"]["link"];

/** The next task the link is told, of issue `number`. */
const toldTask = (link: Link, number: number) =>
  Effect.map(
    link.takeWhere(
      `the task of issue ${String(number)}`,
      (frame: SocketMessage) =>
        frame.type === "task" && (frame["task"] as MateTask).source.number === number,
    ),
    (frame) => frame["task"] as MateTask,
  );

describe("tasks for automated Mates", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "the oldest waiting task goes to a free automated Mate of the application, one task per Mate; an ordinary Mate gets none",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          const ordinary = yield* mateLinked(core, core.owner, "P_MATE", {
            appId: core.appId,
            automated: false,
          });
          yield* ordinary.link.send(attention(0));
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          yield* core.issue(1);
          yield* core.issue(2);
          const task = yield* toldTask(core.robot.link, 1);
          assert.deepStrictEqual(task.source, {
            kind: "github-issue",
            repo: "acme/tea-shop",
            number: 1,
            url: "https://github.com/acme/tea-shop/issues/1",
            title: "Issue 1",
            author: "nova",
          });
          assert.strictEqual(task.body, "Make the tea hotter.");
          const rows = yield* core.tasks((found) => found.length === 2);
          assert.deepStrictEqual(
            rows.map((row) => [row["number"], row["state"], row["mate_project_id"]]),
            [
              [1, "assigned", "P_ROBOT"],
              [2, "queued", null],
            ],
          );
          const row = yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task != null,
          );
          assert.deepStrictEqual(row.mate?.task, {
            id: task.id,
            repo: "acme/tea-shop",
            number: 1,
            title: "Issue 1",
            url: "https://github.com/acme/tea-shop/issues/1",
          });
          const app = yield* nextScopeValue<HqNavigationApp>(
            watching,
            NAV,
            `app:${core.appId}`,
            (value) => value.intake?.waiting === 1,
          );
          assert.strictEqual(app.intake?.waiting, 1);
          assert.isFalse((yield* ordinary.link.collected).some((frame) => frame.type === "task"));
          yield* watching.close;
        }),
    );

    it.effect("a Mate whose agents are working gets a task only once they rest", () =>
      Effect.gen(function* () {
        const core = yield* withPool({ busy: true });
        yield* core.issue(1);
        yield* core.tasks((rows) => rows.length === 1 && rows[0]!["state"] === "queued");
        assert.isFalse((yield* core.robot.link.collected).some((frame) => frame.type === "task"));
        yield* core.robot.link.send(attention(0));
        yield* toldTask(core.robot.link, 1);
      }),
    );

    it.effect(
      "a task the Mate does not take in time is handed again, and fails after the third try, saying why",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool({ taskAcceptWithin: Duration.millis(200) });
          yield* core.issue(1);
          for (let attempt = 0; attempt < 3; attempt += 1) yield* toldTask(core.robot.link, 1);
          const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "failed");
          assert.deepInclude(row, { attempts: 3, detail: UNTAKEN });
        }),
    );

    it.effect("a Mate whose link drops before it takes its task gives it back", () =>
      Effect.gen(function* () {
        const core = yield* withPool();
        yield* core.issue(1);
        yield* toldTask(core.robot.link, 1);
        yield* core.robot.link.close;
        const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "queued");
        assert.deepInclude(row, { attempts: 1, mate_project_id: null });
      }),
    );

    it.effect("a task is told again on the Mate's next link until it takes it", () =>
      Effect.gen(function* () {
        const core = yield* withPool();
        yield* core.issue(1);
        const first = yield* toldTask(core.robot.link, 1);
        const again = yield* linkOf(core, core.robot.credential);
        assert.strictEqual((yield* toldTask(again.link, 1)).id, first.id);
      }),
    );

    it.effect(
      "the Mate's word moves its task: taken in a conversation, then done, and the Mate takes the next",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          yield* core.issue(1);
          yield* core.issue(2);
          const task = yield* toldTask(core.robot.link, 1);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "accepted", conversationId: "conversation-1" },
          });
          yield* core.tasks((rows) => rows[0]?.["state"] === "working");
          // Still on it: the next task waits.
          assert.isFalse(
            (yield* core.robot.link.collected).some(
              (frame) => frame.type === "task" && (frame["task"] as MateTask).source.number === 2,
            ),
          );
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "done" },
          });
          yield* toldTask(core.robot.link, 2);
          const rows = yield* core.tasks((found) => found[1]?.["state"] === "assigned");
          assert.deepInclude(rows[0], { state: "done", conversation_id: "conversation-1" });
        }),
    );

    it.effect("a Mate's word on a task not its own is passed by", () =>
      Effect.gen(function* () {
        const core = yield* withPool({ busy: true });
        yield* core.issue(1);
        const [waiting] = yield* core.tasks((rows) => rows.length === 1);
        yield* core.robot.link.send({
          type: "task-state",
          report: { taskId: String(waiting!["id"]), state: "done" },
        });
        yield* core.robot.link.send(attention(0));
        yield* toldTask(core.robot.link, 1);
        const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "assigned");
        assert.strictEqual(row!["mate_project_id"], "P_ROBOT");
      }),
    );
  });
});
