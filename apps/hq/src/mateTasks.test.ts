import { assert, describe, it } from "@effect/vitest";
import type { MateTask } from "@t3tools/contracts";
import type { HqNavigationApp, HqNavigationProject } from "@t3tools/shared/hqStream";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import {
  ROBOT_TASK_LINK,
  attention,
  automatedPool,
  connectedRepo,
  deliver,
  intakeOn,
  issueEvent,
  linkOf,
  mateLinked,
  throughOrgApp,
} from "../test/harness/automated.ts";
import { githubFake } from "../test/harness/githubFake.ts";
import { addProject, rowsWhere } from "../test/harness/mates.ts";
import type { SocketMessage } from "../test/harness/runningCore.ts";
import { sessionFor, startCore, ticketFor, untilHealth } from "../test/harness/runningCore.ts";
import { nextScopeValue, scopeReset } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { changeRoutePath } from "@t3tools/shared/hqChanges";
import { GITHUB_TOKEN } from "../test/harness/automated.ts";
import { ISSUE_CLOSED } from "./intake.ts";
import { DECLINED_FOR, MATE_AWAY, TASK_CHANGES_SINCE, UNTAKEN } from "./mateTasks.ts";

const NAV = { kind: "navigation" } as const;

const withPool = automatedPool;

type Core = Effect.Success<ReturnType<typeof withPool>>;
type Link = Core["robot"]["link"];

/** The next task the link is told, of issue `number`. */
const toldTask = (link: Link, number: number) =>
  Effect.map(
    link.takeWhere(
      `the task of issue ${String(number)}`,
      (frame: SocketMessage) =>
        frame.type === "task" && issueNumberOf(frame["task"] as MateTask) === number,
    ),
    (frame) => frame["task"] as MateTask,
  );

/** The issue number of a task HQ told: every task here is a GitHub issue's. */
const issueNumberOf = (task: MateTask) =>
  task.source.kind === "github-issue" ? task.source.number : undefined;

/** The robot's repository `appdev`, made. */
const repoOf = (core: Core) =>
  core.call("POST", "/api/mate/repos", { headers: core.robot.auth, body: { name: "appdev" } });

/** The task of issue `number` told to `link` and taken: its Mate's word on it, from then on. */
const onTask = (core: Core, link: Link, number: number) =>
  Effect.gen(function* () {
    const task = yield* toldTask(link, number);
    const word = (report: Record<string, unknown>) =>
      link.send({ type: "task-state", report: { taskId: task.id, ...report } });
    yield* word({ state: "accepted", conversationId: "conversation-1" });
    yield* core.tasks((rows) =>
      rows.some((row) => row["number"] === number && row["state"] === "working"),
    );
    return { id: task.id, word };
  });

/** The robot's delivery to `appdev`: the change HQ answers, and whether it opened it now. */
const openOn = (core: Core, title: string) =>
  Effect.map(
    core.call("POST", "/api/mate/changes", {
      headers: core.robot.auth,
      body: { repo: "appdev", title },
    }),
    (answer) => {
      const body = answer.body as { change: { number: number }; created: boolean };
      return { number: body.change.number, created: body.created };
    },
  );

/** A member's review comment on the robot's change `number`. */
const commentOn = (core: Core, number: number, body: string) =>
  core.call("POST", `/api/apps/${core.appId}/changes/appdev/${String(number)}/comments`, {
    session: core.owner,
    body: { body },
  });

/**
 * The robot's first task done, its change waiting for review, and its second taken and delivered:
 * each task's change.
 */
const twoChanges = (core: Core) =>
  Effect.gen(function* () {
    yield* repoOf(core);
    yield* core.issue(1);
    const firstTask = yield* onTask(core, core.robot.link, 1);
    const first = yield* openOn(core, "Hotter tea");
    yield* firstTask.word({ state: "done" });
    yield* core.tasks((rows) => rows[0]?.["state"] === "done");
    yield* core.issue(2);
    const secondTask = yield* onTask(core, core.robot.link, 2);
    const second = yield* openOn(core, "Cooler cups");
    return { first: { ...first, task: firstTask }, second: { ...second, task: secondTask } };
  });

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
            label: "acme/tea-shop#1",
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

    it.effect(
      "every task carries what it may spend: the organization's limits, sixty minutes and no cost limit until an owner or admin sets them",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          yield* core.issue(1);
          const first = yield* toldTask(core.robot.link, 1);
          assert.deepStrictEqual(first.limits, { minutes: 60, costUsd: null });
          const developer = yield* sessionFor(core.call, "door-dev");
          const refused = yield* core.call("PUT", "/api/org/task-limits", {
            session: developer,
            body: { minutes: 30, costUsd: 5 },
          });
          assert.strictEqual(refused.status, 403);
          const invalid = yield* core.call("PUT", "/api/org/task-limits", {
            session: core.owner,
            body: { minutes: 0, costUsd: null },
          });
          assert.strictEqual(invalid.status, 400);
          const kept = yield* core.call("PUT", "/api/org/task-limits", {
            session: core.owner,
            body: { minutes: 30, costUsd: 5 },
          });
          const limits = { minutes: 30, costUsd: 5, monthlyBudgetUsd: null, spentThisMonthUsd: 0 };
          assert.deepStrictEqual(kept.body, limits);
          const read = yield* core.call("GET", "/api/org/task-limits", { session: developer });
          assert.deepStrictEqual(read.body, limits);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: first.id, state: "failed", detail: "No kettle." },
          });
          yield* core.issue(2);
          const second = yield* toldTask(core.robot.link, 2);
          assert.deepStrictEqual(second.limits, { minutes: 30, costUsd: 5 });
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

    it.effect(
      "a task its Mate declines waits again with no try against it, and is offered once the Mate has rested",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool({ taskAcceptWithin: Duration.millis(400) });
          yield* core.issue(1);
          const task = yield* toldTask(core.robot.link, 1);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "declined", detail: "Still standing up." },
          });
          const [waiting] = yield* core.tasks((rows) => rows[0]?.["state"] === "queued");
          assert.deepInclude(waiting, { attempts: 0, mate_project_id: null, detail: null });
          assert.strictEqual((yield* toldTask(core.robot.link, 1)).id, task.id);
          const [again] = yield* core.tasks((rows) => rows[0]?.["state"] === "assigned");
          assert.deepInclude(again, { attempts: 0, mate_project_id: "P_ROBOT" });
        }),
    );

    it.effect(
      "while the organization keeps no key for its automated Mates' provider, tasks wait and none is handed out; once it keeps one, they go",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool({ keyless: true });
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          yield* core.issue(1);
          yield* nextScopeValue<HqNavigationApp>(
            watching,
            NAV,
            `app:${core.appId}`,
            (value) => value.intake?.waiting === 1,
          );
          const [waiting] = yield* core.tasks((rows) => rows.length === 1);
          assert.deepInclude(waiting, { state: "queued", attempts: 0, mate_project_id: null });
          assert.isFalse((yield* core.robot.link.collected).some((frame) => frame.type === "task"));
          yield* core.keyKept();
          yield* toldTask(core.robot.link, 1);
          yield* watching.close;
        }),
    );

    it.effect("a task its Mates keep turning down for 30 minutes fails, saying why", () =>
      Effect.gen(function* () {
        const core = yield* withPool({ taskAcceptWithin: Duration.millis(200) });
        yield* core.issue(1);
        const declined = (taskId: string) =>
          core.robot.link.send({
            type: "task-state",
            report: { taskId, state: "declined", detail: "Still standing up." },
          });
        const task = yield* toldTask(core.robot.link, 1);
        yield* declined(task.id);
        yield* core.tasks((rows) => rows[0]?.["state"] === "queued");
        // Turned down first half an hour ago.
        yield* core.sql`
          UPDATE hq_task SET declined_since = now() - make_interval(secs => ${Duration.toSeconds(DECLINED_FOR) + 1})`;
        yield* declined((yield* toldTask(core.robot.link, 1)).id);
        const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "failed");
        assert.deepInclude(row, {
          mate_project_id: null,
          detail: "it was turned down for 30 minutes. The last reason: Still standing up.",
        });
        yield* core.github.seenWhere("the failure's word", (seen) =>
          seen.some((request) =>
            (request.body as { body?: string })?.body?.startsWith("No automated Mate"),
          ),
        );
        assert.deepStrictEqual((yield* core.github.commentLog).at(-1), [
          "PATCH",
          "/repos/acme/tea-shop/issues/comments/101",
          "No automated Mate could take this up: it was turned down for 30 minutes. The last reason: Still standing up.",
        ]);
      }),
    );

    it.effect("a Mate whose link drops before it takes its task gives it back", () =>
      Effect.gen(function* () {
        const core = yield* withPool({ taskAcceptWithin: Duration.millis(300) });
        yield* core.issue(1);
        yield* toldTask(core.robot.link, 1);
        yield* core.robot.link.close;
        // Not at once — its word may still come on its next link — but once its time to take it
        // has passed.
        const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "queued");
        assert.deepInclude(row, { attempts: 1, mate_project_id: null });
      }),
    );

    it.effect(
      "a Mate's word on its task, late after its link dropped, is taken while the task waits for no other Mate",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool({ taskAcceptWithin: Duration.millis(300) });
          yield* core.issue(1);
          const task = yield* toldTask(core.robot.link, 1);
          // Its agents set to work on it as the link drops: back, it is not free for another.
          yield* core.robot.link.send(attention(1));
          yield* core.robot.link.close;
          yield* core.tasks((rows) => rows[0]?.["state"] === "queued");
          const again = yield* linkOf(core, core.robot.credential);
          yield* again.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "accepted", conversationId: "conversation-1" },
          });
          const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "working");
          assert.deepInclude(row, {
            mate_project_id: "P_ROBOT",
            conversation_id: "conversation-1",
          });
        }),
    );

    it.effect("a Mate's word on its task after it went to another Mate is passed by", () =>
      Effect.gen(function* () {
        const core = yield* withPool({ taskAcceptWithin: Duration.millis(300) });
        addProject(core.fake, "P_OTHER");
        const other = yield* mateLinked(core, core.owner, "P_OTHER", { appId: core.appId });
        yield* core.issue(1);
        const task = yield* toldTask(core.robot.link, 1);
        yield* core.robot.link.close;
        yield* other.link.send(attention(0));
        yield* toldTask(other.link, 1);
        const again = yield* linkOf(core, core.robot.credential);
        for (const state of ["accepted", "done"] as const)
          yield* again.link.send({ type: "task-state", report: { taskId: task.id, state } });
        yield* other.link.send({
          type: "task-state",
          report: { taskId: task.id, state: "accepted", conversationId: "conversation-2" },
        });
        const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "working");
        assert.deepInclude(row, { mate_project_id: "P_OTHER", conversation_id: "conversation-2" });
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
              (frame) => frame.type === "task" && issueNumberOf(frame["task"] as MateTask) === 2,
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

    it.effect("a change the Mate opens while on a task is that task's change", () =>
      Effect.gen(function* () {
        const core = yield* withPool();
        const opened = (title: string) =>
          core.call("POST", "/api/mate/changes", {
            headers: core.robot.auth,
            body: { repo: "appdev", title },
          });
        yield* core.call("POST", "/api/mate/repos", {
          headers: core.robot.auth,
          body: { name: "appdev" },
        });
        // Off any task, a change is no task's.
        assert.strictEqual((yield* opened("Before")).status, 200);
        yield* core.issue(1);
        const task = yield* toldTask(core.robot.link, 1);
        yield* core.robot.link.send({
          type: "task-state",
          report: { taskId: task.id, state: "accepted", conversationId: "conversation-1" },
        });
        yield* core.tasks((rows) => rows[0]?.["state"] === "working");
        const change = yield* opened("Hotter tea");
        assert.strictEqual(change.status, 200);
        assert.notProperty(change.body, "task");
        const [row] = yield* rowsWhere(
          core.url,
          "SELECT change_repo, change_number FROM hq_task",
          (rows) => rows[0]?.["change_number"] != null,
        );
        assert.deepStrictEqual(row, {
          change_repo: "appdev",
          change_number: (change.body as { change: { number: number } }).change.number,
        });
      }),
    );

    it.effect(
      "HQ hands a task to a Mate without an open change first, and to one holding a change when no other is free, its row reading the task it is on",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool({ version: TASK_CHANGES_SINCE });
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          const rowTask = (number: number) =>
            nextScopeValue<HqNavigationProject>(
              watching,
              NAV,
              "project:P_ROBOT",
              (project) => project.mate?.task?.number === number,
            );
          yield* repoOf(core);
          yield* core.issue(1);
          const first = yield* onTask(core, core.robot.link, 1);
          yield* openOn(core, "Hotter tea");
          yield* first.word({ state: "done" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          // Done, its change waiting for review: its row still reads that task.
          yield* rowTask(1);
          addProject(core.fake, "P_OTHER");
          const other = yield* mateLinked(core, core.owner, "P_OTHER", { appId: core.appId });
          yield* other.link.send(attention(0));
          // Both are free; the one holding no change goes first.
          yield* core.issue(2);
          yield* toldTask(other.link, 2);
          // The other is on its task: the one holding a change takes the next.
          yield* core.issue(3);
          yield* toldTask(core.robot.link, 3);
          yield* rowTask(3);
          yield* watching.close;
        }),
    );

    it.effect(
      "a task's delivery opens its own change while the Mate's earlier change waits for review",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool({ version: TASK_CHANGES_SINCE });
          const { first, second } = yield* twoChanges(core);
          assert.notStrictEqual(second.number, first.number);
          assert.isTrue(second.created);
          // Delivered again, the task's change is found again.
          const again = yield* openOn(core, "Cooler cups, again");
          assert.deepStrictEqual(again, { number: second.number, created: false });
          const rows = yield* rowsWhere(
            core.url,
            "SELECT change_number FROM hq_task ORDER BY seq",
            (found) => found.length === 2,
          );
          assert.deepStrictEqual(
            rows.map((row) => row["change_number"]),
            [first.number, second.number],
          );
          const open = yield* rowsWhere(
            core.url,
            "SELECT number FROM hq_change WHERE state = 'open' ORDER BY number",
            (found) => found.length === 2,
          );
          assert.deepStrictEqual(
            open.map((row) => row["number"]),
            [first.number, second.number],
          );
        }),
    );

    it.effect("a follow-up's delivery lands in its own task's change", () =>
      Effect.gen(function* () {
        const core = yield* withPool({ version: TASK_CHANGES_SINCE });
        const { first, second } = yield* twoChanges(core);
        yield* second.task.word({ state: "done" });
        yield* core.tasks((rows) => rows[1]?.["state"] === "done");
        yield* commentOn(core, first.number, "Rename the kettle.");
        const message = yield* core.robot.link.take("task-message");
        assert.strictEqual(message["taskId"], first.task.id);
        // The frame names the task's change: the branch its follow-up's work starts from.
        assert.deepStrictEqual(message["change"], {
          repo: "appdev",
          number: first.number,
          branch: `mate/P_ROBOT/${String(first.number)}`,
        });
        yield* first.task.word({ state: "working", conversationId: "conversation-1" });
        yield* core.tasks((rows) => rows[0]?.["state"] === "working");
        const delivered = yield* openOn(core, "Renamed kettle");
        assert.deepStrictEqual(delivered, { number: first.number, created: false });
      }),
    );

    it.effect(
      "a review comment on an earlier change waits while its Mate works another task, then reaches it, and the Mate takes no new task before it is back on it",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool({ version: TASK_CHANGES_SINCE });
          const { first, second } = yield* twoChanges(core);
          yield* commentOn(core, first.number, "Rename the kettle.");
          yield* rowsWhere(core.url, "SELECT 1 FROM hq_task_message", (rows) => rows.length === 1);
          // On the second task: the first's follow-up waits.
          assert.isFalse(
            (yield* core.robot.link.collected).some((frame) => frame.type === "task-message"),
          );
          yield* second.task.word({ state: "done" });
          const message = yield* core.robot.link.take("task-message");
          assert.strictEqual(message["taskId"], first.task.id);
          // It owes that follow-up: a task coming in now waits until it is done with it.
          yield* core.issue(3);
          yield* core.github.seenWhere("the third issue's line", (seen) =>
            seen.some((request) => request.path.includes("/issues/3/comments")),
          );
          yield* first.task.word({ state: "working", conversationId: "conversation-1" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "working");
          yield* first.task.word({ state: "done" });
          yield* toldTask(core.robot.link, 3);
          const [order] = yield* rowsWhere(
            core.url,
            `SELECT (SELECT assigned_at FROM hq_task WHERE number = 3)
               > (SELECT ended_at FROM hq_task WHERE number = 1) AS after`,
            (rows) => rows.length === 1,
          );
          assert.strictEqual(order!["after"], true);
        }),
    );

    it.effect(
      "a Mate from before each task had its own change takes no new task while its task's change waits for review, until it is merged or closed",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          yield* repoOf(core);
          yield* core.issue(1);
          const first = yield* onTask(core, core.robot.link, 1);
          const { number } = yield* openOn(core, "Hotter tea");
          yield* first.word({ state: "done" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          yield* core.issue(2);
          yield* core.github.seenWhere("the second issue's line", (seen) =>
            seen.some((request) => request.path.includes("/issues/2/comments")),
          );
          // Its one working copy still holds the first task's work.
          assert.isFalse(
            (yield* core.robot.link.collected).some(
              (frame) => frame.type === "task" && issueNumberOf(frame["task"] as MateTask) === 2,
            ),
          );
          const closed = yield* core.call(
            "POST",
            `/api/apps/${core.appId}/changes/appdev/${String(number)}/close`,
            { session: core.owner, body: { expectedHead: null } },
          );
          assert.strictEqual(closed.status, 200);
          yield* toldTask(core.robot.link, 2);
        }),
    );

    it.effect(
      "a review comment on a done task's change that arrives while its Mate is offline reaches it when it is back, however long it was away",
      () =>
        Effect.gen(function* () {
          // A follow-up told is owed for no time at all: only the link's own telling remains.
          const core = yield* withPool({
            version: TASK_CHANGES_SINCE,
            tasks: { followUpWithin: Duration.millis(0) },
          });
          yield* repoOf(core);
          yield* core.issue(1);
          const first = yield* onTask(core, core.robot.link, 1);
          const { number } = yield* openOn(core, "Hotter tea");
          yield* first.word({ state: "done" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          yield* core.robot.link.close;
          yield* commentOn(core, number, "Rename the kettle.");
          // Away for a while: HQ looks at its tasks every 50 ms meanwhile.
          yield* rowsWhere(
            core.url,
            "SELECT 1 FROM hq_task_message WHERE created_at < now() - interval '300 milliseconds'",
            (rows) => rows.length === 1,
          );
          const back = yield* linkOf(core, core.robot.credential);
          const message = yield* back.link.take("task-message");
          assert.strictEqual(message["taskId"], first.id);
        }),
    );

    it.effect(
      "GitHub hears from the Mate by name: it picked the issue up, opened a change for review, couldn't finish",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          const issue = "/repos/acme/tea-shop/issues/1/comments";
          const status = "/repos/acme/tea-shop/issues/comments/101";
          const said = (words: string) =>
            core.github.seenWhere(words, (seen) =>
              seen.some((request) => (request.body as { body?: string })?.body?.startsWith(words)),
            );
          yield* core.call("POST", "/api/mate/repos", {
            headers: core.robot.auth,
            body: { name: "appdev" },
          });
          yield* core.issue(1);
          const task = yield* toldTask(core.robot.link, 1);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "accepted", conversationId: "conversation-1" },
          });
          yield* said("**P_ROBOT** is on it");
          const change = yield* core.call("POST", "/api/mate/changes", {
            headers: core.robot.auth,
            body: { repo: "appdev", title: "Hotter tea" },
          });
          const number = (change.body as { change: { number: number } }).change.number;
          // A draft is no change for review yet: the line says so once the Mate described it.
          yield* core.sql`UPDATE hq_change SET head = ${"a".repeat(40)} WHERE repo = 'appdev' AND number = ${number}`;
          const words = yield* core.call("PATCH", `/api/mate/changes/appdev/${String(number)}`, {
            headers: core.robot.auth,
            body: { body: "Heats the water hotter." },
          });
          assert.strictEqual(words.status, 200);
          yield* said("P_ROBOT opened a change for review");
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "failed", detail: "The kettle would not boil." },
          });
          yield* said("P_ROBOT couldn't finish this");
          // One status comment, made once and edited as the task moved.
          assert.deepStrictEqual(yield* core.github.commentLog, [
            ["POST", issue, "Queued for an automated Mate: #1 in line."],
            ["PATCH", status, `**P_ROBOT** is on it — [follow along](${ROBOT_TASK_LINK}).`],
            [
              "PATCH",
              status,
              `P_ROBOT opened a change for review: ${DEFAULT_HOSTED_APP_URL}${changeRoutePath(core.appId, "appdev", number)}`,
            ],
            ["PATCH", status, "P_ROBOT couldn't finish this: The kettle would not boil."],
          ]);
          assert.isTrue(
            core.github.state.seen
              .filter((request) => request.path.includes("/comments"))
              .every((request) => request.authorization === `Bearer ${GITHUB_TOKEN}`),
          );
        }),
    );

    it.effect(
      "a member's review comment on a task's change reaches the Mate that made it in the task's conversation, also once it said it was done",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          yield* core.call("POST", "/api/mate/repos", {
            headers: core.robot.auth,
            body: { name: "appdev" },
          });
          yield* core.issue(1);
          const task = yield* toldTask(core.robot.link, 1);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "accepted", conversationId: "conversation-1" },
          });
          yield* core.tasks((rows) => rows[0]?.["state"] === "working");
          const change = yield* core.call("POST", "/api/mate/changes", {
            headers: core.robot.auth,
            body: { repo: "appdev", title: "Hotter tea" },
          });
          const number = (change.body as { change: { number: number } }).change.number;
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "done" },
          });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          const posted = yield* core.call(
            "POST",
            `/api/apps/${core.appId}/changes/appdev/${String(number)}/comments`,
            { session: core.owner, body: { body: "Rename the kettle\u200B first." } },
          );
          assert.strictEqual(posted.status, 200);
          const message = yield* core.robot.link.take("task-message");
          assert.strictEqual(message["taskId"], task.id);
          assert.deepInclude(message["message"] as object, {
            from: "review",
            author: "owner",
            text: "Rename the kettle first.",
          });
        }),
    );

    it.effect(
      "a Mate woken by a review comment on its done task's change works it again: its question reaches the issue, and it finishes again",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          yield* core.call("POST", "/api/mate/repos", {
            headers: core.robot.auth,
            body: { name: "appdev" },
          });
          yield* core.issue(1);
          const task = yield* toldTask(core.robot.link, 1);
          const word = (report: Record<string, unknown>) =>
            core.robot.link.send({ type: "task-state", report: { taskId: task.id, ...report } });
          yield* word({ state: "accepted", conversationId: "conversation-1" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "working");
          const change = yield* core.call("POST", "/api/mate/changes", {
            headers: core.robot.auth,
            body: { repo: "appdev", title: "Hotter tea" },
          });
          const number = (change.body as { change: { number: number } }).change.number;
          yield* word({ state: "done" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          yield* core.call(
            "POST",
            `/api/apps/${core.appId}/changes/appdev/${String(number)}/comments`,
            { session: core.owner, body: { body: "Which cups?" } },
          );
          yield* core.robot.link.take("task-message");
          yield* word({ state: "waiting", question: "The blue ones or the red ones?" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "waiting");
          yield* core.github.seenWhere("the question on the issue", (seen) =>
            seen.some((request) =>
              (request.body as { body?: string })?.body?.startsWith("P_ROBOT is waiting for you"),
            ),
          );
          yield* word({ state: "done" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
        }),
    );

    it.effect("a comment GitHub refuses is tried once more, and never fails the task", () =>
      Effect.gen(function* () {
        const core = yield* withPool();
        core.github.state.commentStatuses = [502, 502];
        yield* core.issue(1);
        const task = yield* toldTask(core.robot.link, 1);
        yield* core.robot.link.send({
          type: "task-state",
          report: { taskId: task.id, state: "accepted" },
        });
        yield* core.github.seenWhere(
          "the comment tried twice",
          (seen) => seen.filter((request) => request.path.endsWith("/comments")).length >= 2,
        );
        const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "working");
        assert.strictEqual(row!["state"], "working");
      }),
    );

    it.effect("a task no Mate took fails on GitHub too, saying why", () =>
      Effect.gen(function* () {
        const core = yield* withPool({ taskAcceptWithin: Duration.millis(200) });
        yield* core.issue(1);
        yield* core.github.seenWhere("the failure's word", (seen) =>
          seen.some((request) =>
            (request.body as { body?: string })?.body?.startsWith("No automated Mate"),
          ),
        );
        // No Mate took it: none is named.
        assert.deepStrictEqual((yield* core.github.commentLog).at(-1), [
          "PATCH",
          "/repos/acme/tea-shop/issues/comments/101",
          `No automated Mate could take this up: ${UNTAKEN}`,
        ]);
        const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "failed");
        assert.strictEqual(row!["mate_project_id"], null);
      }),
    );

    it.effect("a task whose Mate went away mid-task for two hours fails, saying why", () =>
      Effect.gen(function* () {
        const core = yield* withPool({ taskGoneAfter: Duration.millis(300) });
        yield* core.issue(1);
        const task = yield* toldTask(core.robot.link, 1);
        yield* core.robot.link.send({
          type: "task-state",
          report: { taskId: task.id, state: "accepted", conversationId: "conversation-1" },
        });
        yield* core.tasks((rows) => rows[0]?.["state"] === "working");
        yield* core.robot.link.close;
        const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "failed");
        assert.deepInclude(row, { mate_project_id: "P_ROBOT", detail: MATE_AWAY });
        yield* core.github.seenWhere("the failure's word", (seen) =>
          seen.some((request) =>
            (request.body as { body?: string })?.body?.startsWith("P_ROBOT couldn't finish"),
          ),
        );
        assert.deepStrictEqual((yield* core.github.commentLog).at(-1), [
          "PATCH",
          "/repos/acme/tea-shop/issues/comments/101",
          `P_ROBOT couldn't finish this: ${MATE_AWAY}`,
        ]);
      }),
    );

    it.effect(
      "closing an issue stops its task at any stage: dropped while no Mate took it, its Mate told to stop once one did",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          const closed = (number: number) =>
            deliver(core, core.hook, "issues", issueEvent("closed", { number, labels: ["mate"] }));
          yield* core.issue(1);
          yield* toldTask(core.robot.link, 1);
          yield* closed(1);
          yield* core.tasks((rows) =>
            rows.some((row) => row["number"] === 1 && row["state"] === "dropped"),
          );
          yield* core.issue(2);
          const second = yield* toldTask(core.robot.link, 2);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: second.id, state: "accepted", conversationId: "conversation-2" },
          });
          yield* core.tasks((rows) => rows[1]?.["state"] === "working");
          yield* closed(2);
          const stop = yield* core.robot.link.take("task-stop");
          assert.deepStrictEqual(stop, { taskId: second.id, reason: ISSUE_CLOSED });
          // Told again on its next link, until it says it stopped.
          yield* core.robot.link.close;
          const again = yield* linkOf(core, core.robot.credential);
          assert.strictEqual((yield* again.link.take("task-stop"))["taskId"], second.id);
          yield* again.link.send({
            type: "task-state",
            report: { taskId: second.id, state: "stopped" },
          });
          const rows = yield* core.tasks((found) => found[1]?.["state"] === "stopped");
          assert.deepStrictEqual(
            rows.map((row) => [row["number"], row["state"], row["mate_project_id"], row["detail"]]),
            [
              [1, "dropped", null, ISSUE_CLOSED],
              [2, "stopped", "P_ROBOT", ISSUE_CLOSED],
            ],
          );
          yield* core.github.seenWhere("the stop's word", (seen) =>
            seen.some((request) =>
              (request.body as { body?: string })?.body?.startsWith(
                `P_ROBOT stopped: ${ISSUE_CLOSED}`,
              ),
            ),
          );
        }),
    );

    it.effect(
      "a Mate that takes a task people stopped before it did is told to stop, and again on each link until it says it stopped",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          yield* core.issue(1);
          const task = yield* toldTask(core.robot.link, 1);
          yield* deliver(
            core,
            core.hook,
            "issues",
            issueEvent("closed", { number: 1, labels: ["mate"] }),
          );
          yield* core.tasks((rows) => rows[0]?.["state"] === "dropped");
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "accepted", conversationId: "conversation-1" },
          });
          assert.deepStrictEqual(yield* core.robot.link.take("task-stop"), {
            taskId: task.id,
            reason: ISSUE_CLOSED,
          });
          yield* core.robot.link.close;
          const again = yield* linkOf(core, core.robot.credential);
          assert.strictEqual((yield* again.link.take("task-stop"))["taskId"], task.id);
          yield* again.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "stopped" },
          });
          yield* rowsWhere(
            core.url,
            "SELECT stop_heard_at IS NOT NULL AS heard FROM hq_task",
            (rows) => rows[0]?.["heard"] === true,
          );
        }),
    );

    it.effect(
      "a Mate back after HQ ended its stopped task without its word is told to stop it",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool({ tasks: { stopWithin: Duration.millis(200) } });
          yield* core.issue(1);
          const task = yield* toldTask(core.robot.link, 1);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "accepted", conversationId: "conversation-1" },
          });
          yield* core.tasks((rows) => rows[0]?.["state"] === "working");
          yield* core.robot.link.close;
          yield* deliver(
            core,
            core.hook,
            "issues",
            issueEvent("closed", { number: 1, labels: ["mate"] }),
          );
          yield* core.tasks((rows) => rows[0]?.["state"] === "stopped");
          const again = yield* linkOf(core, core.robot.credential);
          assert.deepStrictEqual(yield* again.link.take("task-stop"), {
            taskId: task.id,
            reason: ISSUE_CLOSED,
          });
        }),
    );

    it.effect(
      "a task no Mate took goes when its application's intake stops or moves to another repository; only the intake's own repository's tasks are handed out",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          const states = (found: ReadonlyArray<Record<string, unknown>>) =>
            found.map((row) => [row["number"], row["state"], row["mate_project_id"]]);
          yield* core.issue(1);
          yield* toldTask(core.robot.link, 1);
          yield* core.call("DELETE", `/api/apps/${core.appId}/intake`, { session: core.owner });
          yield* core.tasks((rows) => rows[0]?.["state"] === "dropped");
          // Pointed back at it, then moved to another repository while the next is handed out.
          const hook = yield* intakeOn(core, core.github, core.owner, core.appId);
          yield* deliver(
            core,
            hook,
            "issues",
            issueEvent("opened", { number: 2, labels: ["mate"] }),
          );
          yield* toldTask(core.robot.link, 2);
          yield* connectedRepo(core, core.appId, "api", "acme/coffee-shop");
          const moved = yield* core.call("PUT", `/api/apps/${core.appId}/intake`, {
            session: core.owner,
            body: { repo: "acme/coffee-shop", label: "mate" },
          });
          assert.strictEqual(moved.status, 200);
          const rows = yield* core.tasks((found) => found[1]?.["state"] === "dropped");
          assert.deepStrictEqual(states(rows), [
            [1, "dropped", null],
            [2, "dropped", null],
          ]);
          // A task of the repository the intake left, however it came to wait, is handed to no
          // one: the Mate gets the newer task of the intake's repository instead.
          const waiting = (number: number, repo: string) => {
            const url = `https://github.com/${repo}/issues/${String(number)}`;
            const title = `Issue ${String(number)}`;
            const source = { kind: "github-issue", repo, number, url, title, author: null };
            return core.sql`
              INSERT INTO hq_task (app_id, repo, number, title, body, url, delivery_id, state,
                source_kind, source, source_key)
              VALUES (${core.appId}::uuid, ${repo}, ${number}, ${title}, '', ${url},
                ${`waiting-${String(number)}`}, 'queued', 'github-issue',
                ${JSON.stringify(source)}::jsonb, ${`github:${repo}#${String(number)}`})`;
          };
          yield* waiting(3, "acme/tea-shop");
          yield* waiting(4, "acme/coffee-shop");
          yield* core.robot.link.send(attention(0));
          yield* toldTask(core.robot.link, 4);
          const after = yield* core.tasks((found) => found[3]?.["state"] === "assigned");
          assert.deepStrictEqual(states(after).slice(2), [
            [3, "queued", null],
            [4, "assigned", "P_ROBOT"],
          ]);
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

    it.effect(
      "a task of an application mirrored to GitHub through the organization's app carries the app's bot as its commits' author",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          const app = yield* throughOrgApp(core, "acme-mate");
          yield* app.issue(1);
          const task = yield* toldTask(core.robot.link, 1);
          assert.deepStrictEqual(task.commitAuthor, {
            name: "acme-mate[bot]",
            email: `${String(core.github.state.botUserId)}+acme-mate[bot]@users.noreply.github.com`,
          });
        }),
    );

    it.effect("a task of an application mirrored with a kept token carries no commit author", () =>
      Effect.gen(function* () {
        const core = yield* withPool();
        yield* core.issue(1);
        const task = yield* toldTask(core.robot.link, 1);
        assert.notProperty(task, "commitAuthor");
      }),
    );
  });
});
