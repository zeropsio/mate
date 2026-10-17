import { assert, describe, it } from "@effect/vitest";
import type { MateTask } from "@t3tools/contracts";
import type { HqChange, HqChangeComment } from "@t3tools/shared/hqChanges";
import type { HqNavigationApp, HqNavigationProject } from "@t3tools/shared/hqStream";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { automatedPool, deliver, issueEvent } from "../test/harness/automated.ts";
import { rowsWhere } from "../test/harness/mates.ts";
import { ticketFor } from "../test/harness/runningCore.ts";
import { nextScopeValue, scopeReset } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { GithubMirror } from "./githubMirror.ts";
import { mateTaskLink } from "./mateTasks.ts";
import {
  CHECKS_GIVEN_UP,
  MATE_END,
  MATE_START,
  checksFailed,
  closersOnly,
  firstComment,
  mergeMessage,
  pullSection,
  withSection,
} from "./pullRequests.ts";
import { mateNameIn } from "./taskSources.ts";

const HEAD = "a".repeat(40);
const HEAD_2 = "b".repeat(40);

const NAV = { kind: "navigation" } as const;

/**
 * A pool whose repository `web` is reached through the organization's GitHub app (made and
 * installed on `acme/tea-shop` on the fake GitHub, its events delivered to its webhook) and
 * mirrored there: the mirror pushes a change's head to `mate/<n>-hotter-tea`, and following
 * GitHub moves nothing (the fake GitHub has no git).
 */
const mirroredPool = Effect.gen(function* () {
  const mirrored = { pushes: [] as Array<number>, syncs: 0 };
  const mirror = Layer.effect(
    GithubMirror,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return GithubMirror.of({
        repositoryOf: (_appId, repo) =>
          Effect.succeed(repo === "web" ? "acme/tea-shop" : undefined),
        pushChange: (appId, repo, number) =>
          Effect.gen(function* () {
            mirrored.pushes.push(number);
            const [row] = yield* sql<{ readonly head: string | null }>`
              SELECT head FROM hq_change
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`;
            return row?.head == null
              ? undefined
              : { branch: `mate/${String(number)}-hotter-tea`, sha: row.head };
          }).pipe(Effect.orDie),
        // HQ's main holds GitHub's squash already (`githubMergeOnMain`): following it moves nothing.
        sync: () =>
          Effect.sync(() => {
            mirrored.syncs += 1;
            return { kind: "same", sha: "f".repeat(40) } as const;
          }),
        follow: () => Effect.void,
      });
    }),
  );
  // The Mate's project is named under its application, as Zerops names it.
  const core = yield* automatedPool({
    githubMirror: mirror,
    pullRequestsEvery: Duration.millis(100),
    robotName: "Tea Shop - Juno",
  });
  // The organization's app, made and installed on `acme/tea-shop` through GitHub's pages, and the
  // application's repository `web` reached through it.
  core.github.state.installations.set(7001, {
    account: "acme",
    repositories: [{ id: 501, full_name: "acme/tea-shop" }],
  });
  const asked = yield* core.call("POST", "/api/org/github/manifest", {
    session: core.owner,
    body: { owner: "acme", name: "Tea Shop Mate", returnTo: "https://mate.zerops.io/settings" },
  });
  const view = asked.body as { readonly state: string; readonly manifest: string };
  yield* core.call("GET", `/api/github/app/created?code=code-1&state=${view.state}`);
  yield* core.call(
    "GET",
    `/api/github/app/installed?installation_id=7001&setup_action=install&state=${view.state}`,
  );
  const hook = {
    path: new URL(
      (JSON.parse(view.manifest) as { hook_attributes: { url: string } }).hook_attributes.url,
    ).pathname,
    secret: core.github.state.app.webhookSecret,
  };
  yield* core.sql`UPDATE hq_repo_remote SET host_repo_id = '501'`;
  const through = yield* core.call("PUT", `/api/apps/${core.appId}/repos/web/remote/app`, {
    session: core.owner,
    body: { repository: "acme/tea-shop" },
  });
  assert.strictEqual(through.status, 204);
  core.github.state.users.set("nova", { email: "owner@tea.test" });
  const dispatch = (name: string, payload: object) =>
    Effect.gen(function* () {
      const delivered = yield* deliver(core, hook, name, {
        repository: { full_name: "acme/tea-shop", private: true },
        sender: { login: "nova", type: "User" },
        ...payload,
      });
      assert.isBelow(delivered.status, 300);
    });
  /** Whether HQ wrote on GitHub as the app: with a token GitHub minted for its installation. */
  const asTheApp = (authorization: string | undefined) =>
    core.github.state.minted.some((minted) => authorization === `Bearer ${minted.token}`);
  // What HQ asked of GitHub before: the intake's webhook, made with the person's token.
  const since = core.github.state.seen.length;
  return { ...core, mirrored, dispatch, since, asTheApp };
});

type Pool = Effect.Success<typeof mirroredPool>;

/** The robot on issue 1, its change `web` 1 described at `head`; the task. */
const describedChange = (core: Pool, head = HEAD) =>
  Effect.gen(function* () {
    yield* core.call("POST", "/api/mate/repos", {
      headers: core.robot.auth,
      body: { name: "web" },
    });
    // The app's webhook delivers the repository's issues.
    yield* core.dispatch("issues", issueEvent("opened", { number: 1, labels: ["mate"] }));
    const frame = yield* core.robot.link.takeWhere(
      "the task of issue 1",
      (message) => message.type === "task",
    );
    const task = frame["task"] as MateTask;
    yield* core.robot.link.send({
      type: "task-state",
      report: { taskId: task.id, state: "accepted", conversationId: "conversation-1" },
    });
    yield* core.tasks((rows) => rows[0]?.["state"] === "working");
    yield* core.call("POST", "/api/mate/changes", {
      headers: core.robot.auth,
      body: { repo: "web", title: "Hotter tea" },
    });
    yield* core.sql`UPDATE hq_change SET head = ${head} WHERE repo = 'web' AND number = 1`;
    const described = yield* core.call("PATCH", "/api/mate/changes/web/1", {
      headers: core.robot.auth,
      body: { body: "Boils the water twice.\n\nAnd pours it slowly." },
    });
    assert.strictEqual(described.status, 200);
    return task;
  });

/** What HQ asked of GitHub at `path` with `method`, once it did. */
const asked = (core: Pool, method: string, path: string) =>
  Effect.map(
    core.github.seenWhere(`${method} ${path}`, (seen) =>
      seen.some((request) => request.method === method && request.path === path),
    ),
    (seen) => seen.filter((request) => request.method === method && request.path === path),
  );

const PULL = "/repos/acme/tea-shop/pulls/2";
const STATUS = "/repos/acme/tea-shop/issues/comments/101";

/** The issue's status line once it reads `words`. */
const statusSays = (core: Pool, words: string) =>
  core.github.seenWhere(words, (seen) =>
    seen.some(
      (request) =>
        request.method === "PATCH" &&
        request.path === STATUS &&
        (request.body as { body: string }).body.startsWith(words),
    ),
  );

const opened = (core: Pool) =>
  Effect.gen(function* () {
    const task = yield* describedChange(core);
    yield* asked(core, "POST", "/repos/acme/tea-shop/issues/2/comments");
    yield* rowsWhere(
      core.url,
      "SELECT pr_number FROM hq_pull_request",
      (rows) => rows.length === 1,
    );
    return task;
  });

/**
 * GitHub's squash as HQ's `main` holds it once it followed GitHub: the fake GitHub has no git, so
 * its merge names the commit `main` is at.
 */
const squashOnMain = (core: Pool) =>
  Effect.gen(function* () {
    const [repo] = yield* rowsWhere(
      core.url,
      "SELECT main_head FROM hq_repo WHERE name = 'web'",
      (rows) => typeof rows[0]?.["main_head"] === "string",
    );
    const sha = repo!["main_head"] as string;
    core.github.state.merge = { ...core.github.state.merge, sha };
    return sha;
  });

const changeOf = (core: Pool) =>
  Effect.map(
    core.call("GET", `/api/apps/${core.appId}/changes`, { session: core.owner }),
    (answer) =>
      (answer.body as { changes: ReadonlyArray<HqChange> }).changes.find(
        (change) => change.repo === "web",
      )!,
  );

describe("a change's pull request", () => {
  it("HQ's part of the body is replaced whole, and what people wrote around it stays", () => {
    const section = `${MATE_START}\nnew\n${MATE_END}`;
    assert.strictEqual(
      withSection(`Note above\n\n${MATE_START}\nold\n${MATE_END}\n\nNote below`, section),
      `Note above\n\n${section}\n\nNote below`,
    );
    assert.strictEqual(withSection("", section), section);
    assert.strictEqual(withSection("A person's words", section), `${section}\n\nA person's words`);
  });

  it("a merge's commit says the change's summary and credits who asked and its task", () => {
    assert.strictEqual(
      mergeMessage({
        description: "Boils the water twice.\n\nAnd pours it slowly.",
        coAuthor: { login: "nova", id: 7 },
        taskLink: "https://mate.zerops.io/mate/P1",
      }),
      "Boils the water twice.\n\nCo-authored-by: nova <7+nova@users.noreply.github.com>\nMate-Task: https://mate.zerops.io/mate/P1",
    );
    assert.strictEqual(mergeMessage({ description: "", coAuthor: null, taskLink: null }), "");
  });

  it("a Mate is named by its own name, never its application's prefix", () => {
    assert.strictEqual(mateNameIn("Tea Shop - Juno", "Tea Shop"), "Juno");
    assert.strictEqual(mateNameIn("Juno", "Tea Shop"), "Juno");
    assert.strictEqual(mateNameIn("Other - Juno", "Tea Shop"), "Other - Juno");
    assert.strictEqual(mateNameIn("Tea Shop - ", "Tea Shop"), "Tea Shop -");
  });

  it("a Mate's description in its pull request closes no issue and pings nobody; HQ's own Fixes line still does", () => {
    const body = pullSection({
      mate: "Juno",
      description:
        "Fixes #3, closes acme/samovar#4, resolved https://github.com/acme/tea-shop/issues/5. Thanks @nova and @acme/tea.",
      receipt: null,
      fixes: 1,
      taskLink: null,
      changeLink: "https://mate.zerops.io/change/a/web/1",
      requester: null,
    });
    const description = body.slice(0, body.indexOf("Fixes #1"));
    assert.notMatch(description, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b/iu);
    assert.notMatch(description, /#\d|@[\w-]/u);
    // It reads the same once the unseen joiners are taken out.
    assert.include(
      description.replaceAll("\u2060", ""),
      "Fixes #3, closes acme/samovar#4, resolved https://github.com/acme/tea-shop/issues/5. Thanks @nova and @acme/tea.",
    );
    assert.include(body, "\nFixes #1\n");
  });

  it("a body links its issue, its task, and who asked, and says how it was checked", () => {
    const body = pullSection({
      mate: "Juno",
      description: "Boils the water twice.",
      receipt: {
        at: "2026-10-17T10:00:00.000Z",
        parts: [
          {
            setup: "web",
            previewHostname: "webstage",
            deploy: "ok",
            workspaceClean: true,
            verified: true,
          },
        ],
      },
      fixes: 1,
      taskLink: "https://mate.zerops.io/mate/P1",
      changeLink: "https://mate.zerops.io/change/a/web/1",
      requester: { login: "nova" },
    });
    assert.include(body, "Boils the water twice.");
    assert.include(body, "`web`: deployed to its stage and verified");
    assert.include(body, "Fixes #1");
    assert.include(body, "Juno · [Mate task](https://mate.zerops.io/mate/P1) · Requested by @nova");
  });

  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a described change of a repository mirrored through the app opens a pull request by the app's bot, ready for review, saying what it does, fixing its issue, assigned to who asked, its first comment saying what its Mate will do",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          const [made] = yield* asked(core, "POST", "/repos/acme/tea-shop/pulls");
          const pull = made!.body as {
            title: string;
            head: string;
            base: string;
            body: string;
            draft: boolean;
          };
          assert.deepStrictEqual(
            { title: pull.title, head: pull.head, base: pull.base, draft: pull.draft },
            { title: "Hotter tea", head: "mate/1-hotter-tea", base: "main", draft: false },
          );
          assert.include(pull.body, "Boils the water twice.");
          assert.include(pull.body, "Fixes #1");
          assert.include(
            pull.body,
            `Juno · [Mate task](${mateTaskLink("P_ROBOT")}) · Requested by @nova`,
          );
          const [assigned] = yield* asked(core, "POST", "/repos/acme/tea-shop/issues/2/assignees");
          assert.deepStrictEqual(assigned!.body, { assignees: ["nova"] });
          const [first] = yield* asked(core, "POST", "/repos/acme/tea-shop/issues/2/comments");
          assert.isTrue((first!.body as { body: string }).body.startsWith(firstComment("Juno")));
          yield* statusSays(core, "**Juno** opened #2 for review.");
          // The bot writes everything on GitHub: never the person's token.
          assert.isTrue(
            core.github.state.seen
              .slice(core.since)
              .filter((request) => request.method !== "GET")
              .every((request) => core.asTheApp(request.authorization)),
          );
          const change = yield* changeOf(core);
          assert.deepStrictEqual(change.pullRequest, {
            number: 2,
            url: "https://github.com/acme/tea-shop/pull/2",
            state: "open",
          });
        }),
    );

    it.effect(
      "the menu reads a change's pull request, on the change and on its automated Mate's task, with its checks",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          yield* opened(core);
          core.github.state.checkRuns.set(HEAD, [
            { name: "test", status: "in_progress", conclusion: null },
          ]);
          yield* core.dispatch("check_run", {
            action: "completed",
            check_run: { head_sha: HEAD, pull_requests: [] },
          });
          const pending = {
            number: 2,
            url: "https://github.com/acme/tea-shop/pull/2",
            state: "open" as const,
            checks: "pending" as const,
          };
          const row = yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task?.pullRequest?.checks === "pending",
          );
          assert.deepStrictEqual(row.mate?.task?.pullRequest, pending);
          const app = yield* nextScopeValue<HqNavigationApp>(
            watching,
            NAV,
            `app:${core.appId}`,
            (read) =>
              Array.isArray(read.changes) && read.changes[0]?.pullRequest?.checks === "pending",
          );
          assert.deepStrictEqual(
            Array.isArray(app.changes) ? app.changes[0]?.pullRequest : undefined,
            pending,
          );
          yield* watching.close;
        }),
    );

    it.effect(
      "the issue's status line names the Mate by its own name and links where to follow it",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* describedChange(core);
          yield* statusSays(
            core,
            `**Juno** is on it — [follow along](${mateTaskLink("P_ROBOT")}).`,
          );
        }),
    );

    it.effect(
      "a later push and a new description edit only the pull request's Mate part, keeping what people wrote",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          const pull = core.github.state.pulls.get(2)!;
          core.github.state.pulls.set(2, { ...pull, body: `${pull.body}\n\nA reviewer's note.` });
          yield* core.sql`UPDATE hq_change SET head = ${HEAD_2} WHERE repo = 'web' AND number = 1`;
          yield* core.call("PATCH", "/api/mate/changes/web/1", {
            headers: core.robot.auth,
            body: { body: "Boils the water three times." },
          });
          const edited = yield* core.github.seenWhere("the body edited", (seen) =>
            seen.some(
              (request) =>
                request.method === "PATCH" &&
                request.path === PULL &&
                (request.body as { body?: string }).body?.includes("three times") === true,
            ),
          );
          const body = (
            edited.findLast((request) => request.path === PULL)!.body as { body: string }
          ).body;
          assert.include(body, "A reviewer's note.");
          assert.notInclude(body, "Boils the water twice.");
          yield* rowsWhere(
            core.url,
            "SELECT head_sha FROM hq_pull_request",
            (rows) => rows[0]?.["head_sha"] === HEAD_2,
          );
          assert.isTrue(core.mirrored.pushes.length >= 2);
        }),
    );

    it.effect(
      "Merge in Mate merges the pull request on GitHub at the head the person saw, crediting who asked, and the change is merged once HQ follows GitHub; the issue says so and closes",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          core.github.state.users.set("nova", { email: "owner@tea.test" });
          yield* opened(core);
          const squash = yield* squashOnMain(core);
          const merged = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: HEAD },
          });
          assert.strictEqual(merged.status, 200);
          assert.deepInclude(merged.body as HqChange, { state: "merged", mergedSha: squash });
          const [merge] = yield* asked(core, "PUT", `${PULL}/merge`);
          const asks = merge!.body as Record<string, string>;
          assert.strictEqual(asks["merge_method"], "squash");
          assert.strictEqual(asks["sha"], HEAD);
          assert.strictEqual(asks["commit_title"], "Hotter tea (#2)");
          assert.include(asks["commit_message"]!, "Boils the water twice.");
          assert.include(
            asks["commit_message"]!,
            "Co-authored-by: nova <1000+nova@users.noreply.github.com>",
          );
          assert.include(asks["commit_message"]!, `Mate-Task: ${mateTaskLink("P_ROBOT")}`);
          assert.isAtLeast(core.mirrored.syncs, 1);
          yield* statusSays(core, "Merged in #2.");
          yield* asked(core, "POST", "/repos/acme/tea-shop/issues/1/reactions");
          const [closed] = yield* asked(core, "PATCH", "/repos/acme/tea-shop/issues/1");
          assert.deepStrictEqual(closed!.body, { state: "closed", state_reason: "completed" });
        }),
    );

    it.effect(
      "a pull request someone else opened on the change's branch is never taken for the change's own",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          core.github.state.pulls.set(9, {
            title: "Not the Mate's",
            body: "",
            head: "mate/1-hotter-tea",
            state: "open",
            merged: false,
            author: "zoe",
          });
          core.github.state.pullNumber = 10;
          yield* describedChange(core);
          yield* core.github.seenWhere("the branch's pull requests read", (seen) =>
            seen.some((request) => request.method === "GET" && request.path.includes("/pulls?")),
          );
          // What HQ does with what it read happens at once; nothing may follow it.
          yield* Effect.sleep(Duration.millis(300));
          yield* rowsWhere(core.url, "SELECT 1 FROM hq_pull_request", (rows) => rows.length === 0);
          assert.isFalse(
            core.github.state.seen.some((request) =>
              request.path.startsWith("/repos/acme/tea-shop/issues/9/"),
            ),
          );
        }),
    );

    it.effect(
      "the pull request the app's bot opened before, its record lost, is the change's own",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          core.github.state.pulls.set(9, {
            title: "Hotter tea",
            body: "",
            head: "mate/1-hotter-tea",
            state: "open",
            merged: false,
            author: `${core.github.state.app.slug}[bot]`,
          });
          core.github.state.pullNumber = 10;
          yield* describedChange(core);
          yield* rowsWhere(
            core.url,
            "SELECT pr_number FROM hq_pull_request",
            (rows) => rows[0]?.["pr_number"] === 9,
          );
        }),
    );

    it.effect(
      "Merge in Mate refuses a pull request moved to merge into another branch than the default one",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          core.github.state.pulls.set(2, { ...core.github.state.pulls.get(2)!, base: "dev" });
          const refused = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: HEAD },
          });
          assert.strictEqual(refused.status, 409);
          assert.strictEqual((refused.body as { reason: string }).reason, "github_wrong_base");
          assert.isFalse(core.github.state.seen.some((request) => request.method === "PUT"));
        }),
    );

    it.effect(
      "GitHub refusing the merge refuses it in Mate in plain words, and nothing moves",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          core.github.state.merge = { status: 405, message: "Required status check is expected." };
          const refused = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: HEAD },
          });
          assert.strictEqual(refused.status, 409);
          assert.strictEqual((refused.body as { reason: string }).reason, "github_blocked");
          assert.strictEqual((yield* changeOf(core)).state, "open");
          assert.strictEqual(core.mirrored.syncs, 0);
        }),
    );

    it.effect(
      "a pull request merged on GitHub merges its change in Mate and says so on its issue",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          const squash = yield* squashOnMain(core);
          yield* core.dispatch("pull_request", {
            action: "closed",
            pull_request: {
              number: 2,
              merged: true,
              merge_commit_sha: squash,
              head: { sha: HEAD },
            },
          });
          yield* rowsWhere(
            core.url,
            "SELECT state, merged_sha FROM hq_change WHERE repo = 'web'",
            (rows) => rows[0]?.["state"] === "merged" && rows[0]?.["merged_sha"] === squash,
          );
          // The head GitHub merged is kept, whatever the change's head is by then.
          yield* rowsWhere(
            core.url,
            "SELECT merged_sha, merged_head FROM hq_pull_request",
            (rows) => rows[0]?.["merged_sha"] === squash && rows[0]?.["merged_head"] === HEAD,
          );
          yield* statusSays(core, "Merged in #2.");
        }),
    );

    it.effect(
      "a pull request closed unmerged on GitHub closes its change and ends its task stopped",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          const task = yield* opened(core);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "done" },
          });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          yield* core.dispatch("pull_request", {
            action: "closed",
            pull_request: { number: 2, merged: false },
          });
          yield* rowsWhere(
            core.url,
            "SELECT state FROM hq_change WHERE repo = 'web'",
            (rows) => rows[0]?.["state"] === "closed",
          );
          yield* core.tasks((rows) => rows[0]?.["state"] === "stopped");
          yield* statusSays(core, "Juno stopped: PR #⁠2 was closed.");
        }),
    );

    it.effect(
      "a pull request closed by someone who cannot write is opened again, saying who may close it, and its change stays open",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          core.github.state.roles.set("zoe", "triage");
          yield* opened(core);
          core.github.state.pulls.set(2, { ...core.github.state.pulls.get(2)!, state: "closed" });
          yield* core.dispatch("pull_request", {
            action: "closed",
            pull_request: { number: 2, merged: false },
            sender: { login: "zoe", type: "User" },
          });
          yield* core.github.seenWhere("said who may close it", (seen) =>
            seen.some(
              (request) =>
                request.path === "/repos/acme/tea-shop/issues/2/comments" &&
                (request.body as { body: string }).body.startsWith(closersOnly("Juno")),
            ),
          );
          assert.strictEqual(core.github.state.pulls.get(2)?.state, "open");
          assert.strictEqual((yield* changeOf(core)).state, "open");
          yield* core.tasks((rows) => rows[0]?.["state"] === "working");
        }),
    );

    it.effect("Close in Mate closes the pull request on GitHub with a line saying so", () =>
      Effect.gen(function* () {
        const core = yield* mirroredPool;
        yield* opened(core);
        // The test's head is HQ's record alone, never pushed to git: the close reviews none.
        yield* core.sql`UPDATE hq_change SET head = NULL WHERE repo = 'web' AND number = 1`;
        const closed = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/close`, {
          session: core.owner,
          body: { expectedHead: null },
        });
        assert.strictEqual(closed.status, 200);
        const edits = yield* core.github.seenWhere("closed on GitHub", (seen) =>
          seen.some(
            (request) =>
              request.method === "PATCH" &&
              request.path === PULL &&
              (request.body as { state?: string }).state === "closed",
          ),
        );
        assert.isTrue(
          edits.some(
            (request) =>
              request.path === "/repos/acme/tea-shop/issues/2/comments" &&
              (request.body as { body: string }).body.startsWith("Closed in Mate."),
          ),
        );
      }),
    );

    it.effect(
      "Close in Mate of a pull request GitHub merged meanwhile records it merged, says nothing on it, and never tries again",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          core.github.state.pulls.set(2, {
            ...core.github.state.pulls.get(2)!,
            state: "closed",
            merged: true,
            mergeSha: "e".repeat(40),
            headSha: HEAD,
          });
          yield* core.sql`UPDATE hq_change SET head = NULL WHERE repo = 'web' AND number = 1`;
          const closed = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/close`, {
            session: core.owner,
            body: { expectedHead: null },
          });
          assert.strictEqual(closed.status, 200);
          yield* rowsWhere(
            core.url,
            "SELECT state, merged_sha FROM hq_pull_request",
            (rows) => rows[0]?.["state"] === "merged" && rows[0]?.["merged_sha"] === "e".repeat(40),
          );
          // Sweeps run every 100 ms here: none of them asks GitHub again.
          yield* Effect.sleep(Duration.millis(400));
          const closes = core.github.state.seen.filter(
            (request) =>
              request.method === "PATCH" &&
              request.path === PULL &&
              (request.body as { state?: string }).state === "closed",
          );
          assert.strictEqual(closes.length, 1);
          assert.isFalse(
            core.github.state.seen.some(
              (request) =>
                request.path === "/repos/acme/tea-shop/issues/2/comments" &&
                (request.body as { body: string }).body.startsWith("Closed in Mate."),
            ),
          );
        }),
    );

    it.effect(
      "a review comment by a person who can write reaches the change's conversation and its task's Mate, with its file and line; a bot's, an aside or a reader's does not",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          core.github.state.roles.set("zoe", "read");
          yield* opened(core);
          const comment = (id: number, login: string, body: string, type = "User") =>
            core.dispatch("pull_request_review_comment", {
              action: "created",
              pull_request: { number: 2 },
              comment: { id, body, path: "src/kettle.ts", line: 3, user: { login, type } },
            });
          yield* comment(1, "zoe", "A reader's thought.");
          yield* comment(2, "lint[bot]", "A bot's thought.", "Bot");
          yield* comment(3, "nova", "Just thinking (aside).");
          yield* comment(4, "nova", "Boil it once more.");
          // GitHub delivers it again: it is kept once.
          yield* comment(4, "nova", "Boil it once more.");
          const said = yield* core.robot.link.takeWhere(
            "the review comment",
            (message) => message.type === "task-message",
          );
          assert.deepStrictEqual(said["message"], {
            id: "github:review_comment:4",
            from: "review",
            author: "nova",
            text: "`src/kettle.ts:3`: Boil it once more.",
          });
          const listed = yield* core.call("GET", `/api/apps/${core.appId}/changes/web/1/comments`, {
            session: core.owner,
          });
          const comments = (listed.body as { comments: ReadonlyArray<HqChangeComment> }).comments;
          assert.deepStrictEqual(
            comments.map((kept) => [kept.authorGithubLogin, kept.body]),
            [["nova", "`src/kettle.ts:3`: Boil it once more."]],
          );
        }),
    );

    it.effect(
      "failing checks on the pull request's head reach its task's Mate once per head, three heads at most, then a person is told",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          const heads = ["a", "b", "c", "d"].map((letter) => letter.repeat(40));
          for (const [index, head] of heads.entries()) {
            if (index > 0) {
              yield* core.sql`UPDATE hq_change SET head = ${head} WHERE repo = 'web' AND number = 1`;
              yield* rowsWhere(
                core.url,
                "SELECT head_sha FROM hq_pull_request",
                (rows) => rows[0]?.["head_sha"] === head,
              );
            }
            core.github.state.checkRuns.set(head, [
              {
                name: "test",
                status: "completed",
                conclusion: "failure",
                details_url: "https://ci.test/1",
              },
              { name: "lint", status: "completed", conclusion: "success" },
            ]);
            for (let twice = 0; twice < 2; twice++)
              yield* core.dispatch("check_run", {
                action: "completed",
                check_run: { head_sha: head, pull_requests: [] },
              });
            // GitHub's events are worked after HQ answers them: this head's, before the next.
            yield* rowsWhere(
              core.url,
              "SELECT checks_told_sha, checks_given_up FROM hq_pull_request",
              (rows) =>
                index < 3
                  ? rows[0]?.["checks_told_sha"] === head
                  : rows[0]?.["checks_given_up"] === true,
            );
          }
          const told: Array<string> = [];
          for (let message = 0; message < 3; message++)
            told.push(
              (
                (yield* core.robot.link.takeWhere(
                  "checks failed",
                  (frame) => frame.type === "task-message",
                ))["message"] as { text: string }
              ).text,
            );
          assert.deepStrictEqual(
            told,
            [0, 1, 2].map(() => checksFailed(2, ["test"], "https://ci.test/1")),
          );
          yield* rowsWhere(
            core.url,
            "SELECT count(*)::int AS n FROM hq_task_message",
            (rows) => rows[0]?.["n"] === 3,
          );
          yield* core.github.seenWhere("handed to a person", (seen) =>
            seen.some((request) =>
              (request.body as { body?: string } | undefined)?.body?.startsWith(CHECKS_GIVEN_UP),
            ),
          );
          const gaveUp = core.github.state.seen.filter(
            (request) =>
              request.path === "/repos/acme/tea-shop/issues/2/comments" &&
              (request.body as { body: string }).body.startsWith(CHECKS_GIVEN_UP),
          );
          assert.strictEqual(gaveUp.length, 1);
          const change = yield* changeOf(core);
          assert.strictEqual(change.pullRequest?.checks, "failing");
        }),
    );
  });
});
