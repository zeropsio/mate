// @effect-diagnostics nodeBuiltinImport:off -- the tests reach Core as zcp and a person do: over HTTP and git.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";

import { type GitRun, gitClient } from "../test/harness/gitClient.ts";
import { addProject, mateWithChange, remoteOf, rowsWhere } from "../test/harness/mates.ts";
import {
  type Call,
  enrollMate,
  sessionFor,
  startCore,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { FakeWorld } from "../test/harness/zeropsFake.ts";

type Git = Effect.Success<typeof gitClient>;

/** A second Mate of the application, `projectId`, enrolled, with its open change in `appdev`. */
const siblingMate = (
  call: Call,
  fake: FakeWorld,
  owner: string,
  appId: string,
  projectId: string,
) =>
  Effect.gen(function* () {
    addProject(fake, projectId);
    const attached = yield* call("POST", `/api/apps/${appId}/projects`, {
      session: owner,
      body: { projectId, kind: "mate", mate: { name: "Bo", face: "face-2" } },
    });
    assert.strictEqual(attached.status, 201);
    const credential = yield* enrollMate(call, fake, projectId);
    const opened = yield* call("POST", "/api/mate/changes", {
      headers: { authorization: `Mate ${credential}` },
      body: { repo: "appdev", title: "Mate: appdev" },
    });
    return {
      credential,
      number: (opened.body as { readonly change: { readonly number: number } }).change.number,
    };
  });

/**
 * A Mate's checkout of `appdev` in `dir`: `commit` writes a file and commits it with `message`,
 * `push` sends HEAD to the branch of its change `number`, answering git's run and the head.
 */
const checkout = (git: Git, origin: string, credential: string, appId: string, dir: string) =>
  Effect.gen(function* () {
    yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), dir]);
    const work = NodePath.join(git.dir, dir);
    return {
      work,
      commit: (file: string, content: string, message: string) =>
        Effect.andThen(
          Effect.sync(() => NodeFS.writeFileSync(NodePath.join(work, file), content)),
          Effect.andThen(
            git.checked(["add", file], work),
            git.checked(["commit", "-m", message], work),
          ),
        ),
      push: (mateId: string, number: number) =>
        Effect.gen(function* () {
          const run: GitRun = yield* git.run(
            ["push", "origin", `HEAD:refs/heads/mate/${mateId}/${String(number)}`],
            work,
          );
          return { run, head: yield* git.checked(["rev-parse", "HEAD"], work) };
        }),
      main: Effect.andThen(
        git.checked(["fetch", "origin"], work),
        git.checked(["rev-parse", "origin/main"], work),
      ),
    };
  });

/** The change `number`'s head as HQ recorded it, once it is `head`. */
const recorded = (url: string, number: number, head: string) =>
  rowsWhere(
    url,
    `SELECT head FROM hq_change WHERE number = ${String(number)}`,
    (rows) => rows[0]?.["head"] === head,
  );

const merge = (call: Call, session: string, appId: string, number: number, expectedHead: string) =>
  call("POST", `/api/apps/${appId}/changes/appdev/${String(number)}/merge`, {
    session,
    body: { expectedHead },
  });

describe("a change merged into main, or closed", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a developer merges a change: one squash with its title, its crew's trailers and Mate-Change",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential, auth } = yield* mateWithChange(call, fake, owner);
          const watching = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, owner)}`,
          );
          yield* watching.next("snapshot");
          yield* call("PATCH", "/api/mate/changes/appdev/1", {
            headers: auth,
            body: { title: "Add a login page", body: "It adds a login page." },
          });
          const git = yield* gitClient;
          const ada = yield* checkout(git, origin, credential, appId, "ada");
          yield* ada.commit(
            "form.ts",
            "form\n",
            "Add the form\n\nCrew-Lane: ada\nCrew-Assignment: task-1",
          );
          yield* ada.commit(
            "style.ts",
            "style\n",
            "Style it\n\nCrew-Lane: ada\nCrew-Assignment: task-2",
          );
          const { head } = yield* ada.push("P_MATE", 1);
          yield* recorded(url, 1, head);

          const merged = yield* merge(call, owner, appId, 1, head);
          assert.strictEqual(merged.status, 200);
          const change = merged.body as Record<string, unknown>;
          const main = yield* ada.main;
          assert.deepStrictEqual(
            [change["state"], change["mergedSha"], change["landedHead"], change["head"]],
            ["merged", main, head, head],
          );
          assert.isString(change["mergedAt"]);
          // The person's socket carries it merged.
          let carried = false;
          for (let read = 0; read < 10 && !carried; read++) {
            const message = (yield* watching.next("changes")) as {
              readonly changes: ReadonlyArray<{ readonly state: string }>;
            };
            carried = message.changes.some((entry) => entry.state === "merged");
          }
          assert.isTrue(carried);
          // One commit on main, its parent the main the change was based on.
          assert.strictEqual(
            yield* git.checked(["log", "-1", "--format=%B", "origin/main"], ada.work),
            [
              "Add a login page (#1)",
              "",
              "It adds a login page.",
              "",
              "Crew-Lane: ada",
              "Crew-Assignment: task-1",
              "Crew-Assignment: task-2",
              "Mate-Change: P_MATE/1",
            ].join("\n"),
          );
          assert.strictEqual(
            yield* git.checked(["rev-list", "--count", "origin/main"], ada.work),
            "2",
          );
          yield* rowsWhere(
            url,
            "SELECT data->>'mergedSha' AS sha FROM hq_git_event WHERE kind = 'merged'",
            (rows) => rows[0]?.["sha"] === main,
          );
          // The Mate reads its outcome; its branch stays, and takes no more pushes.
          const self = (yield* call("GET", "/api/mate/self", { headers: auth })).body as {
            readonly changes: ReadonlyArray<Record<string, unknown>>;
          };
          assert.deepStrictEqual(self.changes[0], {
            repo: "appdev",
            number: 1,
            state: "merged",
            head,
            mergedSha: main,
            landedHead: head,
          });
          yield* ada.commit("later.ts", "later\n", "Later");
          const later = yield* ada.push("P_MATE", 1);
          assert.notStrictEqual(later.run.code, 0);
          assert.include(later.run.stderr, "change_closed");
          assert.deepStrictEqual((yield* merge(call, owner, appId, 1, head)).body, {
            code: "conflict",
            reason: "change_not_open",
          });
        }),
    );

    it.effect("a merge carries every task of the change, however many commits it took", () =>
      Effect.gen(function* () {
        const { call, fake, origin, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, credential } = yield* mateWithChange(call, fake, owner);
        const git = yield* gitClient;
        const ada = yield* checkout(git, origin, credential, appId, "ada");
        for (let i = 1; i <= 150; i++) {
          yield* git.checked(
            [
              "commit",
              "--allow-empty",
              "-q",
              "-m",
              `Task ${String(i)}`,
              "-m",
              `Crew-Lane: ada\nCrew-Assignment: task-${String(i)}`,
            ],
            ada.work,
          );
        }
        yield* ada.commit("a.txt", "a\n", "Fold\n\nCrew-Assignment: a long\n  task");
        const { head } = yield* ada.push("P_MATE", 1);
        yield* recorded(url, 1, head);
        assert.strictEqual((yield* merge(call, owner, appId, 1, head)).status, 200);
        yield* ada.main;
        const assignments = yield* git.checked(
          [
            "log",
            "-1",
            "--format=%(trailers:key=Crew-Assignment,valueonly,separator=%x0A)",
            "origin/main",
          ],
          ada.work,
        );
        assert.deepStrictEqual(assignments.split("\n"), [
          ...Array.from({ length: 150 }, (_, i) => `task-${String(i + 1)}`),
          "a long task",
        ]);
        assert.strictEqual(
          yield* git.checked(
            ["log", "-1", "--format=%(trailers:key=Crew-Lane,valueonly)", "origin/main"],
            ada.work,
          ),
          "ada",
        );
      }),
    );

    it.effect(
      "a merge is refused as git sees the change, and to whoever does not develop the application",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential } = yield* mateWithChange(call, fake, owner);
          const bo = yield* siblingMate(call, fake, owner, appId, "P_MATE2");
          const git = yield* gitClient;
          const ada = yield* checkout(git, origin, credential, appId, "ada");
          const boWork = yield* checkout(git, origin, bo.credential, appId, "bo");
          const before = yield* ada.main;
          // Both change one file.
          yield* ada.commit("a.txt", "ada\n", "Ada's a");
          const adaHead = (yield* ada.push("P_MATE", 1)).head;
          yield* boWork.commit("a.txt", "bo\n", "Bo's a");
          const boHead = (yield* boWork.push("P_MATE2", bo.number)).head;
          yield* recorded(url, 1, adaHead);
          yield* recorded(url, bo.number, boHead);

          const refused = (answer: { readonly status: number; readonly body: unknown }) => [
            answer.status,
            answer.body,
          ];
          // Org Read only sees the application, does not develop it; a Developer sees nothing.
          const reader = yield* sessionFor(call, "door-reader");
          assert.deepStrictEqual(refused(yield* merge(call, reader, appId, 1, adaHead)), [
            403,
            { code: "forbidden", reason: "not_app_developer" },
          ]);
          const dev = yield* sessionFor(call, "door-dev");
          assert.deepStrictEqual(refused(yield* merge(call, dev, appId, 1, adaHead)), [
            403,
            { code: "forbidden", reason: "app_not_seen" },
          ]);
          // Not the head the person was shown: nothing merges.
          assert.deepStrictEqual(refused(yield* merge(call, owner, appId, 1, before)), [
            409,
            { code: "conflict", reason: "head_moved" },
          ]);
          assert.strictEqual(yield* ada.main, before);

          assert.strictEqual((yield* merge(call, owner, appId, 1, adaHead)).status, 200);
          assert.deepStrictEqual(refused(yield* merge(call, owner, appId, bo.number, boHead)), [
            409,
            { code: "conflict", reason: "conflict" },
          ]);

          // Ada's next change is main itself: on main already.
          const next = (yield* call("POST", "/api/mate/changes", {
            headers: { authorization: `Mate ${credential}` },
            body: { repo: "appdev", title: "Mate: appdev" },
          })).body as { readonly change: { readonly number: number } };
          const main = yield* ada.main;
          yield* git.checked(["checkout", "-q", "origin/main"], ada.work);
          yield* ada.push("P_MATE", next.change.number);
          yield* recorded(url, next.change.number, main);
          assert.deepStrictEqual(
            refused(yield* merge(call, owner, appId, next.change.number, main)),
            [409, { code: "conflict", reason: "already_merged" }],
          );
        }),
    );

    it.effect(
      "a squash whose record failed to land is recorded merged when the merge is asked again",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential } = yield* mateWithChange(call, fake, owner);
          const git = yield* gitClient;
          const ada = yield* checkout(git, origin, credential, appId, "ada");
          const before = yield* ada.main;
          yield* ada.commit("a.txt", "ada\n", "Ada's a");
          const { head } = yield* ada.push("P_MATE", 1);
          yield* recorded(url, 1, head);

          // The merge's record write dies after git has squashed: its event waits on a lock, and
          // its connection is cut.
          const db = yield* PgConnection.make({ url: Redacted.make(url) });
          yield* db.query("BEGIN");
          yield* db.query("LOCK TABLE hq_git_event IN SHARE MODE");
          const merging = yield* Effect.forkChild(merge(call, owner, appId, 1, head));
          yield* rowsWhere(
            url,
            `SELECT pg_terminate_backend(pid) AS cut FROM pg_stat_activity
               WHERE wait_event_type = 'Lock' AND query LIKE '%INSERT INTO hq_git_event%'`,
            (rows) => rows.length > 0,
          );
          yield* db.query("ROLLBACK");
          assert.strictEqual((yield* Fiber.join(merging)).status, 503);
          const squashed = yield* ada.main;
          assert.notStrictEqual(squashed, before);
          const detail = (yield* call("GET", `/api/apps/${appId}/changes/appdev/1`, {
            session: owner,
          })).body as { readonly change: { readonly state: string } };
          assert.strictEqual(detail.change.state, "open");

          // Asked again: the squash on main is found by its Mate-Change, and recorded.
          const again = yield* merge(call, owner, appId, 1, head);
          assert.strictEqual(again.status, 200);
          const change = again.body as Record<string, unknown>;
          assert.deepStrictEqual(
            [change["state"], change["mergedSha"], change["landedHead"]],
            ["merged", squashed, head],
          );
          assert.strictEqual(yield* ada.main, squashed);
        }),
    );

    it.effect(
      "merges of one repository land one after another, each on the main the last left",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential } = yield* mateWithChange(call, fake, owner);
          const bo = yield* siblingMate(call, fake, owner, appId, "P_MATE2");
          const git = yield* gitClient;
          const ada = yield* checkout(git, origin, credential, appId, "ada");
          const boWork = yield* checkout(git, origin, bo.credential, appId, "bo");
          yield* ada.commit("ada.txt", "ada\n", "Ada's file");
          const adaHead = (yield* ada.push("P_MATE", 1)).head;
          yield* boWork.commit("bo.txt", "bo\n", "Bo's file");
          const boHead = (yield* boWork.push("P_MATE2", bo.number)).head;
          yield* recorded(url, 1, adaHead);
          yield* recorded(url, bo.number, boHead);

          const merged = yield* Effect.all(
            [merge(call, owner, appId, 1, adaHead), merge(call, owner, appId, bo.number, boHead)],
            { concurrency: "unbounded" },
          );
          assert.deepStrictEqual(
            merged.map((answer) => answer.status),
            [200, 200],
          );
          yield* ada.main;
          assert.strictEqual(
            yield* git.checked(["ls-tree", "--name-only", "origin/main"], ada.work),
            "ada.txt\nbo.txt",
          );
          assert.strictEqual(
            yield* git.checked(["rev-list", "--count", "origin/main"], ada.work),
            "3",
          );
        }),
    );

    it.effect(
      "a developer closes a change without merging: its branch stays, and takes no pushes",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential } = yield* mateWithChange(call, fake, owner);
          const git = yield* gitClient;
          const ada = yield* checkout(git, origin, credential, appId, "ada");
          yield* ada.commit("a.txt", "ada\n", "Ada's a");
          const { head } = yield* ada.push("P_MATE", 1);
          yield* recorded(url, 1, head);
          const close = (session: string) =>
            call("POST", `/api/apps/${appId}/changes/appdev/1/close`, { session });

          const reader = yield* sessionFor(call, "door-reader");
          assert.deepStrictEqual((yield* close(reader)).body, {
            code: "forbidden",
            reason: "not_app_developer",
          });
          const closed = yield* close(owner);
          assert.strictEqual(closed.status, 200);
          const change = closed.body as Record<string, unknown>;
          assert.deepStrictEqual([change["state"], change["head"]], ["closed", head]);
          assert.isString(change["closedAt"]);
          yield* rowsWhere(
            url,
            "SELECT kind FROM hq_git_event WHERE kind = 'closed'",
            (rows) => rows.length === 1,
          );
          assert.strictEqual(
            yield* git.checked(["ls-remote", "origin", "refs/heads/mate/P_MATE/1"], ada.work),
            `${head}\trefs/heads/mate/P_MATE/1`,
          );
          yield* ada.commit("b.txt", "b\n", "More");
          const later = yield* ada.push("P_MATE", 1);
          assert.include(later.run.stderr, "change_closed");
          for (const answer of [yield* close(owner), yield* merge(call, owner, appId, 1, head)]) {
            assert.deepStrictEqual(
              [answer.status, answer.body],
              [409, { code: "conflict", reason: "change_not_open" }],
            );
          }
        }),
    );
  });
});
