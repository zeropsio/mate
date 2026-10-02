// @effect-diagnostics nodeBuiltinImport:off -- the tests reach Core as zcp does: over HTTP and git.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";

import { gitClient } from "../test/harness/gitClient.ts";
import {
  type Call,
  enrollMate,
  sessionFor,
  startCore,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { FakeWorld } from "../test/harness/zeropsFake.ts";

/** The owner makes an application and attaches `projectId` to it as a Mate, which enrolls. */
const mateInApp = (
  call: Call,
  fake: FakeWorld,
  owner: string,
  projectId: string,
  appName: string,
) =>
  Effect.gen(function* () {
    const app = yield* call("POST", "/api/apps", { session: owner, body: { name: appName } });
    const appId = (app.body as { readonly id: string }).id;
    const attached = yield* call("POST", `/api/apps/${appId}/projects`, {
      session: owner,
      body: { projectId, kind: "mate", mate: { name: "Ada", face: "face-1" } },
    });
    assert.strictEqual(attached.status, 201);
    const credential = yield* enrollMate(call, fake, projectId);
    return { appId, credential, auth: { authorization: `Mate ${credential}` } };
  });

/** Another project of the org beside the rig's own. */
const addProject = (fake: FakeWorld, id: string) =>
  fake.projects.push({
    id,
    orgId: "ORG",
    name: id,
    status: "ACTIVE",
    tags: [],
    userRoles: [],
    publicZone: `${id}.prg1-zerops.zone`,
  });

/** git's address of a repository at Core, the Mate's credential in it. */
const remoteOf = (origin: string, credential: string, appId: string, repo: string) =>
  `${origin.replace("http://", `http://mate:${credential}@`)}/git/${appId}/${repo}.git`;

/** The rows `query` answers on Core's database, once `matches` holds of them; fails after ten seconds. */
const rowsWhere = (
  url: string,
  query: string,
  matches: (rows: ReadonlyArray<Record<string, unknown>>) => boolean,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const db = yield* PgConnection.make({ url: Redacted.make(url) });
      return yield* db.query(query).pipe(
        Effect.map((result) => result.rows as ReadonlyArray<Record<string, unknown>>),
        Effect.filterOrFail(matches),
        Effect.retry(Schedule.spaced(Duration.millis(50))),
        Effect.timeout(Duration.seconds(10)),
      );
    }),
  ).pipe(Effect.orDie);

describe("a Mate's changes in HQ", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("a Mate makes its repository once, and main starts with one commit of HQ's", () =>
      Effect.gen(function* () {
        const { call, fake, origin } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, credential, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
        for (const _ of [1, 2]) {
          const made = yield* call("POST", "/api/mate/repos", {
            headers: auth,
            body: { name: "appdev" },
          });
          assert.deepStrictEqual([made.status, made.body], [200, { appId, name: "appdev" }]);
        }
        const git = yield* gitClient;
        yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), "work"]);
        const work = NodePath.join(git.dir, "work");
        assert.strictEqual(
          yield* git.checked(["log", "--format=%an|%s", "origin/main"], work),
          "HQ|Initial commit",
        );
        assert.strictEqual(yield* git.checked(["ls-tree", "-r", "origin/main"], work), "");
      }),
    );

    it.effect(
      "a Mate opens one change per repository, and pushes only to that change's branch",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
          yield* call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
          const open = (title: string, headers = auth, repo = "appdev") =>
            call("POST", "/api/mate/changes", { headers, body: { repo, title } });

          const opened = yield* open("Mate: appdev");
          assert.strictEqual(opened.status, 200);
          const { change, created } = opened.body as {
            readonly change: Record<string, unknown>;
            readonly created: boolean;
          };
          assert.isTrue(created);
          assert.match(String(change["openedAt"]), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u);
          assert.deepStrictEqual(change, {
            appId,
            repo: "appdev",
            number: 1,
            mateProjectId: "P_MATE",
            title: "Mate: appdev",
            body: "",
            state: "open",
            head: null,
            mergedSha: null,
            landedHead: null,
            openedAt: change["openedAt"],
            mergedAt: null,
            closedAt: null,
          });
          // Its open change again, as it is: the title asked for now opens nothing.
          assert.deepStrictEqual((yield* open("Add a login page")).body, {
            change,
            created: false,
          });

          // Another Mate of the application takes the repository's next number.
          addProject(fake, "P_MATE2");
          const second = yield* call("POST", `/api/apps/${appId}/projects`, {
            session: owner,
            body: { projectId: "P_MATE2", kind: "mate", mate: { name: "Bo", face: "face-2" } },
          });
          assert.strictEqual(second.status, 201);
          const other = { authorization: `Mate ${yield* enrollMate(call, fake, "P_MATE2")}` };
          const next = (yield* open("Mate: appdev", other)).body as {
            readonly change: { readonly number: number };
          };
          assert.strictEqual(next.change.number, 2);

          const refused = yield* open("Mate: api", auth, "api");
          assert.deepStrictEqual(
            [refused.status, refused.body],
            [404, { code: "repo_not_found", reason: "repo_not_found" }],
          );

          const git = yield* gitClient;
          yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), "work"]);
          const work = NodePath.join(git.dir, "work");
          yield* git.checked(["commit", "--allow-empty", "-m", "Add a login page"], work);
          yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);
          for (const ref of ["mate/P_MATE/2", "main", "mate/P_MATE2/2", "elsewhere"]) {
            const push = yield* git.run(["push", "origin", `HEAD:refs/heads/${ref}`], work);
            assert.notStrictEqual(push.code, 0, `a push to ${ref} landed`);
          }
        }),
    );

    it.effect("git serves a Mate only its own application's repositories", () =>
      Effect.gen(function* () {
        const { call, fake, origin } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const shop = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
        yield* call("POST", "/api/mate/repos", { headers: shop.auth, body: { name: "appdev" } });
        addProject(fake, "P_MATE2");
        const other = yield* mateInApp(call, fake, owner, "P_MATE2", "Other");
        const git = yield* gitClient;
        const lsRemote = (credential: string, appId: string) =>
          git.run(["ls-remote", remoteOf(origin, credential, appId, "appdev")]);

        assert.strictEqual((yield* lsRemote(shop.credential, shop.appId)).code, 0);
        // The application in the path is another one than HQ holds this Mate in.
        const elsewhere = yield* lsRemote(other.credential, shop.appId);
        assert.notStrictEqual(elsewhere.code, 0);
        assert.include(elsewhere.stderr, "403");
        // No credential, a forged one, or a user other than `mate`: git is asked for one.
        for (const remote of [
          `${origin}/git/${shop.appId}/appdev.git`,
          remoteOf(origin, `${shop.credential}x`, shop.appId, "appdev"),
          remoteOf(origin, shop.credential, shop.appId, "appdev").replace("mate:", "ada:"),
        ]) {
          const refused = yield* git.run(["ls-remote", remote]);
          assert.notStrictEqual(refused.code, 0);
          assert.match(refused.stderr, /Authentication failed|could not read Username/u);
        }

        // A Mate in no application has no repository and no git.
        addProject(fake, "P_LONE");
        yield* call("POST", "/api/mates", {
          session: owner,
          body: { projectId: "P_LONE", name: "Cy", face: "face-3" },
        });
        const lone = yield* enrollMate(call, fake, "P_LONE");
        const refused = yield* call("POST", "/api/mate/repos", {
          headers: { authorization: `Mate ${lone}` },
          body: { name: "appdev" },
        });
        assert.deepStrictEqual(
          [refused.status, refused.body],
          [403, { code: "forbidden", reason: "mate_not_in_app" }],
        );
        assert.include((yield* lsRemote(lone, shop.appId)).stderr, "403");
      }),
    );

    it.effect("a standby answers git and a Mate's writes 503 with Retry-After", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(false);
        yield* untilHealth(call, "standby");
        for (const [method, path] of [
          ["POST", "/api/mate/repos"],
          ["POST", "/api/mate/changes"],
          ["GET", "/git/app/appdev.git/info/refs?service=git-upload-pack"],
          ["POST", "/git/app/appdev.git/git-receive-pack"],
        ] as const) {
          const answer = yield* call(method, path);
          assert.deepStrictEqual(
            [answer.status, answer.body, answer.headers.get("retry-after")],
            [503, { code: "not_active" }, "5"],
            path,
          );
        }
      }),
    );

    it.effect(
      "a standby never opens git, so never sweeps; taking the lead, it sweeps and reconciles the log",
      () =>
        Effect.gen(function* () {
          const first = yield* startCore(true);
          yield* untilHealth(first.call, "active");
          const owner = yield* sessionFor(first.call, "door-owner");
          const { appId, credential, auth } = yield* mateInApp(
            first.call,
            first.fake,
            owner,
            "P_MATE",
            "Shop",
          );
          yield* first.call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
          yield* first.call("POST", "/api/mate/changes", {
            headers: auth,
            body: { repo: "appdev", title: "Mate: appdev" },
          });
          const git = yield* gitClient;
          yield* git.checked([
            "clone",
            remoteOf(first.origin, credential, appId, "appdev"),
            "work",
          ]);
          const work = NodePath.join(git.dir, "work");
          yield* git.checked(["commit", "--allow-empty", "-m", "Add a login page"], work);
          yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);
          const head = yield* git.checked(["rev-parse", "HEAD"], work);
          const main = yield* git.checked(["rev-parse", "origin/main"], work);
          // The push reached the change's record, and main's start the repository's.
          yield* rowsWhere(
            first.url,
            "SELECT head FROM hq_change",
            (rows) => rows[0]?.["head"] === head,
          );
          yield* rowsWhere(
            first.url,
            "SELECT main_head FROM hq_repo",
            (rows) => rows[0]?.["main_head"] === main,
          );

          // What a sweep removes: an earlier instance's staging. And what an event lost leaves.
          const debris = NodePath.join(first.gitRoot, appId, ".build-left");
          NodeFS.mkdirSync(debris);
          yield* rowsWhere(first.url, "UPDATE hq_change SET head = NULL RETURNING 1; ", () => true);
          yield* rowsWhere(
            first.url,
            "UPDATE hq_repo SET main_head = NULL RETURNING 1",
            () => true,
          );

          const next = yield* startCore(true, { url: first.url, gitRoot: first.gitRoot });
          yield* untilHealth(next.call, "standby");
          yield* Effect.sleep(Duration.millis(500));
          assert.isTrue(NodeFS.existsSync(debris), "a standby swept the leader's staging");

          yield* first.stop;
          yield* untilHealth(next.call, "active");
          yield* rowsWhere(
            first.url,
            "SELECT head FROM hq_change",
            (rows) => rows[0]?.["head"] === head,
          );
          yield* rowsWhere(
            first.url,
            "SELECT main_head FROM hq_repo",
            (rows) => rows[0]?.["main_head"] === main,
          );
          assert.isFalse(NodeFS.existsSync(debris), "taking the lead, git swept nothing");
          const events = yield* rowsWhere(
            first.url,
            "SELECT kind, number, data FROM hq_git_event ORDER BY seq",
            (rows) => rows.length >= 5,
          );
          assert.deepStrictEqual(
            events.map((row) => [
              row["kind"],
              row["number"],
              row["data"] as { by?: string; reconciled?: boolean },
            ]),
            [
              ["main_moved", null, { old: null, new: main, by: "commit" }],
              ["opened", 1, { mateProjectId: "P_MATE" }],
              ["pushed", 1, { ref: "refs/heads/mate/P_MATE/1", old: "0".repeat(40), new: head }],
              ["main_moved", null, { old: null, new: main, by: "reconcile" }],
              [
                "pushed",
                1,
                { ref: "refs/heads/mate/P_MATE/1", old: null, new: head, reconciled: true },
              ],
            ],
          );
        }),
    );
  });
});
