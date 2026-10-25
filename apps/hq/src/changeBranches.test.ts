// @effect-diagnostics nodeBuiltinImport:off -- the tests reach Core as zcp and a person do: over HTTP and git.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { gitClient } from "../test/harness/gitClient.ts";
import { addProject, mateInApp, remoteOf, rowsWhere } from "../test/harness/mates.ts";
import { type Call, sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { FakeWorld } from "../test/harness/zeropsFake.ts";

type Git = Effect.Success<typeof gitClient>;
type Body = Record<string, unknown>;

/** A Mate `projectId` of the application, enrolled, with the repository `appdev` and no change. */
const mateOf = (
  call: Call,
  fake: FakeWorld,
  owner: string,
  projectId: string,
  appIds: Map<string, string>,
) =>
  Effect.gen(function* () {
    if (projectId !== "P_MATE") addProject(fake, projectId);
    const mate = yield* mateInApp(call, fake, owner, projectId, "Shop", appIds);
    yield* call("POST", "/api/mate/repos", { headers: mate.auth, body: { name: "appdev" } });
    /** Opens its change in `appdev`, on `branch` where one is named: HQ's answer. */
    const open = (title: string, branch?: string) =>
      call("POST", "/api/mate/changes", {
        headers: mate.auth,
        body: { repo: "appdev", title, ...(branch === undefined ? {} : { branch }) },
      });
    return { ...mate, open };
  });

/** A Mate's checkout of `appdev` in `dir`: commits, and pushes as git's `push` arguments say. */
const checkout = (git: Git, origin: string, credential: string, appId: string, dir: string) =>
  Effect.gen(function* () {
    yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), dir]);
    const work = NodePath.join(git.dir, dir);
    return {
      work,
      commit: (file: string) =>
        Effect.andThen(
          Effect.sync(() => NodeFS.writeFileSync(NodePath.join(work, file), `${file}\n`)),
          Effect.andThen(
            git.checked(["add", file], work),
            git.checked(["commit", "-m", `Add ${file}`], work),
          ),
        ),
      push: (...args: ReadonlyArray<string>) => git.run(["push", "origin", ...args], work),
      head: git.checked(["rev-parse", "HEAD"], work),
      tip: (ref: string) => git.checked(["ls-remote", "origin", ref], work),
    };
  });

/** An opening's answer as the tests compare it: status, whether it opened one, its number and branch. */
const answered = (opening: ReturnType<Call>) =>
  Effect.map(opening, (answer) => {
    const body = answer.body as { readonly created?: boolean; readonly change?: Body };
    return [
      answer.status,
      body.created ?? null,
      body.change?.["number"] ?? null,
      body.change?.["branch"] ?? null,
    ];
  });

/** A person's review of change `number` in `appdev`: the paths it touches and its commits. */
const detailOf = (call: Call, session: string, appId: string, number: number) =>
  Effect.map(
    call("GET", `/api/apps/${appId}/changes/appdev/${String(number)}`, { session }),
    (answer) => {
      const body = answer.body as {
        readonly files: ReadonlyArray<Body>;
        readonly commits: ReadonlyArray<Body>;
      };
      return {
        files: body.files.map((file) => file["path"]),
        commits: body.commits.map((commit) => commit["sha"]),
      };
    },
  );

/** A person's merge of change `number` in `appdev` at `head`: its status and the change's state. */
const mergeOf = (call: Call, session: string, appId: string, number: number, head: string) =>
  Effect.map(
    call("POST", `/api/apps/${appId}/changes/appdev/${String(number)}/merge`, {
      session,
      body: { expectedHead: head },
    }),
    (answer) => [answer.status, (answer.body as Body)["state"]],
  );

/** The Mate of `projectId` let go: its project deleted, and HQ's reconcile no longer holding it. */
const letGo = (fake: FakeWorld, url: string, projectId: string) =>
  Effect.andThen(
    Effect.sync(() =>
      fake.projects.splice(
        fake.projects.findIndex((project) => project.id === projectId),
        1,
      ),
    ),
    rowsWhere(
      url,
      `SELECT 1 FROM hq_app_project WHERE project_id = '${projectId}'`,
      (rows) => rows.length === 0,
    ),
  );

/** HQ's record of change `number` once its head is `head`. */
const recorded = (url: string, number: number, head: string) =>
  rowsWhere(
    url,
    `SELECT head FROM hq_change WHERE number = ${String(number)}`,
    (rows) => rows[0]?.["head"] === head,
  );

describe("a change is a branch", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a Mate pushes a branch it names and moves it forward, and is refused main, a rewrite, a deletion, a tag and HQ's mate/ namespace",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const ada = yield* mateOf(call, fake, owner, "P_MATE", new Map());
          const git = yield* gitClient;
          const work = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
          yield* work.commit("login.ts");
          const first = yield* work.head;
          yield* work.commit("login.css");
          const second = yield* work.head;
          yield* git.checked(["tag", "v1"], work.work);
          const steps: ReadonlyArray<readonly [string, ReadonlyArray<string>, boolean]> = [
            ["a new branch", [`${first}:refs/heads/fix-login`], true],
            ["its fast-forward", ["HEAD:refs/heads/fix-login"], true],
            ["main", ["HEAD:refs/heads/main"], false],
            ["a rewrite", ["--force", `${first}:refs/heads/fix-login`], false],
            ["a deletion", [":refs/heads/fix-login"], false],
            ["a tag", ["refs/tags/v1"], false],
            [
              "HQ's namespace, with no change of its own there",
              ["HEAD:refs/heads/mate/P_MATE/9"],
              false,
            ],
          ];
          for (const [step, args, accepted] of steps) {
            const pushed = yield* work.push(...args);
            assert.strictEqual(pushed.code === 0, accepted, `${step}: ${pushed.stderr}`);
          }
          assert.strictEqual(
            yield* work.tip("refs/heads/fix-login"),
            `${second}\trefs/heads/fix-login`,
          );
          assert.strictEqual(yield* work.tip("refs/tags/v1"), "");
        }),
    );

    it.effect("a Mate is refused the branch another Mate's open change is on", () =>
      Effect.gen(function* () {
        const { call, fake, origin, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const apps = new Map<string, string>();
        const ada = yield* mateOf(call, fake, owner, "P_MATE", apps);
        const bea = yield* mateOf(call, fake, owner, "P_BEA", apps);
        assert.strictEqual((yield* bea.open("Fix the login", "fix-login")).status, 200);
        const git = yield* gitClient;
        const adas = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
        const beas = yield* checkout(git, origin, bea.credential, bea.appId, "bea");
        yield* adas.commit("ada.ts");
        const refused = yield* adas.push("HEAD:refs/heads/fix-login");
        assert.notStrictEqual(refused.code, 0);
        assert.include(refused.stderr, "not_your_ref");
        // Its own branch beside it, and the branch's Mate on it, go through.
        assert.strictEqual((yield* adas.push("HEAD:refs/heads/fix-signup")).code, 0);
        yield* beas.commit("bea.ts");
        assert.strictEqual((yield* beas.push("HEAD:refs/heads/fix-login")).code, 0);
        yield* recorded(url, 1, yield* beas.head);
      }),
    );

    it.effect(
      "a change opened without a branch is on mate/<Mate>/<number>, takes its Mate's push, and is read and merged from it",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const ada = yield* mateOf(call, fake, owner, "P_MATE", new Map());
          const opened = (yield* ada.open("Add a login page")).body as { readonly change: Body };
          assert.deepStrictEqual(
            [opened.change["number"], opened.change["branch"]],
            [1, "mate/P_MATE/1"],
          );
          const git = yield* gitClient;
          const work = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
          yield* work.commit("login.ts");
          assert.strictEqual((yield* work.push("HEAD:refs/heads/mate/P_MATE/1")).code, 0);
          const head = yield* work.head;
          yield* recorded(url, 1, head);
          const detail = (yield* call("GET", `/api/apps/${ada.appId}/changes/appdev/1`, {
            session: owner,
          })).body as Body;
          assert.deepStrictEqual(
            [
              (detail["files"] as ReadonlyArray<Body>).map((file) => file["path"]),
              (detail["mergeability"] as Body)["kind"],
            ],
            [["login.ts"], "clean"],
          );
          const merged = yield* call("POST", `/api/apps/${ada.appId}/changes/appdev/1/merge`, {
            session: owner,
            body: { expectedHead: head },
          });
          assert.deepStrictEqual(
            [merged.status, (merged.body as Body)["state"], (merged.body as Body)["landedHead"]],
            [200, "merged", head],
          );
        }),
    );

    it.effect.each([["before"], ["after"]] as const)(
      "a change opened on a branch %s its push is read and merged from that branch",
      ([when]) =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const ada = yield* mateOf(call, fake, owner, "P_MATE", new Map());
          const git = yield* gitClient;
          const work = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
          yield* work.commit("login.ts");
          const head = yield* work.head;
          const open = Effect.map(ada.open("Fix the login", "fix-login"), (answer) => {
            assert.strictEqual(answer.status, 200);
            return (answer.body as { readonly change: Body }).change;
          });
          const push = Effect.map(work.push("HEAD:refs/heads/fix-login"), (pushed) =>
            assert.strictEqual(pushed.code, 0, pushed.stderr),
          );
          const change = when === "before" ? yield* open : yield* Effect.andThen(push, open);
          if (when === "before") yield* push;
          assert.deepStrictEqual([change["number"], change["branch"]], [1, "fix-login"]);
          yield* recorded(url, 1, head);
          const detail = (yield* call("GET", `/api/apps/${ada.appId}/changes/appdev/1`, {
            session: owner,
          })).body as Body;
          assert.deepStrictEqual(
            [
              (detail["files"] as ReadonlyArray<Body>).map((file) => file["path"]),
              (detail["mergeability"] as Body)["kind"],
            ],
            [["login.ts"], "clean"],
          );
          const merged = yield* call("POST", `/api/apps/${ada.appId}/changes/appdev/1/merge`, {
            session: owner,
            body: { expectedHead: head },
          });
          assert.deepStrictEqual([merged.status, (merged.body as Body)["landedHead"]], [200, head]);
          yield* git.checked(["fetch", "origin"], work.work);
          assert.strictEqual(
            yield* git.checked(
              ["log", "-1", "--format=%(trailers:key=Mate-Change,valueonly)", "origin/main"],
              work.work,
            ),
            "P_MATE/1",
          );
        }),
    );

    it.effect(
      "a change opened again takes the head of the branch pushed before it, when its first opening recorded none",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const ada = yield* mateOf(call, fake, owner, "P_MATE", new Map());
          const git = yield* gitClient;
          const work = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
          yield* work.commit("login.ts");
          const head = yield* work.head;
          assert.strictEqual((yield* work.push("HEAD:refs/heads/fix-login")).code, 0);
          assert.strictEqual((yield* ada.open("Fix the login", "fix-login")).status, 200);
          // The first opening's read of the branch failed after the change was recorded.
          yield* rowsWhere(url, "UPDATE hq_change SET head = NULL RETURNING 1", () => true);
          const again = (yield* ada.open("Fix the login", "fix-login")).body as {
            readonly created: boolean;
            readonly change: Body;
          };
          assert.deepStrictEqual([again.created, again.change["head"]], [false, head]);
          yield* recorded(url, 1, head);
        }),
    );

    it.effect(
      "a change opened on a branch with nothing beyond main has no head until work is pushed there",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const ada = yield* mateOf(call, fake, owner, "P_MATE", new Map());
          const git = yield* gitClient;
          const work = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
          assert.strictEqual((yield* work.push("HEAD:refs/heads/fix-login")).code, 0);
          const opened = (yield* ada.open("Fix the login", "fix-login")).body as {
            readonly change: Body;
          };
          assert.deepStrictEqual([opened.change["state"], opened.change["head"]], ["open", null]);
          yield* work.commit("login.ts");
          assert.strictEqual((yield* work.push("HEAD:refs/heads/fix-login")).code, 0);
          yield* recorded(url, 1, yield* work.head);
        }),
    );

    it.effect("a Mate opens a change per branch it names, each pushed and merged on its own", () =>
      Effect.gen(function* () {
        const { call, fake, origin, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const ada = yield* mateOf(call, fake, owner, "P_MATE", new Map());
        assert.deepStrictEqual(yield* answered(ada.open("Fix the login", "fix-login")), [
          200,
          true,
          1,
          "fix-login",
        ]);
        assert.deepStrictEqual(yield* answered(ada.open("Add a badge", "badge")), [
          200,
          true,
          2,
          "badge",
        ]);
        // Each branch's own change again, as it is: the title asked for now opens nothing.
        assert.deepStrictEqual(yield* answered(ada.open("Fix it", "fix-login")), [
          200,
          false,
          1,
          "fix-login",
        ]);
        const git = yield* gitClient;
        const work = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
        yield* work.commit("login.ts");
        assert.strictEqual((yield* work.push("HEAD:refs/heads/fix-login")).code, 0);
        const login = yield* work.head;
        // The badge is cut from main, beside the login fix.
        yield* git.checked(["reset", "--hard", "origin/main"], work.work);
        yield* work.commit("badge.ts");
        assert.strictEqual((yield* work.push("HEAD:refs/heads/badge")).code, 0);
        const badge = yield* work.head;
        yield* recorded(url, 1, login);
        yield* recorded(url, 2, badge);
        const review = (number: number) => detailOf(call, owner, ada.appId, number);
        assert.deepStrictEqual((yield* review(1)).files, ["login.ts"]);
        assert.deepStrictEqual((yield* review(2)).files, ["badge.ts"]);
        // Merged one after the other, in either order: each lands as itself.
        assert.deepStrictEqual(yield* mergeOf(call, owner, ada.appId, 2, badge), [200, "merged"]);
        assert.deepStrictEqual(yield* mergeOf(call, owner, ada.appId, 1, login), [200, "merged"]);
        yield* git.checked(["fetch", "origin"], work.work);
        const files = yield* git.checked(["ls-tree", "--name-only", "origin/main"], work.work);
        assert.includeMembers(files.split("\n"), ["badge.ts", "login.ts"]);
      }),
    );

    it.effect(
      "an opening that names no branch answers the Mate's default change, whatever else is open",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const ada = yield* mateOf(call, fake, owner, "P_MATE", new Map());
          const answers = [];
          // Released zcp names none and pushes mate/<Mate>/<number>; mono-git names one.
          for (const [title, branch] of [
            ["Fix the login", "fix-login"],
            ["Mate: appdev", undefined],
            ["Mate: appdev again", undefined],
            ["Add a badge", "badge"],
            ["Mate: appdev once more", undefined],
          ] as const)
            answers.push(yield* answered(ada.open(title, branch)));
          assert.deepStrictEqual(answers, [
            [200, true, 1, "fix-login"],
            [200, true, 2, "mate/P_MATE/2"],
            [200, false, 2, "mate/P_MATE/2"],
            [200, true, 3, "badge"],
            [200, false, 2, "mate/P_MATE/2"],
          ]);
        }),
    );

    it.effect(
      "the sixth open change is refused too_many_open, and a change answered as it is never is",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const apps = new Map<string, string>();
          const ada = yield* mateOf(call, fake, owner, "P_MATE", apps);
          const bea = yield* mateOf(call, fake, owner, "P_BEA", apps);
          // Its default change and four on branches it named: five open.
          assert.strictEqual((yield* answered(ada.open("Mate: appdev")))[1], true);
          for (const n of [1, 2, 3, 4])
            assert.strictEqual((yield* answered(ada.open(`Work ${n}`, `work-${n}`)))[1], true);
          const refused = yield* ada.open("Work 5", "work-5");
          assert.deepStrictEqual(
            [refused.status, refused.body],
            [409, { code: "conflict", reason: "too_many_open" }],
          );
          // An open change answered as it is, its default or a named one, is never refused.
          assert.deepStrictEqual(yield* answered(ada.open("Mate: appdev")), [
            200,
            false,
            1,
            "mate/P_MATE/1",
          ]);
          assert.deepStrictEqual(yield* answered(ada.open("Work 2", "work-2")), [
            200,
            false,
            3,
            "work-2",
          ]);
          // Another Mate of the application counts its own.
          assert.deepStrictEqual(yield* answered(bea.open("Fix it", "fix-it")), [
            200,
            true,
            6,
            "fix-it",
          ]);
          // One closed, there is room again.
          const closed = yield* call("POST", `/api/apps/${ada.appId}/changes/appdev/2/close`, {
            session: owner,
            body: { expectedHead: null },
          });
          assert.strictEqual(closed.status, 200);
          assert.deepStrictEqual(yield* answered(ada.open("Work 5", "work-5")), [
            200,
            true,
            7,
            "work-5",
          ]);
        }),
    );

    it.effect(
      "a change's review lists only its own commits, never those of a change it was built on that landed first, whoever's it was",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const apps = new Map<string, string>();
          const ada = yield* mateOf(call, fake, owner, "P_MATE", apps);
          const bea = yield* mateOf(call, fake, owner, "P_BEA", apps);
          assert.strictEqual((yield* ada.open("Add the base", "base")).status, 200);
          assert.strictEqual((yield* bea.open("Build on the base", "top")).status, 200);
          const git = yield* gitClient;
          const adas = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
          yield* adas.commit("base.ts");
          assert.strictEqual((yield* adas.push("HEAD:refs/heads/base")).code, 0);
          const base = yield* adas.head;
          // Bea's branch is cut from Ada's, still open.
          const beas = yield* checkout(git, origin, bea.credential, bea.appId, "bea");
          yield* git.checked(["fetch", "origin", "base"], beas.work);
          yield* git.checked(["reset", "--hard", "FETCH_HEAD"], beas.work);
          yield* beas.commit("top.ts");
          assert.strictEqual((yield* beas.push("HEAD:refs/heads/top")).code, 0);
          const top = yield* beas.head;
          yield* recorded(url, 1, base);
          yield* recorded(url, 2, top);
          assert.deepStrictEqual((yield* detailOf(call, owner, ada.appId, 2)).commits, [top, base]);
          // Ada's lands as a squash: her commit is landed content, never Bea's work.
          assert.deepStrictEqual(yield* mergeOf(call, owner, ada.appId, 1, base), [200, "merged"]);
          assert.deepStrictEqual((yield* detailOf(call, owner, ada.appId, 2)).commits, [top]);
          // A change merged keeps its own commits in its review.
          assert.deepStrictEqual((yield* detailOf(call, owner, ada.appId, 1)).commits, [base]);
        }),
    );

    it.effect(
      "a change its Mate continues from its own landing lists only its new commits, however many other changes landed since",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const ada = yield* mateOf(call, fake, owner, "P_MATE", new Map());
          assert.strictEqual((yield* ada.open("Add the login", "login")).status, 200);
          const git = yield* gitClient;
          const work = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
          yield* work.commit("login.ts");
          assert.strictEqual((yield* work.push("HEAD:refs/heads/login")).code, 0);
          const first = yield* work.head;
          yield* recorded(url, 1, first);
          assert.deepStrictEqual(yield* mergeOf(call, owner, ada.appId, 1, first), [200, "merged"]);
          // Many other changes of the repository landed after hers.
          yield* rowsWhere(
            url,
            `INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, branch, state,
               head, merged_sha, landed_head, merged_at)
             SELECT '${ada.appId}', 'appdev', n, 'P_OTHER', 'Other ' || n, 'other-' || n, 'merged',
               lpad(to_hex(n), 40, 'a'), lpad(to_hex(n), 40, 'b'), lpad(to_hex(n), 40, 'a'),
               now() + n * interval '1 second'
             FROM generate_series(2, 30) n RETURNING 1`,
            () => true,
          );
          // She goes on from her own history on the same branch.
          assert.strictEqual((yield* ada.open("Remember the login", "login")).status, 200);
          yield* work.commit("remember.ts");
          assert.strictEqual((yield* work.push("HEAD:refs/heads/login")).code, 0);
          const next = yield* work.head;
          yield* recorded(url, 31, next);
          assert.deepStrictEqual((yield* detailOf(call, owner, ada.appId, 31)).commits, [next]);
        }),
    );

    it.effect.each([
      ["a branch its Mate named", "fix-login"],
      ["its default branch", undefined],
    ] as const)(
      "an open change on %s whose Mate was deleted is marked so, and a person hands it to another Mate of its application, whose pushes to its branch are taken from then on while the deleted Mate's are refused",
      ([, named]) =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const apps = new Map<string, string>();
          const ada = yield* mateOf(call, fake, owner, "P_MATE", apps);
          const bea = yield* mateOf(call, fake, owner, "P_BEA", apps);
          const opened = (yield* ada.open("Fix the login", named)).body as {
            readonly change: Body;
          };
          const branch = named ?? "mate/P_MATE/1";
          assert.strictEqual(opened.change["branch"], branch);
          const git = yield* gitClient;
          const adas = yield* checkout(git, origin, ada.credential, ada.appId, "ada");
          yield* adas.commit("login.ts");
          assert.strictEqual((yield* adas.push(`HEAD:refs/heads/${branch}`)).code, 0);
          yield* recorded(url, 1, yield* adas.head);
          const change = () =>
            Effect.map(
              call("GET", `/api/apps/${ada.appId}/changes`, { session: owner }),
              (answer) => (answer.body as { readonly changes: ReadonlyArray<Body> }).changes[0]!,
            );
          assert.strictEqual((yield* change())["mateGone"], undefined);
          // Ada's project is deleted: HQ's reconcile lets her Mate go; her change stays open.
          fake.projects.splice(
            fake.projects.findIndex((project) => project.id === "P_MATE"),
            1,
          );
          yield* rowsWhere(
            url,
            "SELECT 1 FROM hq_app_project WHERE project_id = 'P_MATE'",
            (rows) => rows.length === 0,
          );
          assert.deepStrictEqual(
            [(yield* change())["state"], (yield* change())["mateGone"]],
            ["open", true],
          );
          // Bea takes the branch from Ada's work; before it is hers, her push is refused.
          const beas = yield* checkout(git, origin, bea.credential, bea.appId, "bea");
          yield* git.checked(["fetch", "origin", branch], beas.work);
          yield* git.checked(["reset", "--hard", "FETCH_HEAD"], beas.work);
          yield* beas.commit("signup.ts");
          const before = yield* beas.push(`HEAD:refs/heads/${branch}`);
          assert.include(before.stderr, "not_your_ref");
          const handed = yield* call("POST", `/api/apps/${ada.appId}/changes/appdev/1/hand`, {
            session: owner,
            body: { mateProjectId: "P_BEA" },
          });
          assert.deepStrictEqual(
            [
              handed.status,
              (handed.body as Body)["mateProjectId"],
              (handed.body as Body)["branch"],
              (handed.body as Body)["mateGone"],
            ],
            [200, "P_BEA", branch, undefined],
          );
          const after = yield* beas.push(`HEAD:refs/heads/${branch}`);
          assert.strictEqual(after.code, 0, after.stderr);
          yield* recorded(url, 1, yield* beas.head);
          yield* adas.commit("ada.ts");
          assert.notStrictEqual((yield* adas.push(`HEAD:refs/heads/${branch}`)).code, 0);
          // Bea's own state carries it as handed to her, on its branch.
          const self = (yield* call("GET", "/api/mate/self", { headers: bea.auth })).body as {
            readonly changes: ReadonlyArray<Body>;
          };
          assert.deepStrictEqual(
            self.changes.map((own) => [own["number"], own["state"], own["branch"], own["handed"]]),
            [[1, "open", branch, true]],
          );
        }),
    );

    it.effect(
      "a change is handed over only while open, its Mate gone, to a Mate of its application, however many open changes of its own that Mate holds",
      () =>
        Effect.gen(function* () {
          const { call, fake, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const apps = new Map<string, string>();
          const ada = yield* mateOf(call, fake, owner, "P_MATE", apps);
          const bea = yield* mateOf(call, fake, owner, "P_BEA", apps);
          yield* mateOf(call, fake, owner, "P_CID", apps);
          assert.strictEqual((yield* ada.open("Fix the login")).status, 200);
          assert.strictEqual((yield* ada.open("Fix the form", "fix-form")).status, 200);
          // Bea holds as many open changes as a Mate may open: her default and four named.
          assert.strictEqual((yield* bea.open("Fix the signup")).status, 200);
          for (const n of [1, 2, 3, 4])
            assert.strictEqual((yield* bea.open(`Work ${n}`, `work-${n}`)).status, 200);
          const hand = (number: number, mateProjectId: string) =>
            Effect.map(
              call("POST", `/api/apps/${ada.appId}/changes/appdev/${String(number)}/hand`, {
                session: owner,
                body: { mateProjectId },
              }),
              (answer) => [answer.status, (answer.body as Body | null)?.["reason"] ?? null],
            );
          // Ada is still the application's.
          assert.deepStrictEqual(yield* hand(1, "P_CID"), [409, "change_has_mate"]);
          yield* letGo(fake, url, "P_MATE");
          const answers = [];
          for (const to of ["P_NOBODY", "P_MATE", "P_BEA"])
            answers.push([to, ...(yield* hand(1, to))]);
          assert.deepStrictEqual(answers, [
            ["P_NOBODY", 409, "not_app_mate"],
            ["P_MATE", 409, "not_app_mate"],
            // A person's hand-over is never held back by what the Mate holds already.
            ["P_BEA", 200, null],
          ]);
          assert.deepStrictEqual(yield* hand(2, "P_BEA"), [200, null]);
          assert.deepStrictEqual(yield* hand(1, "P_CID"), [409, "change_has_mate"]);
          // Released zcp names no branch: Bea's own default change, never the one handed to her on
          // Ada's; naming a handed change's branch answers it; anything new waits for room.
          assert.deepStrictEqual(yield* answered(bea.open("Fix it")), [
            200,
            false,
            3,
            "mate/P_BEA/3",
          ]);
          assert.deepStrictEqual(yield* answered(bea.open("Fix it", "fix-form")), [
            200,
            false,
            2,
            "fix-form",
          ]);
          const full = yield* bea.open("Fix it", "fix-it");
          assert.deepStrictEqual(
            [full.status, (full.body as Body)["reason"]],
            [409, "too_many_open"],
          );
          const self = (yield* call("GET", "/api/mate/self", { headers: bea.auth })).body as {
            readonly changes: ReadonlyArray<Body>;
          };
          assert.deepStrictEqual(
            self.changes.map((own) => [own["number"], own["state"], own["handed"] ?? false]),
            [
              [7, "open", false],
              [6, "open", false],
              [5, "open", false],
              [4, "open", false],
              [3, "open", false],
              [2, "open", true],
              [1, "open", true],
            ],
          );
          yield* call("POST", `/api/apps/${ada.appId}/changes/appdev/1/close`, {
            session: owner,
            body: { expectedHead: null },
          });
          assert.deepStrictEqual(yield* hand(1, "P_CID"), [409, "change_not_open"]);
        }),
    );

    it.effect(
      "a Mate's default change handed back to it while it holds its default change again is refused mate_has_change",
      () =>
        Effect.gen(function* () {
          const { call, fake, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const apps = new Map<string, string>();
          const ada = yield* mateOf(call, fake, owner, "P_ADA", apps);
          yield* mateOf(call, fake, owner, "P_BEA", apps);
          assert.strictEqual((yield* ada.open("Fix the login")).status, 200);
          const hand = (mateProjectId: string) =>
            Effect.map(
              call("POST", `/api/apps/${ada.appId}/changes/appdev/1/hand`, {
                session: owner,
                body: { mateProjectId },
              }),
              (answer) => [answer.status, (answer.body as Body | null)?.["reason"] ?? null],
            );
          // Ada is let go, her change handed to Bea; then Bea is let go, and Ada is back.
          yield* letGo(fake, url, "P_ADA");
          assert.deepStrictEqual(yield* hand("P_BEA"), [200, null]);
          yield* letGo(fake, url, "P_BEA");
          const back = yield* mateOf(call, fake, owner, "P_ADA", apps);
          assert.deepStrictEqual(yield* answered(back.open("Fix the signup")), [
            200,
            true,
            2,
            "mate/P_ADA/2",
          ]);
          // On mate/P_ADA/1 it would be her default change a second time.
          assert.deepStrictEqual(yield* hand("P_ADA"), [409, "mate_has_change"]);
        }),
    );

    it.effect(
      "a change is refused a branch another open change is on, and main, HQ's mate/ or a tag as its branch",
      () =>
        Effect.gen(function* () {
          const { call, fake } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const apps = new Map<string, string>();
          const ada = yield* mateOf(call, fake, owner, "P_MATE", apps);
          const bea = yield* mateOf(call, fake, owner, "P_BEA", apps);
          assert.strictEqual((yield* ada.open("Fix the login", "fix-login")).status, 200);
          const answers = [];
          for (const branch of ["fix-login", "main", "mate/P_BEA/9", "refs/tags/v1"]) {
            const answer = yield* bea.open("Fix it too", branch);
            answers.push([branch, answer.status, (answer.body as Body)["reason"]]);
          }
          assert.deepStrictEqual(answers, [
            ["fix-login", 409, "branch_taken"],
            ["main", 409, "protected_ref"],
            ["mate/P_BEA/9", 409, "protected_ref"],
            ["refs/tags/v1", 409, "protected_ref"],
          ]);
          // Once nothing else holds a branch, a change may be opened on it.
          const opened = yield* bea.open("Fix the signup", "fix-signup");
          assert.deepStrictEqual(
            [opened.status, (opened.body as { readonly change: Body }).change["branch"]],
            [200, "fix-signup"],
          );
        }),
    );
  });
});
