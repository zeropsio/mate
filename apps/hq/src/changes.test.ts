import { scopeReset, scopeValue, nextScopeValue } from "../test/harness/scopes.ts";
// @effect-diagnostics nodeBuiltinImport:off -- the tests reach Core as zcp does: over HTTP and git.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { gitClient } from "../test/harness/gitClient.ts";
import {
  addProject,
  mateInApp,
  mateWithChange,
  remoteOf,
  rowsWhere,
} from "../test/harness/mates.ts";
import {
  enrollMate,
  sessionFor,
  startCore,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

/** A PNG's signature and a little more: what HQ checks a picture by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const RASTERS = [
  ["image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ["image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
  ["image/gif", new Uint8Array(ascii("GIF89a"))],
  ["image/webp", new Uint8Array([...ascii("RIFF"), 4, 0, 0, 0, ...ascii("WEBP")])],
  [
    "image/avif",
    new Uint8Array([0, 0, 0, 24, ...ascii("ftypavif"), 0, 0, 0, 0, ...ascii("mif1avif")]),
  ],
] as const;

describe("a Mate's changes in HQ", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a delivery main already has opens nothing, even after a squash or beside an open change",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
          yield* call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
          const git = yield* gitClient;
          yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), "delivery"]);
          const work = NodePath.join(git.dir, "delivery");
          const deliver = (tree: string) =>
            call("POST", "/api/mate/changes", {
              headers: auth,
              body: { repo: "appdev", title: "The task", tree },
            });
          const nothing = { change: null, created: false, reason: "nothing_to_deliver" };
          assert.deepStrictEqual(
            (yield* deliver(yield* git.checked(["rev-parse", "HEAD^{tree}"], work))).body,
            nothing,
          );
          NodeFS.writeFileSync(NodePath.join(work, "app.txt"), "app\n");
          yield* git.checked(["add", "."], work);
          yield* git.checked(["commit", "-m", "First task"], work);
          const tree = yield* git.checked(["rev-parse", "HEAD^{tree}"], work);
          const first = yield* deliver(tree);
          assert.isTrue((first.body as { created: boolean }).created);
          yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);
          const head = yield* git.checked(["rev-parse", "HEAD"], work);
          yield* rowsWhere(
            url,
            "SELECT head FROM hq_change WHERE number = 1",
            (rows) => rows[0]?.["head"] === head,
          );
          const landed = yield* call("POST", `/api/apps/${appId}/changes/appdev/1/merge`, {
            session: owner,
            body: { expectedHead: head },
          });
          assert.strictEqual(landed.status, 200);
          assert.deepStrictEqual((yield* deliver(tree)).body, nothing);
          // A local branch still holding the squashed commits: only its new task belongs to #2.
          NodeFS.writeFileSync(NodePath.join(work, "next.txt"), "next\n");
          yield* git.checked(["add", "."], work);
          yield* git.checked(["commit", "-m", "Next task"], work);
          const next = yield* git.checked(["rev-parse", "HEAD"], work);
          assert.isTrue(
            (
              (yield* deliver(yield* git.checked(["rev-parse", "HEAD^{tree}"], work))).body as {
                created: boolean;
              }
            ).created,
          );
          yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/P_MATE/2"], work);
          yield* rowsWhere(
            url,
            "SELECT head FROM hq_change WHERE number = 2",
            (rows) => rows[0]?.["head"] === next,
          );
          const detail = yield* call("GET", `/api/apps/${appId}/changes/appdev/2`, {
            session: owner,
          });
          assert.deepStrictEqual(
            (detail.body as { commits: { sha: string }[] }).commits.map((c) => c.sha),
            [next],
          );
          assert.deepStrictEqual((yield* deliver(tree)).body, nothing);
          const list = yield* call("GET", `/api/apps/${appId}/changes`, { session: owner });
          assert.strictEqual((list.body as { changes: unknown[] }).changes.length, 2);
        }),
    );

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
            updatedAt: change["openedAt"],
            // Nothing pushed: nothing to judge yet.
            mergeability: "unknown",
            behind: false,
            // Not described yet: a draft.
            ready: false,
            // Nothing said on it yet.
            comments: 0,
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
            body: { projectId: "P_MATE2", kind: "mate", mate: { face: "face-2" } },
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

    // H2: a repository that did not converge at the takeover is refused its Mate, why named, while
    // the application's others serve.
    it.effect("git refuses a quarantined repository, naming why, and serves the others", () =>
      Effect.gen(function* () {
        const first = yield* startCore(true);
        yield* untilHealth(first.call, "active");
        const owner = yield* sessionFor(first.call, "door-owner");
        const shop = yield* mateInApp(first.call, first.fake, owner, "P_MATE", "Shop");
        for (const name of ["appdev", "web"]) {
          yield* first.call("POST", "/api/mate/repos", { headers: shop.auth, body: { name } });
        }
        yield* first.stop;
        // web's config is no file git can read: it cannot converge.
        const config = NodePath.join(first.gitRoot, shop.appId, "web.git", "config");
        NodeFS.rmSync(config);
        NodeFS.mkdirSync(config);
        const next = yield* startCore(true, { url: first.url, gitRoot: first.gitRoot });
        const refs = (repo: string) =>
          next.call("GET", `/git/${shop.appId}/${repo}.git/info/refs?service=git-upload-pack`, {
            headers: {
              authorization: `Basic ${Buffer.from(`mate:${shop.credential}`).toString("base64")}`,
            },
          });
        yield* refs("appdev").pipe(
          Effect.filterOrFail((answer) => answer.status === 200),
          Effect.retry(Schedule.spaced(Duration.millis(50))),
          Effect.timeout(Duration.seconds(10)),
        );
        const web = yield* refs("web");
        assert.deepStrictEqual(
          [web.status, web.body],
          [503, { code: "repo_unavailable", reason: "converge_git_failed" }],
        );
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
        // A fetch is `fetch_repo`'s to refuse; a push passes `open_change` in its own application
        // and is still refused the other's repository, by `fetch_repo`.
        const refs = (service: string) =>
          call("GET", `/git/${shop.appId}/appdev.git/info/refs?service=${service}`, {
            headers: {
              authorization: `Basic ${Buffer.from(`mate:${other.credential}`).toString("base64")}`,
            },
          });
        const fetching = yield* refs("git-upload-pack");
        assert.deepStrictEqual(
          [fetching.status, fetching.body],
          [403, { code: "forbidden", reason: "not_your_app" }],
        );
        // Credential misses are limited per client address, like the doors; a Mate's own passes.
        const knock = (credential: string | undefined) =>
          Effect.map(
            call("GET", `/git/${shop.appId}/appdev.git/info/refs?service=git-upload-pack`, {
              headers: {
                "x-real-ip": "10.0.0.7",
                ...(credential === undefined
                  ? {}
                  : {
                      authorization: `Basic ${Buffer.from(`mate:${credential}`).toString("base64")}`,
                    }),
              },
            }),
            (answer) => answer.status,
          );
        const misses = yield* Effect.forEach(Array.from({ length: 11 }), () => knock("forged"));
        assert.deepStrictEqual(misses, [...Array(10).fill(401), 429]);
        // git's own first request presents no credential: never a guess, never limited.
        assert.strictEqual(yield* knock(undefined), 401);
        assert.strictEqual(yield* knock(shop.credential), 200);
        const pushing = yield* refs("git-receive-pack");
        assert.deepStrictEqual(
          [pushing.status, pushing.body],
          [403, { code: "forbidden", reason: "not_your_app" }],
        );
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
          body: { projectId: "P_LONE", face: "face-3" },
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
          // The push reached the change's record, and main's start the repository's — this one's:
          // the application has its recipe's beside it, whose start may be another commit.
          yield* rowsWhere(
            first.url,
            "SELECT head FROM hq_change WHERE repo = 'appdev'",
            (rows) => rows[0]?.["head"] === head,
          );
          yield* rowsWhere(
            first.url,
            "SELECT main_head FROM hq_repo WHERE name = 'appdev'",
            (rows) => rows[0]?.["main_head"] === main,
          );

          // What a sweep removes: an earlier instance's staging. And what an event lost leaves.
          const debris = NodePath.join(first.gitRoot, appId, ".build-left");
          NodeFS.mkdirSync(debris);
          yield* rowsWhere(
            first.url,
            "UPDATE hq_change SET head = NULL WHERE repo = 'appdev' RETURNING 1",
            () => true,
          );
          yield* rowsWhere(
            first.url,
            "UPDATE hq_repo SET main_head = NULL WHERE name = 'appdev' RETURNING 1",
            () => true,
          );

          const next = yield* startCore(true, { url: first.url, gitRoot: first.gitRoot });
          yield* untilHealth(next.call, "standby");
          // A standby holds no git: it never opened it, so it swept nothing.
          assert.isTrue(
            Exit.isFailure(yield* Effect.exit(next.gitHost.git)),
            "a standby opened git",
          );
          assert.isTrue(NodeFS.existsSync(debris), "a standby swept the leader's staging");

          yield* first.stop;
          // Taking the lead, it opens git — sweeps, converges, follows the refs into the log — and
          // its record ticks once that is done.
          yield* Stream.runHead(Stream.filter(next.gitHost.recorded, (tick) => tick > 0));
          const now = (query: string) => rowsWhere(first.url, query, () => true);
          assert.deepStrictEqual(
            [
              (yield* now("SELECT head FROM hq_change WHERE repo = 'appdev'"))[0]?.["head"],
              (yield* now("SELECT main_head FROM hq_repo WHERE name = 'appdev'"))[0]?.["main_head"],
            ],
            [head, main],
          );
          assert.isFalse(NodeFS.existsSync(debris), "taking the lead, git swept nothing");
          const events = yield* now(
            "SELECT kind, number, data FROM hq_git_event WHERE repo = 'appdev' ORDER BY seq",
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

    it.effect(
      "a Mate retitles, describes and illustrates its open change, and only while it is open",
      () =>
        Effect.gen(function* () {
          const { call, fake, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, auth } = yield* mateWithChange(call, fake, owner);
          const edit = (body: unknown, number = 1) =>
            call("PATCH", `/api/mate/changes/appdev/${String(number)}`, { headers: auth, body });
          const attach = (bytes: Uint8Array, contentType = "image/png") =>
            call("POST", "/api/mate/changes/appdev/1/attachments", {
              headers: { ...auth, "content-type": contentType },
              body: bytes,
            });

          yield* Effect.sleep(Duration.millis(5));
          const retitled = yield* edit({ title: "Add a login page" });
          const words = retitled.body as {
            readonly title: string;
            readonly openedAt: string;
            readonly updatedAt: string;
          };
          assert.deepStrictEqual([retitled.status, words.title], [200, "Add a login page"]);
          // An edit of its words moves the change.
          assert.isAbove(Date.parse(words.updatedAt), Date.parse(words.openedAt));
          const described = (yield* edit({ body: "It adds **a login page**." })).body as {
            readonly title: string;
            readonly body: string;
          };
          assert.deepStrictEqual(
            [described.title, described.body],
            ["Add a login page", "It adds **a login page**."],
          );
          assert.deepStrictEqual(
            [(yield* edit({})).status, (yield* edit({ title: "x".repeat(121) })).status],
            [400, 400],
          );
          // The longest description, in the widest characters, is still a description.
          const longest = "🙂".repeat(20_000);
          assert.strictEqual(
            ((yield* edit({ body: longest })).body as { body: string }).body,
            longest,
          );
          for (const path of ["appdev/0", "appdev/one", "app.dev/1"]) {
            const named = yield* call("PATCH", `/api/mate/changes/${path}`, {
              headers: auth,
              body: { title: "Elsewhere" },
            });
            assert.deepStrictEqual([named.status, named.body], [400, { code: "invalid" }], path);
          }
          // `can` decides: no such change to word.
          const none = yield* edit({ title: "Elsewhere" }, 9);
          assert.deepStrictEqual(
            [none.status, none.body],
            [404, { code: "change_not_found", reason: "unknown_change" }],
          );

          for (const [type, bytes] of RASTERS) {
            const uploaded = yield* attach(bytes, type);
            assert.strictEqual(uploaded.status, 200, type);
            const path = (uploaded.body as { path: string }).path;
            const picture = yield* call("GET", path, { session: owner });
            assert.deepStrictEqual(
              [picture.status, picture.headers.get("content-type"), [...picture.bytes]],
              [200, type, [...bytes]],
            );
          }
          const kept = yield* attach(PNG);
          assert.strictEqual(kept.status, 200);
          const { id, path } = kept.body as { readonly id: string; readonly path: string };
          assert.strictEqual(path, `/api/apps/${appId}/changes/appdev/1/attachments/${id}`);
          for (const [bytes, contentType] of [
            [new Uint8Array([1, 2, 3]), "image/png"],
            [PNG, "image/jpeg"],
          ] as const) {
            assert.deepStrictEqual((yield* attach(bytes, contentType)).body, {
              code: "invalid",
              reason: "not_raster",
            });
          }
          const tooLarge = yield* attach(new Uint8Array(20 * 1024 * 1024 + 1));
          assert.deepStrictEqual([tooLarge.status, tooLarge.body], [413, { code: "too_large" }]);

          // Another Mate of the application: the change is not its own.
          fake.projects.push({ ...fake.projects.find((p) => p.id === "P_MATE")!, id: "P_MATE2" });
          yield* call("POST", `/api/apps/${appId}/projects`, {
            session: owner,
            body: { projectId: "P_MATE2", kind: "mate", mate: { face: "face-2" } },
          });
          const other = { authorization: `Mate ${yield* enrollMate(call, fake, "P_MATE2")}` };
          const foreign = yield* call("PATCH", "/api/mate/changes/appdev/1", {
            headers: other,
            body: { title: "Mine now" },
          });
          // `can` decides: a sibling Mate's change is none of its own, and no picture goes on it.
          assert.deepStrictEqual(
            [foreign.status, foreign.body],
            [403, { code: "forbidden", reason: "not_your_change" }],
          );
          const foreignPicture = yield* call("POST", "/api/mate/changes/appdev/1/attachments", {
            headers: { ...other, "content-type": "image/png" },
            body: PNG,
          });
          assert.deepStrictEqual(
            [foreignPicture.status, foreignPicture.body],
            [403, { code: "forbidden", reason: "not_your_change" }],
          );

          // Merged (by a person, through HQ): its words and pictures are settled.
          yield* rowsWhere(url, "UPDATE hq_change SET state = 'merged' RETURNING 1", () => true);
          const settled = { code: "conflict", reason: "change_not_open" };
          assert.deepStrictEqual(
            [(yield* edit({ body: "More" })).status, (yield* edit({ body: "More" })).body],
            [409, settled],
          );
          assert.deepStrictEqual((yield* attach(PNG)).body, settled);
        }),
    );

    it.effect("a change is ready for review only at the head the Mate last described it at", () =>
      Effect.gen(function* () {
        const { call, fake, origin, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, credential, auth } = yield* mateWithChange(call, fake, owner);
        const edit = (body: unknown) =>
          Effect.map(
            call("PATCH", "/api/mate/changes/appdev/1", { headers: auth, body }),
            (answer) => (answer.body as { ready: boolean }).ready,
          );
        const listed = Effect.map(
          call("GET", `/api/apps/${appId}/changes`, { session: owner }),
          (answer) => (answer.body as { changes: ReadonlyArray<{ ready: boolean }> }).changes,
        );
        const detail = Effect.map(
          call("GET", `/api/apps/${appId}/changes/appdev/1`, { session: owner }),
          (answer) => (answer.body as { change: { ready: boolean } }).change.ready,
        );
        const git = yield* gitClient;
        yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), "work"]);
        const work = NodePath.join(git.dir, "work");
        const push = (subject: string) =>
          Effect.gen(function* () {
            yield* git.checked(["commit", "--allow-empty", "-m", subject], work);
            yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);
            const head = yield* git.checked(["rev-parse", "HEAD"], work);
            yield* rowsWhere(
              url,
              "SELECT head FROM hq_change",
              (rows) => rows[0]?.["head"] === head,
            );
          });

        // Words before any push describe no head: the first push opens a draft.
        assert.isFalse(yield* edit({ body: "It adds a login page." }));
        yield* push("Add a login page");
        assert.deepStrictEqual(
          (yield* listed).map((change) => change.ready),
          [false],
        );
        // A title is not a description.
        assert.isFalse(yield* edit({ title: "Add a login page" }));
        // Described at its head, it asks for review, wherever a person reads it.
        assert.isTrue(yield* edit({ body: "It adds a login page." }));
        assert.deepStrictEqual(
          (yield* listed).map((change) => change.ready),
          [true],
        );
        assert.isTrue(yield* detail);
        assert.isTrue(yield* edit({ title: "Add a login page and its form" }));
        // A push moves the head past the words: a draft again until described again.
        yield* push("Fix the form");
        assert.isFalse(yield* detail);
        assert.isTrue(yield* edit({ body: "It adds a login page; the form is fixed." }));
        // Words taken back leave nothing to review by.
        assert.isFalse(yield* edit({ body: "" }));
      }),
    );

    it.effect(
      "a Mate reads its changes' outcome in its own state, newest first per repository",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential, auth } = yield* mateWithChange(call, fake, owner);
          const self = Effect.map(
            call("GET", "/api/mate/self", { headers: auth }),
            (answer) => answer.body as Record<string, unknown>,
          );
          const record = {
            projectId: "P_MATE",
            name: "P_MATE",
            face: "face-1",
            standupRequestedBy: null,
            closedOff: false,
            signers: {},
          };
          const change = (number: number, state: string, head: string | null = null) => ({
            repo: "appdev",
            number,
            title: "Mate: appdev",
            state,
            head,
            mergedSha: null,
            landedHead: null,
          });
          assert.deepStrictEqual(yield* self, {
            ...record,
            appId,
            appName: "Shop",
            changes: [change(1, "open")],
          });

          const git = yield* gitClient;
          yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), "work"]);
          const work = NodePath.join(git.dir, "work");
          yield* git.checked(["commit", "--allow-empty", "-m", "Add a login page"], work);
          yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);
          const head = yield* git.checked(["rev-parse", "HEAD"], work);
          yield* rowsWhere(url, "SELECT head FROM hq_change", (rows) => rows[0]?.["head"] === head);
          // Merged by a person through HQ: the squash and the head it squashed.
          const squash = "f".repeat(40);
          yield* rowsWhere(
            url,
            `UPDATE hq_change SET state = 'merged', merged_sha = '${squash}', landed_head = head,
             merged_at = now() RETURNING 1`,
            () => true,
          );
          assert.deepStrictEqual((yield* self)["changes"], [
            { ...change(1, "merged", head), mergedSha: squash, landedHead: head },
          ]);

          // Many changes later, the latest ten of the repository, newest first.
          for (let n = 2; n <= 12; n++) {
            yield* call("POST", "/api/mate/changes", {
              headers: auth,
              body: { repo: "appdev", title: "Mate: appdev" },
            });
            if (n < 12) {
              yield* rowsWhere(
                url,
                `UPDATE hq_change SET state = 'closed', closed_at = now()
                 WHERE number = ${String(n)} RETURNING 1`,
                () => true,
              );
            }
          }
          assert.deepStrictEqual(
            ((yield* self)["changes"] as ReadonlyArray<{ number: number; state: string }>).map(
              ({ number, state }) => [number, state],
            ),
            [[12, "open"], ...[11, 10, 9, 8, 7, 6, 5, 4, 3].map((n) => [n, "closed"])],
          );

          // Out of its application, it has none.
          yield* call("PUT", "/api/projects/P_MATE/app", {
            session: owner,
            body: { appId: null, kind: "mate" },
          });
          assert.deepStrictEqual(yield* self, {
            ...record,
            appId: null,
            appName: null,
            changes: [],
          });
        }),
    );

    it.effect(
      "still reads repository records while optional version metadata has no git leader",
      () =>
        Effect.gen(function* () {
          const first = yield* startCore(true);
          yield* untilHealth(first.call, "active");
          const owner = yield* sessionFor(first.call, "door-owner");
          const { appId, auth } = yield* mateInApp(first.call, first.fake, owner, "P_MATE", "Shop");
          yield* first.call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
          // Repository creation returns before its queued main-moved event updates the timestamp.
          yield* Stream.runHead(
            first.gitHost.recorded.pipe(
              Stream.filterEffect(() =>
                Effect.map(
                  first.sql`SELECT 1 FROM hq_git_event
                    WHERE app_id::text = ${appId} AND repo = 'appdev' AND kind = 'main_moved'`,
                  (rows) => rows.length > 0,
                ),
              ),
            ),
          );
          const listed = yield* first.call("GET", `/api/apps/${appId}/repos`, { session: owner });
          const next = yield* startCore(true, { url: first.url, gitRoot: first.gitRoot });
          yield* untilHealth(next.call, "standby");
          assert.isTrue(Exit.isFailure(yield* Effect.exit(next.gitHost.git)));
          // The HTTP door refuses a standby; the database read also serves an active Core whose
          // git is still opening after a takeover.
          const repos = yield* next.changes.listRepos("owner", appId);
          assert.deepStrictEqual({ repos }, listed.body);
        }),
    );

    it.effect("lists a bounded version declaration from main, never an unmerged branch", () =>
      Effect.gen(function* () {
        const { call, fake, gitHost, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
        yield* call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
        const git = yield* gitHost.git;
        const repo = { appId, id: "appdev" };
        const head = yield* git.commitFiles(repo, "refs/heads/main", {
          files: { "package.json": '{"version":"1.0.0"}' },
          expectedHead:
            (yield* git.branches(repo)).items.find((entry) => entry.ref === "refs/heads/main")
              ?.sha ?? null,
          message: "App declares 1.0.0",
          author: { name: "Ada", email: "ada@mate.test" },
        });
        yield* rowsWhere(
          url,
          `SELECT main_head FROM hq_repo WHERE app_id = '${appId}' AND name = 'appdev'`,
          (rows) => "sha" in head && rows[0]?.["main_head"] === head.sha,
        );
        yield* git.commitFiles(repo, "refs/heads/core/unmerged", {
          files: { VERSION: "9.0.0" },
          expectedHead: null,
          message: "Unmerged version",
          author: { name: "Ada", email: "ada@mate.test" },
        });
        const answer = yield* call("GET", `/api/apps/${appId}/repos`, { session: owner });
        const listed = (answer.body as { repos: Array<{ name: string; releaseVersion?: unknown }> })
          .repos;
        assert.deepStrictEqual(
          [answer.status, listed.find((entry) => entry.name === "appdev")?.releaseVersion],
          [200, { tag: "v1.0.0", path: "package.json" }],
        );
      }),
    );

    it.effect("VERSION takes precedence over package.json when suggesting a release version", () =>
      Effect.gen(function* () {
        const { call, fake, gitHost, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
        yield* call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
        const ownerSocket = yield* socket(
          `/api/structure/ws?ticket=${yield* ticketFor(call, owner)}`,
        );
        const detail = { kind: "app-detail", appId } as const;
        yield* scopeReset(ownerSocket, detail);
        const git = yield* gitHost.git;
        const repo = { appId, id: "appdev" };
        const head = yield* git.commitFiles(repo, "refs/heads/main", {
          files: { VERSION: "2.0.0", "package.json": '{"version":"1.0.0"}' },
          expectedHead:
            (yield* git.branches(repo)).items.find((entry) => entry.ref === "refs/heads/main")
              ?.sha ?? null,
          message: "App declares competing versions",
          author: { name: "Ada", email: "ada@mate.test" },
        });
        yield* nextScopeValue<ReadonlyArray<{ name: string; mainHead: string | null }>>(
          ownerSocket,
          detail,
          "repos",
          (repos) =>
            "sha" in head &&
            repos.some((entry) => entry.name === "appdev" && entry.mainHead === head.sha),
        );
        const answer = yield* call("GET", `/api/apps/${appId}/repos`, { session: owner });
        const listed = (answer.body as { repos: Array<{ name: string; releaseVersion?: unknown }> })
          .repos;
        assert.deepStrictEqual(
          [answer.status, listed.find((entry) => entry.name === "appdev")?.releaseVersion],
          [200, { tag: "v2.0.0", path: "VERSION" }],
        );
      }),
    );

    it.effect(
      "lists an application's repositories, its recipe's too, to whoever reads its changes",
      () =>
        Effect.gen(function* () {
          const { call, fake, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
          yield* call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
          const heads = yield* rowsWhere(
            url,
            `SELECT name, main_head FROM hq_repo WHERE app_id = '${appId}' ORDER BY name`,
            (rows) => rows.length === 2 && rows.every((row) => row["main_head"] !== null),
          );
          const repos = (session: string, app = appId) =>
            Effect.map(call("GET", `/api/apps/${app}/repos`, { session }), (answer) => [
              answer.status,
              answer.body,
            ]);
          const [status, body] = yield* repos(owner);
          const listed = (body as { readonly repos: ReadonlyArray<Record<string, unknown>> }).repos;
          assert.deepStrictEqual(
            [status, listed.map(({ name, mainHead }) => [name, mainHead])],
            [200, heads.map((row) => [row["name"], row["main_head"]])],
          );
          assert.isTrue(
            listed.every((repo) => !Number.isNaN(Date.parse(String(repo["updatedAt"])))),
          );
          // Who reads the application's changes: the org's reader too; not who sees nothing of it.
          const reader = yield* sessionFor(call, "door-reader");
          assert.strictEqual((yield* repos(reader))[0], 200);
          const dev = yield* sessionFor(call, "door-dev");
          assert.deepStrictEqual(yield* repos(dev), [
            403,
            { code: "forbidden", reason: "app_not_seen" },
          ]);
          // An application with no repository yet lists none.
          const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Bare" } });
          const bare = (made.body as { readonly id: string }).id;
          yield* rowsWhere(
            url,
            `DELETE FROM hq_repo WHERE app_id = '${bare}' RETURNING 1`,
            () => true,
          );
          assert.deepStrictEqual(yield* repos(owner, bare), [200, { repos: [] }]);
        }),
    );

    it.effect("whoever sees the application reads its changes and a change's review", () =>
      Effect.gen(function* () {
        const { call, fake, origin } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, credential } = yield* mateWithChange(call, fake, owner);
        const git = yield* gitClient;
        yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), "work"]);
        const work = NodePath.join(git.dir, "work");
        const main = yield* git.checked(["rev-parse", "origin/main"], work);
        NodeFS.writeFileSync(NodePath.join(work, "login.ts"), "export const login = 1;\n");
        yield* git.checked(["add", "login.ts"], work);
        yield* git.checked(["commit", "-m", "Add a login page\n\nWith a form."], work);
        const first = yield* git.checked(["rev-parse", "HEAD"], work);
        yield* git.checked(["commit", "--allow-empty", "-m", "Tidy it"], work);
        const second = yield* git.checked(["rev-parse", "HEAD"], work);
        yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);

        const list = (session: string, app = appId) =>
          call("GET", `/api/apps/${app}/changes`, { session });
        const listed = yield* Effect.filterOrFail(
          list(owner),
          (answer) =>
            (answer.body as { readonly changes: ReadonlyArray<{ head: string }> }).changes[0]
              ?.head === second,
        ).pipe(
          Effect.retry(Schedule.spaced(Duration.millis(50))),
          Effect.timeout(Duration.seconds(5)),
        );
        const { changes } = listed.body as {
          readonly changes: ReadonlyArray<Record<string, unknown>>;
        };
        // Judged at its push: it merges cleanly, and main has not moved past it.
        assert.deepStrictEqual(
          changes.map((change) => [
            change["repo"],
            change["number"],
            change["state"],
            change["mergeability"],
            change["behind"],
          ]),
          [["appdev", 1, "open", "clean", false]],
        );
        assert.isAbove(
          Date.parse(String(changes[0]?.["updatedAt"])),
          Date.parse(String(changes[0]?.["openedAt"])),
        );

        const detail = yield* call("GET", `/api/apps/${appId}/changes/appdev/1`, {
          session: owner,
        });
        for (const [query, reason] of [
          [`expectedHead=${first}&expectedMain=${main}`, "head_moved"],
          [`expectedHead=${second}&expectedMain=${first}`, "main_moved"],
        ]) {
          const stale = yield* call("GET", `/api/apps/${appId}/changes/appdev/1?${query}`, {
            session: owner,
          });
          assert.deepStrictEqual([stale.status, stale.body], [409, { code: "conflict", reason }]);
        }
        assert.strictEqual(detail.status, 200);
        const review = detail.body as Record<string, unknown> & {
          readonly files: ReadonlyArray<Record<string, unknown>>;
          readonly commits: ReadonlyArray<Record<string, unknown>>;
        };
        assert.deepStrictEqual(review["change"], changes[0]);
        assert.deepStrictEqual(
          [review["mainHead"], review["mergeBase"], review["mergeability"]],
          [main, main, { kind: "clean" }],
        );
        assert.deepStrictEqual(
          review.files.map((file) => [
            file["path"],
            file["added"],
            file["deleted"],
            file["binary"],
          ]),
          [["login.ts", 1, 0, false]],
        );
        assert.include(String(review.files[0]?.["hunks"]), "+export const login = 1;");
        assert.deepStrictEqual(
          review.commits.map((commit) => [commit["sha"], commit["subject"], commit["authorName"]]),
          [
            [second, "Tidy it", "Ada"],
            [first, "Add a login page", "Ada"],
          ],
        );
        assert.match(String(review.commits[0]?.["at"]), /^\d{4}-\d\d-\d\dT/u);
        assert.deepStrictEqual(
          [review["filesTruncated"], review["commitsTruncated"]],
          [false, false],
        );

        // Org Read only sees every application; a Developer without a project there sees none.
        const reader = yield* sessionFor(call, "door-reader");
        assert.strictEqual((yield* list(reader)).status, 200);
        const dev = yield* sessionFor(call, "door-dev");
        const hidden = { code: "forbidden", reason: "app_not_seen" };
        assert.deepStrictEqual([(yield* list(dev)).status, (yield* list(dev)).body], [403, hidden]);
        assert.deepStrictEqual(
          (yield* call("GET", `/api/apps/${appId}/changes/appdev/1`, { session: dev })).body,
          hidden,
        );
        // As main's Gitea read: a Read only grant on the Mate shows the application, not its
        // changes; Basic user shows them too.
        const granted = (roleCode: string, status: number) =>
          Effect.gen(function* () {
            const project = fake.projects.find((candidate) => candidate.id === "P_MATE")!;
            Object.assign(project, { userRoles: [{ clientUserId: "C-dev", roleCode }] });
            return yield* list(dev).pipe(
              Effect.filterOrFail((answer) => answer.status === status),
              Effect.retry(Schedule.spaced(Duration.millis(50))),
              Effect.timeout(Duration.seconds(5)),
            );
          });
        assert.deepStrictEqual((yield* granted("READ_ONLY", 403)).body, {
          code: "forbidden",
          reason: "changes_not_seen",
        });
        yield* granted("BASIC_USER", 200);
        // D23: code and recipe merges use write rights, even before production exists.
        for (const repo of ["appdev", "group"]) {
          const missing = yield* call("POST", `/api/apps/${appId}/changes/${repo}/99/merge`, {
            session: dev,
            body: { expectedHead: "0".repeat(40) },
          });
          assert.deepStrictEqual(
            [missing.status, missing.body],
            [404, { code: "change_not_found", reason: "change_not_found" }],
          );
        }
        // An Owner can merge a recipe before production; access passed, the change is absent.
        assert.deepStrictEqual(
          (yield* call("POST", `/api/apps/${appId}/changes/group/99/merge`, {
            session: owner,
            body: { expectedHead: "0".repeat(40) },
          })).body,
          { code: "change_not_found", reason: "change_not_found" },
        );

        assert.deepStrictEqual(
          (yield* call("GET", `/api/apps/${appId}/changes/appdev/9`, { session: owner })).body,
          { code: "change_not_found", reason: "change_not_found" },
        );
        assert.deepStrictEqual((yield* list(owner, "0b7c4c1e-9f1d-4a43-8f43-6d2b8a1c2e10")).body, {
          code: "app_not_found",
          reason: "app_not_found",
        });
        assert.deepStrictEqual((yield* list(owner, "not-an-app")).body, {
          code: "app_not_found",
          reason: "app_not_found",
        });
      }),
    );

    it.effect("whoever reads a change comments on it and sees its pictures", () =>
      Effect.gen(function* () {
        const { call, fake, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, auth } = yield* mateWithChange(call, fake, owner);
        const comments = `/api/apps/${appId}/changes/appdev/1/comments`;
        const say = (session: string, body: string) =>
          call("POST", comments, { session, body: { body } });

        const listed = Effect.map(
          call("GET", `/api/apps/${appId}/changes`, { session: owner }),
          (answer) =>
            (
              answer.body as {
                readonly changes: ReadonlyArray<{ updatedAt: string; comments: number }>;
              }
            ).changes[0]!,
        );
        const updatedAt = Effect.map(listed, (change) => Date.parse(change.updatedAt));
        // A change carries how many comments it has: the room a review holds while it reads them.
        assert.strictEqual((yield* listed).comments, 0);
        const before = yield* updatedAt;
        yield* Effect.sleep(Duration.millis(5));
        const said = yield* say(owner, "Looks good");
        // A comment moves the change.
        assert.isAbove(yield* updatedAt, before);
        assert.strictEqual(said.status, 200);
        const comment = said.body as Record<string, unknown>;
        assert.deepStrictEqual([comment["authorUserId"], comment["body"]], ["owner", "Looks good"]);
        const reader = yield* sessionFor(call, "door-reader");
        assert.strictEqual((yield* say(reader, "Rename it, please.")).status, 200);
        const dev = yield* sessionFor(call, "door-dev");
        assert.deepStrictEqual((yield* say(dev, "Me too")).body, {
          code: "forbidden",
          reason: "app_not_seen",
        });
        assert.strictEqual((yield* say(owner, "  ")).status, 400);
        assert.strictEqual((yield* listed).comments, 2);
        const read = (yield* call("GET", comments, { session: reader })).body as {
          readonly comments: ReadonlyArray<{
            readonly authorUserId: string;
            readonly body: string;
          }>;
        };
        assert.deepStrictEqual(
          read.comments.map((entry) => [entry.authorUserId, entry.body]),
          [
            ["owner", "Looks good"],
            ["reader", "Rename it, please."],
          ],
        );
        yield* rowsWhere(
          url,
          "SELECT kind FROM hq_git_event WHERE kind = 'commented'",
          (rows) => rows.length === 2,
        );
        // The longest comment, in characters JSON spells widest, is still a comment; a NUL is none.
        assert.strictEqual((yield* say(owner, "\u0001".repeat(20_000))).status, 200);
        assert.strictEqual((yield* say(owner, "a\u0000b")).status, 400);

        for (const [type, bytes] of RASTERS) {
          const uploaded = yield* call("POST", "/api/mate/changes/appdev/1/attachments", {
            headers: { ...auth, "content-type": type },
            body: bytes,
          });
          const path = (uploaded.body as { path: string }).path;
          const picture = yield* call("GET", path, { session: reader });
          assert.deepStrictEqual(
            [
              picture.status,
              picture.headers.get("content-type"),
              picture.headers.get("x-content-type-options"),
              [...picture.bytes],
            ],
            [200, type, "nosniff", [...bytes]],
          );
          assert.include(picture.headers.get("cache-control") ?? "", "private");
          assert.strictEqual((yield* call("GET", path)).status, 401);
          assert.strictEqual((yield* call("GET", path, { session: dev })).status, 403);
        }
        const kept = (yield* call("POST", "/api/mate/changes/appdev/1/attachments", {
          headers: { ...auth, "content-type": "image/png" },
          body: PNG,
        })).body as { readonly path: string };
        const picture = yield* call("GET", kept.path, { session: reader });
        assert.deepStrictEqual(
          [
            picture.status,
            picture.headers.get("content-type"),
            picture.headers.get("x-content-type-options"),
            [...picture.bytes],
          ],
          [200, "image/png", "nosniff", [...PNG]],
        );
        assert.strictEqual((yield* call("GET", kept.path, { session: dev })).status, 403);
        const missing = kept.path.replace(/[^/]+$/u, "4f1c2b9a-0d3e-4c55-9b8f-2a7e6d1c0b3a");
        assert.deepStrictEqual((yield* call("GET", missing, { session: reader })).body, {
          code: "attachment_not_found",
          reason: "attachment_not_found",
        });
      }),
    );

    it.effect(
      "a Mate's comment brought over from Gitea reads as the Mate's, a person's as theirs",
      () =>
        Effect.gen(function* () {
          const { call, fake, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId } = yield* mateWithChange(call, fake, owner);
          const comments = `/api/apps/${appId}/changes/appdev/1/comments`;
          const said = yield* call("POST", comments, {
            session: owner,
            body: { body: "Looks good" },
          });
          assert.deepStrictEqual(
            [said.status, (said.body as Record<string, unknown>)["authorMateProjectId"]],
            [200, null],
          );
          // Only the import writes a Mate's words; nothing on HQ's API does.
          const comment = (authors: string) =>
            `INSERT INTO hq_change_comment (app_id, repo, number, author_user_id, author_mate_project_id, body)
           VALUES ('${appId}', 'appdev', 1, ${authors}, 'Done.') RETURNING id`;
          yield* rowsWhere(url, comment("NULL, 'P_MATE'"), (rows) => rows.length === 1);
          const read = (yield* call("GET", comments, { session: owner })).body as {
            readonly comments: ReadonlyArray<Record<string, unknown>>;
          };
          assert.deepStrictEqual(
            read.comments.map((entry) => [entry["authorUserId"], entry["authorMateProjectId"]]),
            [
              ["owner", null],
              [null, "P_MATE"],
            ],
          );
          // A comment has exactly one author.
          const db = yield* PgConnection.make({ url: Redacted.make(url) });
          for (const authors of ["NULL, NULL", "'owner', 'P_MATE'"]) {
            assert.isTrue(Exit.isFailure(yield* Effect.exit(db.query(comment(authors)))), authors);
          }
        }).pipe(Effect.scoped),
    );

    it.effect("a change's address at HQ leads into the client", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const app = "0b7c4c1e-9f1d-4a43-8f43-6d2b8a1c2e10";
        const redirect = yield* call("GET", `/changes/${app}/appdev/7`);
        assert.deepStrictEqual(
          [redirect.status, redirect.headers.get("location")],
          [302, `https://mate.zerops.io/change/${app}/appdev/7`],
        );
        for (const path of [`/changes/${app}/appdev/0`, `/changes/${app}/app.dev/7`]) {
          assert.strictEqual((yield* call("GET", path)).status, 404, path);
        }
      }),
    );

    it.effect(
      "a person's socket carries the changes they read as they move, and a Mate's link its own",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential, auth } = yield* mateWithChange(call, fake, owner);
          const ownerSocket = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, owner)}`,
          );
          const dev = yield* sessionFor(call, "door-dev");
          const devSocket = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, dev)}`,
          );
          const ticket = (yield* call("POST", "/api/mate/link-ticket", { headers: auth })).body as {
            readonly ticket: string;
          };
          const link = yield* socket(`/api/mate/link?ticket=${ticket.ticket}`);

          type Change = Record<string, unknown>;
          const detail = { kind: "app-detail", appId } as const;
          const initial = scopeValue<ReadonlyArray<Change>>(
            yield* scopeReset(ownerSocket, detail),
            "changes",
          );
          assert.lengthOf(initial, 1);
          yield* devSocket.send({ type: "subscribe", scopes: [{ scope: detail }] });
          assert.strictEqual((yield* devSocket.take("scope-error")).code, "forbidden");
          const own = (head: string | null, title = "Mate: appdev") => ({
            repo: "appdev",
            number: 1,
            title,
            state: "open",
            head,
            mergedSha: null,
            landedHead: null,
          });
          const state = (yield* link.next("state")) as {
            readonly mate: { readonly appId: string; readonly changes: ReadonlyArray<Change> };
          };
          assert.deepStrictEqual([state.mate.appId, state.mate.changes], [appId, [own(null)]]);

          // The Mate pushes: the change's head moves on the socket and down the link.
          const git = yield* gitClient;
          yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), "work"]);
          const work = NodePath.join(git.dir, "work");
          yield* git.checked(["commit", "--allow-empty", "-m", "Add a login page"], work);
          yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/P_MATE/1"], work);
          const head = yield* git.checked(["rev-parse", "HEAD"], work);
          const pushed = yield* nextScopeValue<ReadonlyArray<Change>>(
            ownerSocket,
            detail,
            "changes",
            (value) => value.some((change) => change["head"] === head),
          );
          assert.deepStrictEqual(
            pushed.map((change) => change["head"]),
            [head],
          );
          assert.deepStrictEqual(
            ((yield* link.next("state")) as { readonly mate: { readonly changes: unknown } }).mate
              .changes,
            [own(head)],
          );

          // Retitled: the socket shows it, and the link, whose state names each change's title.
          yield* call("PATCH", "/api/mate/changes/appdev/1", {
            headers: auth,
            body: { title: "Add a login page" },
          });
          const retitled = yield* nextScopeValue<ReadonlyArray<Change>>(
            ownerSocket,
            detail,
            "changes",
            (value) => value[0]?.["title"] === "Add a login page",
          );
          assert.strictEqual(retitled[0]?.["title"], "Add a login page");
          assert.deepStrictEqual(
            ((yield* link.next("state")) as { readonly mate: { readonly changes: unknown } }).mate
              .changes,
            [own(head, "Add a login page")],
          );
          // Its post-change subscription is refused too; no protected value reached it.
          yield* devSocket.send({ type: "subscribe", scopes: [{ scope: detail }] });
          assert.strictEqual((yield* devSocket.take("scope-error")).code, "forbidden");
          assert.deepStrictEqual(
            (yield* devSocket.collected).filter(
              (message) => message.type === "scope-reset" || message.type === "scope-values",
            ),
            [],
          );
        }),
    );

    it.effect(
      "git decides a push as the git layer reads the request, however its address is spelled",
      () =>
        Effect.gen(function* () {
          // The org's view never young enough to serve as it is, no reconcile: a fetch takes the last
          // good view while Zerops does not answer, a push as a write is decided (F22) over a read.
          const { call, fake } = yield* startCore(true, {
            viewTtl: Duration.millis(1),
            reconcileEvery: Duration.minutes(5),
          });
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential } = yield* mateWithChange(call, fake, owner);
          const advertise = (query: string) =>
            call("GET", `/git/${appId}/appdev.git/info/refs?${query}`, {
              headers: {
                authorization: `Basic ${Buffer.from(`mate:${credential}`).toString("base64")}`,
              },
            });
          assert.strictEqual((yield* advertise("service=git-upload-pack")).status, 200);
          // Zerops no longer has the Mate's project, and does not answer: a fetch takes HQ's last good
          // view, which still has it.
          fake.projects.splice(
            fake.projects.findIndex((project) => project.id === "P_MATE"),
            1,
          );
          fake.down = true;
          assert.strictEqual((yield* advertise("service=git-upload-pack")).status, 200);
          // Zerops answers again. The layer reads everything past the first `?` as the query: this
          // is a push's advertisement, so `open_change` decides it — over the org read again, its
          // refusal confirmed fresh.
          fake.down = false;
          const push = yield* advertise("x=1?&service=git-receive-pack");
          assert.deepStrictEqual(
            [push.status, push.body],
            [404, { code: "project_not_found", reason: "project_gone" }],
          );
        }),
    );
  });
});
