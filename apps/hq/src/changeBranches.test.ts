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
