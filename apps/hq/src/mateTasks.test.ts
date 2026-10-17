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
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { changeRoutePath } from "@t3tools/shared/hqChanges";
import { GITHUB_TOKEN } from "../test/harness/automated.ts";
import { DECLINED_FOR, MATE_AWAY, UNTAKEN } from "./mateTasks.ts";

const NAV = { kind: "navigation" } as const;

/** A fake Nebius key, built from parts so no scanner takes it for one. */
const NEBIUS_KEY = ["v1", "fake", "nebius", "key", "0123456789"].join(".");

/**
 * A Core whose application `Tea Shop` takes `acme/tea-shop`'s issues labelled `mate`, with its
 * automated Mate `P_ROBOT` linked and resting.
 */
const withPool = (
  given: {
    readonly taskAcceptWithin?: Duration.Duration;
    readonly taskGoneAfter?: Duration.Duration;
    readonly busy?: boolean;
    /** The organization keeps no key for its automated Mates' provider. */
    readonly keyless?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const github = yield* githubFake;
    const core = yield* startCore(true, {
      githubApi: github.url,
      ...(given.taskAcceptWithin === undefined && given.taskGoneAfter === undefined
        ? {}
        : { taskSweepEvery: Duration.millis(50) }),
      ...(given.taskAcceptWithin === undefined ? {} : { taskAcceptWithin: given.taskAcceptWithin }),
      ...(given.taskGoneAfter === undefined ? {} : { taskGoneAfter: given.taskGoneAfter }),
    });
    yield* untilHealth(core.call, "active");
    const owner = yield* sessionFor(core.call, "door-owner");
    const app = yield* core.call("POST", "/api/apps", {
      session: owner,
      body: { name: "Tea Shop" },
    });
    const appId = (app.body as { readonly id: string }).id;
    const keyKept = () =>
      core.call("PUT", "/api/org/ai-keys/nebius", { session: owner, body: { value: NEBIUS_KEY } });
    if (given.keyless !== true) yield* keyKept();
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
    return { ...core, github, owner, appId, hook, robot, issue, tasks, keyKept };
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
        yield* core.github.seenWhere("the failure's comment", (seen) =>
          seen.some((request) => request.path.endsWith("/comments")),
        );
        assert.deepStrictEqual(yield* core.github.comments, [
          [
            "/repos/acme/tea-shop/issues/1/comments",
            "No automated Mate could take this up: it was turned down for 30 minutes. The last reason: Still standing up.",
          ],
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
      "an automated Mate takes no new task while its last task's change waits for review, its row reading that task, until the change is merged or closed",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
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
          yield* rowTask(1);
          // Another Mate is free, this one is not: its copy of the code still holds the change.
          addProject(core.fake, "P_OTHER");
          const other = yield* mateLinked(core, core.owner, "P_OTHER", { appId: core.appId });
          yield* other.link.send(attention(0));
          yield* core.issue(2);
          yield* core.issue(3);
          yield* toldTask(other.link, 2);
          assert.isFalse(
            (yield* core.robot.link.collected).some(
              (frame) => frame.type === "task" && (frame["task"] as MateTask).source.number !== 1,
            ),
          );
          const closed = yield* core.call(
            "POST",
            `/api/apps/${core.appId}/changes/appdev/${String(number)}/close`,
            { session: core.owner, body: { expectedHead: null } },
          );
          assert.strictEqual(closed.status, 200);
          yield* toldTask(core.robot.link, 3);
          yield* rowTask(3);
          yield* watching.close;
        }),
    );

    it.effect(
      "GitHub hears from the Mate by name: it picked the issue up, opened a change for review, couldn't finish",
      () =>
        Effect.gen(function* () {
          const core = yield* withPool();
          const issue = "/repos/acme/tea-shop/issues/1/comments";
          const commented = (count: number) =>
            core.github.seenWhere(
              `${String(count)} comments`,
              (seen) =>
                seen.filter((request) => request.path.endsWith("/comments")).length >= count,
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
          yield* commented(1);
          const change = yield* core.call("POST", "/api/mate/changes", {
            headers: core.robot.auth,
            body: { repo: "appdev", title: "Hotter tea" },
          });
          const number = (change.body as { change: { number: number } }).change.number;
          yield* commented(2);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "failed", detail: "The kettle would not boil." },
          });
          yield* commented(3);
          assert.deepStrictEqual(yield* core.github.comments, [
            [issue, "P_ROBOT picked this up."],
            [
              issue,
              `P_ROBOT opened a change for review: ${DEFAULT_HOSTED_APP_URL}${changeRoutePath(core.appId, "appdev", number)}`,
            ],
            [issue, "P_ROBOT couldn't finish this: The kettle would not boil."],
          ]);
          assert.isTrue(
            core.github.state.seen
              .filter((request) => request.path.endsWith("/comments"))
              .every((request) => request.authorization === `Bearer ${GITHUB_TOKEN}`),
          );
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
          (seen) => seen.filter((request) => request.path.endsWith("/comments")).length === 2,
        );
        const [row] = yield* core.tasks((rows) => rows[0]?.["state"] === "working");
        assert.strictEqual(row!["state"], "working");
      }),
    );

    it.effect("a task no Mate took fails on GitHub too, saying why", () =>
      Effect.gen(function* () {
        const core = yield* withPool({ taskAcceptWithin: Duration.millis(200) });
        yield* core.issue(1);
        yield* core.github.seenWhere("the failure's comment", (seen) =>
          seen.some((request) => request.path.endsWith("/comments")),
        );
        // No Mate took it: none is named.
        assert.deepStrictEqual(yield* core.github.comments, [
          [
            "/repos/acme/tea-shop/issues/1/comments",
            `No automated Mate could take this up: ${UNTAKEN}`,
          ],
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
        yield* core.github.seenWhere(
          "the failure's comment",
          (seen) => seen.filter((request) => request.path.endsWith("/comments")).length === 2,
        );
        assert.deepStrictEqual((yield* core.github.comments).at(-1), [
          "/repos/acme/tea-shop/issues/1/comments",
          `P_ROBOT couldn't finish this: ${MATE_AWAY}`,
        ]);
      }),
    );

    it.effect(
      "an issue closed while its task is handed out is dropped and its Mate is free; one its Mate works on carries on",
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
          // A closed issue is no task to take; the Mate already on it carries on.
          const rows = yield* core.tasks((found) => found.length === 2);
          assert.deepStrictEqual(
            rows.map((row) => [row["number"], row["state"], row["mate_project_id"]]),
            [
              [1, "dropped", null],
              [2, "working", "P_ROBOT"],
            ],
          );
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
          const waiting = (number: number, repo: string) => core.sql`
            INSERT INTO hq_task (app_id, repo, number, title, body, url, delivery_id, state)
            VALUES (${core.appId}::uuid, ${repo}, ${number}, ${`Issue ${String(number)}`}, '',
              ${`https://github.com/${repo}/issues/${String(number)}`}, ${`waiting-${String(number)}`},
              'queued')`;
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
  });
});
