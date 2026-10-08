// @effect-diagnostics nodeBuiltinImport:off -- the tests reach Core as zcp and a person do: over HTTP and git.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { RECIPE_PROPOSAL_TITLE, RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { gitClient } from "../test/harness/gitClient.ts";
import { addProject, mateInApp, rowsWhere } from "../test/harness/mates.ts";
import { groupCheckout, propose, stateBecomes } from "../test/harness/recipe.ts";
import {
  type Call,
  enrollMate,
  sessionFor,
  startCore,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { FakeWorld } from "../test/harness/zeropsFake.ts";

const AI_AGENT = "0 — AI Agent/import.yaml";
const STAGE = "3 — Stage/import.yaml";
const TIER = "project:\n  name: shop\nservices:\n  - hostname: api\n    type: nodejs@22\n";

/** Ada and Bo, two Mates of one application. */
const twoMates = (call: Call, fake: FakeWorld, owner: string) =>
  Effect.gen(function* () {
    const ada = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
    addProject(fake, "P_MATE2");
    yield* call("POST", `/api/apps/${ada.appId}/projects`, {
      session: owner,
      body: { projectId: "P_MATE2", kind: "mate", mate: { face: "face-2" } },
    });
    const credential = yield* enrollMate(call, fake, "P_MATE2");
    return {
      appId: ada.appId,
      ada,
      bo: { credential, auth: { authorization: `Mate ${credential}` } },
    };
  });

describe("an application's recipe in HQ", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a recipe change that only adds tier files is landed by Core, and its tiers read per role",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
          const tier = (session: string, name: string) =>
            call("GET", `/api/apps/${appId}/recipe/${name}`, { session });
          // Made with the application: absent until a proposal lands.
          assert.deepStrictEqual((yield* tier(owner, "mate")).body, { state: "absent" });

          const number = yield* propose(call, auth);
          const git = yield* gitClient;
          const group = yield* groupCheckout(git, origin, credential, appId, "group");
          yield* group.write(
            { [AI_AGENT]: TIER, "0 — AI Agent/README.md": "# AI Agent\n", "README.md": "# Shop\n" },
            "The group's import files",
          );
          yield* group.push("P_MATE", number);

          // Nobody merges it: Core does.
          const landed = yield* stateBecomes(call, owner, appId, number, "merged");
          const main = yield* group.main;
          assert.strictEqual(landed["mergedSha"], main);
          yield* rowsWhere(
            url,
            `SELECT data->>'by' AS by FROM hq_git_event WHERE kind = 'merged' AND repo = '${RECIPE_REPO}'`,
            (rows) => rows[0]?.["by"] === "core",
          );
          assert.strictEqual(
            yield* git.checked(["log", "-1", "--format=%s", "origin/main"], group.work),
            `${RECIPE_PROPOSAL_TITLE} (#${String(number)})`,
          );

          // Reads: whoever reads the application's changes, and the Mate, its own.
          assert.deepStrictEqual((yield* tier(owner, "mate")).body, {
            state: "present",
            importYaml: TIER,
            mainHead: main,
          });
          assert.deepStrictEqual((yield* tier(owner, "stage")).body, { state: "absent" });
          const reader = yield* sessionFor(call, "door-reader");
          assert.strictEqual((yield* tier(reader, "mate")).status, 200);
          const dev = yield* sessionFor(call, "door-dev");
          assert.deepStrictEqual((yield* tier(dev, "mate")).body, {
            code: "forbidden",
            reason: "app_not_seen",
          });
          assert.strictEqual((yield* tier(owner, "ai-agent")).status, 400);
          const mateRead = yield* call("GET", "/api/mate/recipe/mate", { headers: auth });
          assert.deepStrictEqual(mateRead.body, {
            state: "present",
            importYaml: TIER,
            mainHead: main,
          });
          // A Mate in no application reads no recipe.
          addProject(fake, "P_LONE");
          yield* call("POST", "/api/mates", {
            session: owner,
            body: { projectId: "P_LONE", face: "face-3" },
          });
          const lone = yield* enrollMate(call, fake, "P_LONE");
          assert.deepStrictEqual(
            (yield* call("GET", "/api/mate/recipe/mate", {
              headers: { authorization: `Mate ${lone}` },
            })).body,
            { code: "forbidden", reason: "mate_not_in_app" },
          );
        }),
    );

    it.effect("a recipe change that edits a tier waits for a person, who merges it", () =>
      Effect.gen(function* () {
        const { call, fake, origin, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, credential, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
        const first = yield* propose(call, auth);
        const git = yield* gitClient;
        const group = yield* groupCheckout(git, origin, credential, appId, "group");
        yield* group.write({ [AI_AGENT]: TIER }, "The group's import files");
        yield* group.push("P_MATE", first);
        yield* stateBecomes(call, owner, appId, first, "merged");

        // The next one edits the tier main has, and adds the stage's.
        const second = yield* propose(call, auth);
        yield* group.main;
        yield* git.checked(["reset", "-q", "--hard", "origin/main"], group.work);
        const edited = TIER.replace("nodejs@22", "nodejs@24");
        yield* group.write({ [AI_AGENT]: edited, [STAGE]: TIER }, "Newer node");
        yield* group.push("P_MATE", second);
        const head = yield* git.checked(["rev-parse", "HEAD"], group.work);
        // Changes are judged one after another as pushed: once another Mate's later, add-only
        // change has landed, this one was judged before it.
        addProject(fake, "P_MATE2");
        yield* call("POST", `/api/apps/${appId}/projects`, {
          session: owner,
          body: { projectId: "P_MATE2", kind: "mate", mate: { face: "face-2" } },
        });
        const boCredential = yield* enrollMate(call, fake, "P_MATE2");
        const third = yield* propose(call, { authorization: `Mate ${boCredential}` });
        const bo = yield* groupCheckout(git, origin, boCredential, appId, "bo");
        yield* bo.write({ "4 — Small Production/import.yaml": TIER }, "The production's");
        yield* bo.push("P_MATE2", third);
        yield* stateBecomes(call, owner, appId, third, "merged");
        yield* stateBecomes(call, owner, appId, second, "open");
        yield* rowsWhere(
          url,
          `SELECT head FROM hq_change WHERE repo = '${RECIPE_REPO}' AND number = ${String(second)}`,
          (rows) => rows[0]?.["head"] === head,
        );
        // Whole as proposed, never a draft: it asks a person for review undescribed (review of
        // pass 42: drafts until described, recipe changes waited on nobody).
        const shown = yield* call(
          "GET",
          `/api/apps/${appId}/changes/${RECIPE_REPO}/${String(second)}`,
          { session: owner },
        );
        assert.isTrue((shown.body as { change: { ready: boolean } }).change.ready);

        const merged = yield* call(
          "POST",
          `/api/apps/${appId}/changes/${RECIPE_REPO}/${String(second)}/merge`,
          { session: owner, body: { expectedHead: head } },
        );
        assert.strictEqual(merged.status, 200);
        const read = (yield* call("GET", `/api/apps/${appId}/recipe/mate`, { session: owner }))
          .body as { readonly importYaml: string };
        assert.strictEqual(read.importYaml, edited);
      }),
    );

    it.effect(
      "a recipe change adding, otherwise, a tier a sibling's merge added meanwhile waits, its record saying it conflicts",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, ada, bo } = yield* twoMates(call, fake, owner);
          const adaNumber = yield* propose(call, ada.auth);
          const boNumber = yield* propose(call, bo.auth);
          const git = yield* gitClient;
          const adaWork = yield* groupCheckout(git, origin, ada.credential, appId, "ada");
          const boWork = yield* groupCheckout(git, origin, bo.credential, appId, "bo");
          // Both add the AI Agent tier, each its own.
          yield* adaWork.write({ [AI_AGENT]: TIER }, "Ada's tier");
          yield* boWork.write({ [AI_AGENT]: TIER.replace("api", "web") }, "Bo's tier");
          yield* adaWork.push("P_MATE", adaNumber);
          yield* stateBecomes(call, owner, appId, adaNumber, "merged");
          yield* boWork.push("P_MATE2", boNumber);
          // Not landed, and not closed: open for its Mate to propose again, and said to conflict.
          const left = yield* call("GET", `/api/apps/${appId}/changes`, {
            session: owner,
          }).pipe(
            Effect.map(
              (answer) =>
                (
                  answer.body as { readonly changes: ReadonlyArray<Record<string, unknown>> }
                ).changes.find(
                  (change) => change["repo"] === RECIPE_REPO && change["number"] === boNumber,
                ) ?? {},
            ),
            Effect.filterOrFail((change) => change["mergeability"] === "conflict"),
            Effect.retry(Schedule.spaced(Duration.millis(50))),
            Effect.timeout(Duration.seconds(10)),
          );
          assert.strictEqual(left["state"], "open");
        }),
    );

    it.effect(
      "a recipe change adding what a sibling's merge added meanwhile is judged against main: of nothing it is closed, beside a new tier it lands",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, ada, bo } = yield* twoMates(call, fake, owner);
          const adaNumber = yield* propose(call, ada.auth);
          const boNumber = yield* propose(call, bo.auth);
          const git = yield* gitClient;
          const adaWork = yield* groupCheckout(git, origin, ada.credential, appId, "ada");
          const boWork = yield* groupCheckout(git, origin, bo.credential, appId, "bo");
          yield* adaWork.write({ [AI_AGENT]: TIER }, "Ada's tier");
          yield* adaWork.push("P_MATE", adaNumber);
          yield* stateBecomes(call, owner, appId, adaNumber, "merged");
          // Bo's, from main as it was before Ada's: the same tier, byte for byte.
          yield* boWork.write({ [AI_AGENT]: TIER }, "Bo's tier");
          yield* boWork.push("P_MATE2", boNumber);
          yield* stateBecomes(call, owner, appId, boNumber, "closed");
          yield* rowsWhere(
            url,
            `SELECT data->>'by' AS by, data->>'reason' AS reason FROM hq_git_event
             WHERE kind = 'closed' AND number = ${String(boNumber)}`,
            (rows) => rows[0]?.["by"] === "core" && rows[0]?.["reason"] === "empty",
          );
          // Its next adds the stage's beside it: only that is new to main, and it lands.
          const next = yield* propose(call, bo.auth);
          const stage = TIER.replace("api", "web");
          yield* boWork.write({ [STAGE]: stage }, "The stage's");
          yield* boWork.push("P_MATE2", next);
          yield* stateBecomes(call, owner, appId, next, "merged");
          const tier = (name: string) =>
            Effect.map(
              call("GET", `/api/apps/${appId}/recipe/${name}`, { session: owner }),
              (read) => (read.body as { readonly importYaml?: string }).importYaml,
            );
          assert.deepStrictEqual([yield* tier("mate"), yield* tier("stage")], [TIER, stage]);
        }),
    );

    it.effect("a recipe change whose diff cannot be read is never landed", () =>
      Effect.gen(function* () {
        const { call, fake, origin, url, gitRoot } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, ada, bo } = yield* twoMates(call, fake, owner);
        const unread = yield* propose(call, ada.auth);
        const read = yield* propose(call, bo.auth);
        const git = yield* gitClient;
        const adaWork = yield* groupCheckout(git, origin, ada.credential, appId, "ada");
        // Past Ada's base, main grows a history longer than the git layer walks: what her
        // change does to it is unreadable (`invalid_config`), and so never judged.
        const dir = NodePath.join(gitRoot, appId, `${RECIPE_REPO}.git`);
        const bare = (args: ReadonlyArray<string>, input = "") =>
          NodeChildProcess.execFileSync("git", ["--git-dir", dir, ...args], {
            input,
            encoding: "utf8",
            env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1" },
          }).trim();
        const base = bare(["rev-parse", "refs/heads/main"]);
        const commits = Array.from(
          { length: 10_001 },
          (_, i) =>
            `commit refs/heads/long\ncommitter HQ <hq@hq.invalid> ${String(i)} +0000\ndata 0\n${
              i === 0 ? `from ${base}\n` : ""
            }\n`,
        );
        bare(["fast-import", "--quiet"], commits.join(""));
        bare(["update-ref", "refs/heads/main", "refs/heads/long", base]);
        bare(["update-ref", "-d", "refs/heads/long"]);
        yield* adaWork.write({ [AI_AGENT]: TIER }, "Ada's tier");
        yield* adaWork.push("P_MATE", unread);
        const boWork = yield* groupCheckout(git, origin, bo.credential, appId, "bo");
        yield* boWork.write({ [STAGE]: TIER }, "The stage's");
        yield* boWork.push("P_MATE2", read);
        // Changes are judged one after another as pushed: once Bo's has landed, Ada's was judged.
        yield* stateBecomes(call, owner, appId, read, "merged");
        yield* stateBecomes(call, owner, appId, unread, "open");
        yield* rowsWhere(
          url,
          `SELECT count(*)::int AS merged FROM hq_git_event
           WHERE kind = 'merged' AND number = ${String(unread)}`,
          (rows) => rows[0]?.["merged"] === 0,
        );
      }),
    );

    it.effect(
      "a recipe change past the read's bound is never landed: what it adds is not known",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, ada, bo } = yield* twoMates(call, fake, owner);
          const big = yield* propose(call, ada.auth);
          const small = yield* propose(call, bo.auth);
          const git = yield* gitClient;
          const adaWork = yield* groupCheckout(git, origin, ada.credential, appId, "ada");
          const boWork = yield* groupCheckout(git, origin, bo.credential, appId, "bo");
          // Every one a file added, one past the bound of what a read names.
          yield* adaWork.write(
            {
              [AI_AGENT]: TIER,
              ...Object.fromEntries(
                Array.from({ length: 1001 }, (_, i) => [`notes/${String(i)}.md`, `${String(i)}\n`]),
              ),
            },
            "Many notes",
          );
          yield* adaWork.push("P_MATE", big);
          yield* boWork.write({ [STAGE]: TIER }, "The stage's");
          yield* boWork.push("P_MATE2", small);
          // Changes are judged one after another as pushed: once Bo's has landed, Ada's was judged.
          yield* stateBecomes(call, owner, appId, small, "merged");
          yield* stateBecomes(call, owner, appId, big, "open");
          yield* rowsWhere(
            url,
            `SELECT count(*)::int AS merged FROM hq_git_event
           WHERE kind = 'merged' AND number = ${String(big)}`,
            (rows) => rows[0]?.["merged"] === 0,
          );
        }),
    );

    it.effect("an empty recipe change is closed by Core", () =>
      Effect.gen(function* () {
        const { call, fake, origin, url } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, credential, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
        const number = yield* propose(call, auth);
        const git = yield* gitClient;
        const group = yield* groupCheckout(git, origin, credential, appId, "group");
        // Its branch is main itself: nothing to add.
        yield* group.push("P_MATE", number, "origin/main");
        yield* stateBecomes(call, owner, appId, number, "closed");
        yield* rowsWhere(
          url,
          "SELECT data->>'by' AS by, data->>'reason' AS reason FROM hq_git_event WHERE kind = 'closed'",
          (rows) => rows[0]?.["by"] === "core" && rows[0]?.["reason"] === "empty",
        );
      }),
    );

    it.effect(
      "a recipe change by a Mate no longer of the application is never landed, at a takeover too",
      () =>
        Effect.gen(function* () {
          const first = yield* startCore(true);
          yield* untilHealth(first.call, "active");
          const owner = yield* sessionFor(first.call, "door-owner");
          const ada = yield* mateInApp(first.call, first.fake, owner, "P_MATE", "Shop");
          const adaNumber = yield* propose(first.call, ada.auth);
          addProject(first.fake, "P_MATE2");
          yield* first.call("POST", `/api/apps/${ada.appId}/projects`, {
            session: owner,
            body: { projectId: "P_MATE2", kind: "mate", mate: { face: "face-2" } },
          });
          const bo = {
            authorization: `Mate ${yield* enrollMate(first.call, first.fake, "P_MATE2")}`,
          };
          const boNumber = yield* propose(first.call, bo);
          // Ada leaves the application.
          yield* first.call("PUT", "/api/projects/P_MATE/app", {
            session: owner,
            body: { appId: null, kind: "mate" },
          });

          // Both branches written while no Core leads: each only adds a tier.
          const dir = NodePath.join(first.gitRoot, ada.appId, "group.git");
          const bare = (args: ReadonlyArray<string>, input = "") =>
            NodeChildProcess.execFileSync("git", ["--git-dir", dir, ...args], {
              input,
              encoding: "utf8",
              env: {
                PATH: process.env["PATH"] ?? "/usr/bin:/bin",
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_CONFIG_GLOBAL: "/dev/null",
                GIT_AUTHOR_NAME: "Ada",
                GIT_AUTHOR_EMAIL: "ada@mate.test",
                GIT_COMMITTER_NAME: "Ada",
                GIT_COMMITTER_EMAIL: "ada@mate.test",
              },
            }).trim();
          const main = bare(["rev-parse", "refs/heads/main"]);
          const adding = (mate: string, number: number, dirName: string) => {
            const blob = bare(["hash-object", "-w", "--stdin"], TIER);
            const inner = bare(["mktree"], `100644 blob ${blob}\timport.yaml\n`);
            const tree = bare(["mktree"], `040000 tree ${inner}\t${dirName}\n`);
            const commit = bare(["commit-tree", tree, "-p", main, "-m", `${mate}'s tier`]);
            bare(["update-ref", `refs/heads/mate/${mate}/${String(number)}`, commit]);
          };
          yield* first.stop;
          adding("P_MATE", adaNumber, "3 — Stage");
          adding("P_MATE2", boNumber, "4 — Small Production");

          // The next Core judges what was left open: Bo's lands, Ada's waits.
          const next = yield* startCore(true, {
            url: first.url,
            gitRoot: first.gitRoot,
            reconcileEvery: Duration.minutes(5),
          });
          addProject(next.fake, "P_MATE2");
          yield* untilHealth(next.call, "active");
          const nextOwner = yield* sessionFor(next.call, "door-owner-2");
          yield* stateBecomes(next.call, nextOwner, ada.appId, boNumber, "merged");
          yield* stateBecomes(next.call, nextOwner, ada.appId, adaNumber, "open");
        }),
    );

    it.effect(
      "a Mate asking for the recipe's repository joins Core's, made for an application older than it too",
      () =>
        Effect.gen(function* () {
          const { call, fake, url, gitRoot } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, ada, bo } = yield* twoMates(call, fake, owner);
          // An application made before its recipe had a repository.
          yield* rowsWhere(
            url,
            `DELETE FROM hq_repo WHERE name = '${RECIPE_REPO}' RETURNING 1`,
            (rows) => rows.length === 1,
          );
          NodeFS.rmSync(NodePath.join(gitRoot, appId, `${RECIPE_REPO}.git`), { recursive: true });
          for (const auth of [ada.auth, bo.auth]) {
            const joined = yield* call("POST", "/api/mate/repos", {
              headers: auth,
              body: { name: RECIPE_REPO },
            });
            assert.deepStrictEqual(
              [joined.status, joined.body],
              [200, { appId, name: RECIPE_REPO }],
            );
          }
          yield* rowsWhere(
            url,
            `SELECT created_by FROM hq_repo WHERE name = '${RECIPE_REPO}'`,
            (rows) => rows.length === 1 && rows[0]?.["created_by"] === "core",
          );
          assert.deepStrictEqual(
            (yield* call("GET", "/api/mate/recipe/mate", { headers: ada.auth })).body,
            { state: "absent" },
          );
        }),
    );

    it.effect("a tier past the read's bound is refused, never cut", () =>
      Effect.gen(function* () {
        const { call, fake, origin } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const { appId, credential, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
        const number = yield* propose(call, auth);
        const git = yield* gitClient;
        const group = yield* groupCheckout(git, origin, credential, appId, "group");
        yield* group.write(
          { [AI_AGENT]: `${TIER}${"# padding\n".repeat(120_000)}` },
          "A tier past the bound",
        );
        yield* group.push("P_MATE", number);
        yield* stateBecomes(call, owner, appId, number, "merged");
        const read = yield* call("GET", `/api/apps/${appId}/recipe/mate`, { session: owner });
        assert.deepStrictEqual(
          [read.status, read.body],
          [413, { code: "too_large", reason: "recipe_too_large" }],
        );
      }),
    );
  });
});
