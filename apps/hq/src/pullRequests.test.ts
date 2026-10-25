// @effect-diagnostics nodeBuiltinImport:off -- a change's commits are written into HQ's repository with the host's git.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { MateTask } from "@t3tools/contracts";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import type { HqChange, HqChangeComment } from "@t3tools/shared/hqChanges";
import type { HqNavigationApp, HqNavigationProject } from "@t3tools/shared/hqStream";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { ROBOT_TASK_LINK, automatedPool, deliver, issueEvent } from "../test/harness/automated.ts";
import { rowsWhere } from "../test/harness/mates.ts";
import { ticketFor } from "../test/harness/runningCore.ts";
import { nextScopeValue, scopeReset } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { GithubMirror, GithubMirrorUnavailable } from "./githubMirror.ts";
import {
  CHECKS_GIVEN_UP,
  MATE_END,
  MATE_START,
  checksFailed,
  closersOnly,
  pullClosed,
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
  const mirrored = { pushes: [] as Array<number>, syncs: 0, unreachable: false };
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
            const [row] = yield* sql<{ readonly head: string | null; readonly branch: string }>`
              SELECT head, branch FROM hq_change
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`;
            // A change on a branch its Mate named is that branch on GitHub.
            if (row?.head == null) return undefined;
            return row.branch.startsWith("mate/")
              ? { branch: `mate/${String(number)}-hotter-tea`, sha: row.head }
              : { branch: row.branch, sha: row.head };
          }).pipe(Effect.orDie),
        // HQ's main holds GitHub's squash already (`githubMergeOnMain`): following it moves nothing.
        sync: () =>
          Effect.suspend(() => {
            mirrored.syncs += 1;
            return mirrored.unreachable
              ? Effect.fail(new GithubMirrorUnavailable({ reason: "unreachable" }))
              : Effect.succeed({ kind: "same", sha: "f".repeat(40) } as const);
          }),
        follow: () => Effect.void,
        changes: Stream.empty,
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

/**
 * The robot on issue 1, its change `web` 1 described at `head`; the task. `reopened`: the task
 * ended done with nothing delivered, and a person's message in its conversation put its Mate back
 * on it before it delivered. `branch`: the branch the Mate opened it on, where it named one.
 */
const describedChange = (
  core: Pool,
  head = HEAD,
  described = true,
  reopened = false,
  branch?: string,
) =>
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
    if (reopened) {
      yield* core.robot.link.send({
        type: "task-state",
        report: { taskId: task.id, state: "done", conversationId: "conversation-1" },
      });
      yield* core.tasks((rows) => rows[0]?.["state"] === "done");
      yield* core.robot.link.send({
        type: "task-state",
        report: { taskId: task.id, state: "working", conversationId: "conversation-1" },
      });
      yield* core.tasks((rows) => rows[0]?.["state"] === "working");
    }
    yield* core.call("POST", "/api/mate/changes", {
      headers: core.robot.auth,
      body: { repo: "web", title: "Hotter tea", ...(branch === undefined ? {} : { branch }) },
    });
    yield* core.sql`UPDATE hq_change SET head = ${head} WHERE repo = 'web' AND number = 1`;
    if (!described) return task;
    const words = yield* core.call("PATCH", "/api/mate/changes/web/1", {
      headers: core.robot.auth,
      body: { body: "Boils the water twice.\n\nAnd pours it slowly." },
    });
    assert.strictEqual(words.status, 200);
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

const opened = (core: Pool, reopened = false) =>
  Effect.gen(function* () {
    const task = yield* describedChange(core, HEAD, true, reopened);
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

/** `git <args>` in HQ's repository `dir`, with no ambient configuration; its output. */
const bare = (dir: string, args: ReadonlyArray<string>, input = "") =>
  NodeChildProcess.execFileSync("git", ["--git-dir", dir, ...args], {
    input,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Juno",
      GIT_AUTHOR_EMAIL: "juno@mate.test",
      GIT_COMMITTER_NAME: "Juno",
      GIT_COMMITTER_EMAIL: "juno@mate.test",
    },
  }).trim();

/** A commit in `dir` holding only `file`, after `parents`. */
const commitIn = (dir: string, parents: ReadonlyArray<string>, file: string) => {
  const blob = bare(dir, ["hash-object", "-w", "--stdin"], file);
  const tree = bare(dir, ["mktree"], `100644 blob ${blob}\t${file}\n`);
  return bare(dir, ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", file]);
};

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
      alongside: [],
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
      alongside: [],
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

  it.each([
    ["deployed there after it", "2026-10-19T01:30:00Z", "ok", true],
    ["deployed there before it", "2026-10-19T01:10:00Z", "ok", false],
    ["failed to deploy there after it", "2026-10-19T01:30:00Z", "failed", false],
  ] as const)(
    "a pull request's preview says it shows another change of its Mate now when that one %s",
    (_, deployedAt, deploy, shown) => {
      const preview = (at: string, outcome: "ok" | "failed") => ({
        at,
        parts: [
          {
            setup: "web",
            previewHostname: "webstage-1.prg1.zerops.app",
            deploy: outcome,
            deployedAt: at,
            workspaceClean: true,
            verified: outcome === "ok",
          },
        ],
      });
      const body = pullSection({
        mate: "Juno",
        description: "Boils the water twice.",
        receipt: preview("2026-10-19T01:20:00Z", "ok"),
        alongside: [
          {
            number: 12,
            link: "https://mate.zerops.io/change/a/web/12",
            receipt: preview(deployedAt, deploy),
          },
        ],
        fixes: null,
        taskLink: null,
        changeLink: "https://mate.zerops.io/change/a/web/11",
        requester: null,
      });
      const line = body.split("\n").find((each) => each.includes("https://webstage-1"));
      assert.strictEqual(
        line,
        shown
          ? "- https://webstage-1.prg1.zerops.app — it shows [change #12](https://mate.zerops.io/change/a/web/12) now"
          : "- https://webstage-1.prg1.zerops.app",
      );
    },
  );

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
          assert.include(pull.body, `Juno · [Mate task](${ROBOT_TASK_LINK}) · Requested by @nova`);
          const [assigned] = yield* asked(core, "POST", "/repos/acme/tea-shop/issues/2/assignees");
          assert.deepStrictEqual(assigned!.body, { assignees: ["nova"] });
          const [first] = yield* asked(core, "POST", "/repos/acme/tea-shop/issues/2/comments");
          assert.isTrue((first!.body as { body: string }).body.startsWith(firstComment("Juno")));
          yield* statusSays(core, "**Juno** opened #2 for review.");
          // The bot writes everything on GitHub: never the person's token.
          assert.isTrue(
            core.github.state.seen
              .slice(core.since)
              // Minting the app's tokens for the repository is the app's too, with its JWT.
              .filter((request) => request.method !== "GET" && !request.path.startsWith("/app/"))
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
          // A live task never says it ended.
          assert.notProperty(row.mate?.task ?? {}, "ended");
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
      "a Mate whose finished task's change waits for review says its task is done, not ended",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          const task = yield* opened(core);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "done" },
          });
          const row = yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task?.done === true,
          );
          assert.strictEqual(row.mate?.task?.id, task.id);
          assert.isUndefined(row.mate?.task?.ended);
          yield* watching.close;
        }),
    );

    it.effect(
      "a free Mate's row keeps its last task, saying how it ended, with its pull request",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          const task = yield* opened(core);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "done" },
          });
          const squash = yield* squashOnMain(core);
          // A push after GitHub merged moves the change's head past what was merged.
          yield* core.sql`UPDATE hq_change SET head = ${HEAD_2} WHERE repo = 'web' AND number = 1`;
          yield* core.dispatch("pull_request", {
            action: "closed",
            pull_request: {
              number: 2,
              merged: true,
              merge_commit_sha: squash,
              head: { sha: HEAD },
            },
          });
          const row = yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task?.ended !== undefined,
          );
          assert.strictEqual(row.mate?.task?.id, task.id);
          assert.strictEqual(row.mate?.task?.ended, "merged");
          assert.deepInclude(row.mate?.task?.pullRequest ?? {}, { number: 2, state: "merged" });
          yield* watching.close;
        }),
    );

    it.effect(
      "the issue's status line names the Mate by its own name and links where to follow it",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* describedChange(core);
          yield* statusSays(core, `**Juno** is on it — [follow along](${ROBOT_TASK_LINK}).`);
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
          const edits = (request: { method: string; path: string; body: unknown }) =>
            request.method === "PATCH" &&
            request.path === PULL &&
            (request.body as { body?: string }).body?.includes("three times") === true;
          const edited = yield* core.github.seenWhere("the body edited", (seen) =>
            seen.some(edits),
          );
          const body = (edited.findLast(edits)!.body as { body: string }).body;
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
      "a pull request's preview says it shows another change of its Mate once that one deploys there",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          const preview = (at: string) => ({
            at,
            parts: [
              {
                setup: "web",
                previewHostname: "webstage-1.prg1.zerops.app",
                deploy: "ok",
                deployedAt: at,
                workspaceClean: true,
                verified: true,
              },
            ],
          });
          const bodyOnceIt = (what: string, says: string) => {
            const saying = (request: { method: string; path: string; body: unknown }) =>
              request.method === "PATCH" &&
              request.path === PULL &&
              (request.body as { body?: string }).body?.includes(says) === true;
            return Effect.map(
              core.github.seenWhere(what, (seen) => seen.some(saying)),
              (seen) => (seen.findLast(saying)!.body as { body: string }).body,
            );
          };
          const receipt = yield* core.call("PATCH", "/api/mate/changes/web/1", {
            headers: core.robot.auth,
            body: { receipt: preview("2026-10-19T01:20:00Z") },
          });
          assert.strictEqual(receipt.status, 200);
          const own = yield* bodyOnceIt("its preview", "- https://webstage-1.prg1.zerops.app");
          assert.notInclude(own, "it shows [change");
          // Another task of the same Mate delivers to a change of its own, and deploys the preview.
          yield* core.sql`
            INSERT INTO hq_change (app_id, repo, number, mate_project_id, branch, title, head, receipt)
            SELECT app_id, repo, 2, mate_project_id, 'mate/' || mate_project_id || '/2', 'Colder tea', ${HEAD_2},
              ${JSON.stringify(preview("2026-10-19T01:30:00Z"))}::jsonb
            FROM hq_change WHERE repo = 'web' AND number = 1`;
          const now = yield* bodyOnceIt("the preview another change shows", "it shows [change #2]");
          assert.include(
            now,
            `- https://webstage-1.prg1.zerops.app — it shows [change #2](${DEFAULT_HOSTED_APP_URL}`,
          );
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
          // GitHub's merge writes the repository's contents: the bot's token for it may.
          assert.deepStrictEqual(
            core.github.state.minted.find(
              (token) => `Bearer ${token.token}` === merge!.authorization,
            )?.permissions,
            { contents: "write", pull_requests: "write" },
          );
          const asks = merge!.body as Record<string, string>;
          assert.strictEqual(asks["merge_method"], "squash");
          assert.strictEqual(asks["sha"], HEAD);
          assert.strictEqual(asks["commit_title"], "Hotter tea (#2)");
          assert.include(asks["commit_message"]!, "Boils the water twice.");
          assert.include(
            asks["commit_message"]!,
            "Co-authored-by: nova <1000+nova@users.noreply.github.com>",
          );
          assert.include(asks["commit_message"]!, `Mate-Task: ${ROBOT_TASK_LINK}`);
          assert.isAtLeast(core.mirrored.syncs, 1);
          yield* statusSays(core, "Merged in #2.");
          yield* asked(core, "POST", "/repos/acme/tea-shop/issues/1/reactions");
          const [closed] = yield* asked(core, "PATCH", "/repos/acme/tea-shop/issues/1");
          assert.deepStrictEqual(closed!.body, { state: "closed", state_reason: "completed" });
        }),
    );

    it.effect(
      "a person's message on a done task reopens it, and its delivery opens the task's own change",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          const task = yield* opened(core, true);
          const [row] = yield* rowsWhere(
            core.url,
            "SELECT id::text AS id, change_repo, change_number FROM hq_task",
            (rows) => rows.length === 1,
          );
          assert.deepStrictEqual(row, { id: task.id, change_repo: "web", change_number: 1 });
          const [made] = yield* asked(core, "POST", "/repos/acme/tea-shop/pulls");
          assert.include((made!.body as { body: string }).body, "Fixes #1");
          yield* statusSays(core, "**Juno** opened #2 for review.");
        }),
    );

    it.effect("merging that change closes the task's issue", () =>
      Effect.gen(function* () {
        const core = yield* mirroredPool;
        const task = yield* opened(core, true);
        yield* core.robot.link.send({
          type: "task-state",
          report: { taskId: task.id, state: "done", conversationId: "conversation-1" },
        });
        yield* core.tasks((rows) => rows[0]?.["state"] === "done");
        yield* squashOnMain(core);
        const merged = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
          session: core.owner,
          body: { expectedHead: HEAD },
        });
        assert.strictEqual(merged.status, 200);
        yield* statusSays(core, "Merged in #2.");
        const [closed] = yield* asked(core, "PATCH", "/repos/acme/tea-shop/issues/1");
        assert.deepStrictEqual(closed!.body, { state: "closed", state_reason: "completed" });
      }),
    );

    it.effect(
      "a person's word after its task's change was merged leaves the task done, its issue saying merged",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          const task = yield* opened(core, true);
          const word = (state: string) =>
            core.robot.link.send({
              type: "task-state",
              report: { taskId: task.id, state, conversationId: "conversation-1" },
            });
          yield* word("done");
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          yield* squashOnMain(core);
          yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: HEAD },
          });
          yield* statusSays(core, "Merged in #2.");
          // "Thanks" in its conversation: the Mate is at it again, then done.
          yield* word("working");
          yield* word("done");
          yield* Effect.sleep(Duration.millis(300));
          const [row] = yield* core.tasks((rows) => rows.length === 1);
          assert.strictEqual(row!["state"], "done");
          const lines = core.github.state.seen.filter(
            (request) => request.method === "PATCH" && request.path === STATUS,
          );
          assert.isTrue((lines.at(-1)!.body as { body: string }).body.startsWith("Merged in #2."));
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
      "a change its Mate opened on a branch it named opens its pull request from that branch, as the app",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* describedChange(core, HEAD, true, false, "fix-x");
          const [made] = yield* asked(core, "POST", "/repos/acme/tea-shop/pulls");
          assert.strictEqual((made!.body as { head: string }).head, "fix-x");
          assert.isTrue(core.asTheApp(made!.authorization));
          yield* rowsWhere(
            core.url,
            "SELECT pr_number, head_sha FROM hq_pull_request",
            (rows) => rows[0]?.["pr_number"] === 2 && rows[0]?.["head_sha"] === HEAD,
          );
        }),
    );

    it.effect(
      "the open pull request on a named change's branch, whoever opened it from the repository itself, is the change's: HQ says its part in it, and Merge in Mate writes mate/gate and merges it",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          core.github.state.pulls.set(9, {
            title: "Fix x",
            body: "Nova's words.",
            head: "fix-x",
            state: "open",
            merged: false,
            author: "nova",
          });
          core.github.state.pullNumber = 10;
          yield* describedChange(core, HEAD, true, false, "fix-x");
          yield* rowsWhere(
            core.url,
            "SELECT pr_number FROM hq_pull_request",
            (rows) => rows[0]?.["pr_number"] === 9,
          );
          const [edited] = yield* asked(core, "PATCH", "/repos/acme/tea-shop/pulls/9");
          const body = (edited!.body as { body: string }).body;
          assert.include(body, "Nova's words.");
          assert.include(body, "Boils the water twice.");
          yield* squashOnMain(core);
          const merged = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: HEAD },
          });
          assert.strictEqual(merged.status, 200);
          const seen = core.github.state.seen;
          const gate = seen.findIndex(
            (request) =>
              request.method === "POST" && request.path === `/repos/acme/tea-shop/statuses/${HEAD}`,
          );
          const merge = seen.findIndex(
            (request) =>
              request.method === "PUT" && request.path === "/repos/acme/tea-shop/pulls/9/merge",
          );
          assert.isAtLeast(gate, 0);
          assert.isBelow(gate, merge);
          assert.deepInclude(seen[gate]!.body as object, {
            state: "success",
            context: "mate/gate",
          });
          assert.deepInclude(merged.body as HqChange, { state: "merged" });
        }),
    );

    it.effect(
      "a pull request from a fork's branch of the same name is never taken for a named change's own",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          core.github.state.pulls.set(9, {
            title: "Not the Mate's",
            body: "",
            head: "fix-x",
            state: "open",
            merged: false,
            author: "zoe",
            headRepoId: 777,
          });
          core.github.state.pullNumber = 10;
          yield* describedChange(core, HEAD, true, false, "fix-x");
          yield* core.github.seenWhere("the branch's pull requests read", (seen) =>
            seen.some((request) => request.method === "GET" && request.path.includes("/pulls?")),
          );
          // What HQ does with what it read happens at once; nothing may follow it.
          yield* Effect.sleep(Duration.millis(300));
          yield* rowsWhere(core.url, "SELECT 1 FROM hq_pull_request", (rows) => rows.length === 0);
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
      "Merge in Mate never squashes a mirrored change in HQ: before its pull request is open, it refuses",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* describedChange(core, HEAD, false);
          const refused = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: HEAD },
          });
          assert.strictEqual(refused.status, 409);
          assert.strictEqual((refused.body as { reason: string }).reason, "github_no_pull");
          assert.strictEqual((yield* changeOf(core)).state, "open");
        }),
    );

    it.effect(
      "a merge GitHub made that HQ could not follow yet answers so, and the sweep finishes it",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          yield* squashOnMain(core);
          core.mirrored.unreachable = true;
          const answer = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: HEAD },
          });
          assert.strictEqual(answer.status, 409);
          assert.strictEqual((answer.body as { reason: string }).reason, "github_landing");
          assert.strictEqual(core.github.state.pulls.get(2)?.merged, true);
          core.mirrored.unreachable = false;
          yield* rowsWhere(
            core.url,
            "SELECT state FROM hq_change WHERE repo = 'web'",
            (rows) => rows[0]?.["state"] === "merged",
          );
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
          // A push after GitHub merged moves the change's head past what was merged.
          yield* core.sql`UPDATE hq_change SET head = ${HEAD_2} WHERE repo = 'web' AND number = 1`;
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
          // The head GitHub merged is the one that landed, whatever the change's head is by then.
          yield* rowsWhere(
            core.url,
            "SELECT merged_sha, merged_head FROM hq_pull_request",
            (rows) => rows[0]?.["merged_sha"] === squash && rows[0]?.["merged_head"] === HEAD,
          );
          yield* rowsWhere(
            core.url,
            "SELECT landed_head FROM hq_change WHERE repo = 'web'",
            (rows) => rows[0]?.["landed_head"] === HEAD,
          );
          yield* statusSays(core, "Merged in #2.");
        }),
    );

    it.effect(
      "Merge in Mate writes mate/gate = success as the app on the head the person saw before GitHub merges it, records who, and the change lands in Mate",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          yield* squashOnMain(core);
          const merged = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: HEAD },
          });
          assert.strictEqual(merged.status, 200);
          const seen = core.github.state.seen;
          const gate = seen.findIndex(
            (request) =>
              request.method === "POST" && request.path === `/repos/acme/tea-shop/statuses/${HEAD}`,
          );
          const merge = seen.findIndex(
            (request) => request.method === "PUT" && request.path === `${PULL}/merge`,
          );
          assert.isAtLeast(gate, 0);
          assert.isBelow(gate, merge);
          assert.deepInclude(seen[gate]!.body as object, {
            state: "success",
            context: "mate/gate",
          });
          // HQ's own token for it: Commit statuses alone.
          assert.deepStrictEqual(
            core.github.state.minted.find(
              (token) => `Bearer ${token.token}` === seen[gate]!.authorization,
            )?.permissions,
            { statuses: "write" },
          );
          const [blessed] = yield* core.sql<{ sha: string; by: string }>`
            SELECT sha, by FROM hq_gate`;
          assert.deepStrictEqual(blessed, { sha: HEAD, by: "owner" });
          const [change] = yield* core.sql<{ landed_outside: boolean }>`
            SELECT landed_outside FROM hq_change WHERE repo = 'web'`;
          assert.strictEqual(change?.landed_outside, false);
          assert.strictEqual((yield* changeOf(core)).landedOutside, false);
        }),
    );

    it.effect(
      "an installation that has not approved writing commit statuses still merges in Mate, without mate/gate, and the change lands in Mate",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          const before = {
            contents: "write",
            pull_requests: "write",
            issues: "write",
            metadata: "read",
            checks: "read",
            statuses: "read",
            actions: "read",
          };
          core.github.state.installations.get(7001)!.permissions = before;
          yield* core.sql`UPDATE hq_github_installation SET permissions = ${JSON.stringify(before)}::jsonb`;
          yield* opened(core);
          const squash = yield* squashOnMain(core);
          const merged = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: HEAD },
          });
          assert.strictEqual(merged.status, 200);
          assert.deepInclude(merged.body as HqChange, { state: "merged", mergedSha: squash });
          assert.deepStrictEqual(core.github.state.statuses, []);
          // Nothing asked of GitHub for it: no gate token, no status sent to be refused.
          assert.deepStrictEqual(
            [
              core.github.state.seen.filter((request) => request.path.includes("/statuses/")),
              core.github.state.minted.filter((token) => "statuses" in (token.permissions ?? {})),
            ],
            [[], []],
          );
          const [change] = yield* core.sql<{ landed_outside: boolean }>`
            SELECT landed_outside FROM hq_change WHERE repo = 'web'`;
          assert.strictEqual(change?.landed_outside, false);
        }),
    );

    it.effect(
      "a GitHub merge of a head HQ never blessed lands outside Mate and is not auto-released",
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
            "SELECT state, landed_outside FROM hq_change WHERE repo = 'web'",
            (rows) => rows[0]?.["state"] === "merged" && rows[0]?.["landed_outside"] === true,
          );
          // Said to the change's readers as HQ records it.
          assert.strictEqual((yield* changeOf(core)).landedOutside, true);
          const releases = yield* core.sql`SELECT 1 FROM hq_rollout WHERE cause = 'release'`;
          assert.strictEqual(releases.length, 0);
        }),
    );

    /**
     * A person presses Merge in Mate at `HEAD`, GitHub refuses HQ's merge (its own rule wants a
     * review), and someone merges the pull request on GitHub later at `landedHead`: whether the
     * change landed outside Mate.
     */
    const mergedOnGithubAfterPress = (landedHead: string) =>
      Effect.gen(function* () {
        const core = yield* mirroredPool;
        yield* opened(core);
        const squash = yield* squashOnMain(core);
        core.github.state.merge = {
          status: 405,
          message: "At least 1 approving review is required by reviewers with write access.",
        };
        const refused = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
          session: core.owner,
          body: { expectedHead: HEAD },
        });
        assert.strictEqual(refused.status, 409);
        yield* core.dispatch("pull_request", {
          action: "closed",
          pull_request: {
            number: 2,
            merged: true,
            merge_commit_sha: squash,
            head: { sha: landedHead },
          },
        });
        const [row] = yield* rowsWhere(
          core.url,
          "SELECT state, landed_outside FROM hq_change WHERE repo = 'web'",
          (rows) => rows[0]?.["state"] === "merged",
        );
        return row!["landed_outside"];
      });

    it.effect("a GitHub merge of the head a person merged in Mate lands in Mate", () =>
      Effect.map(mergedOnGithubAfterPress(HEAD), (outside) => assert.strictEqual(outside, false)),
    );

    it.effect(
      "a GitHub merge of a head pushed after a person merged in Mate lands outside Mate",
      () =>
        Effect.map(mergedOnGithubAfterPress(HEAD_2), (outside) =>
          assert.strictEqual(outside, true),
        ),
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
      "a pull request merged on GitHub whose event never came is found by the sweep, and its change merged here",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          const squash = yield* squashOnMain(core);
          core.github.state.pulls.set(2, {
            ...core.github.state.pulls.get(2)!,
            state: "closed",
            merged: true,
            mergeSha: squash,
            headSha: HEAD,
          });
          yield* rowsWhere(
            core.url,
            "SELECT state, merged_sha FROM hq_change WHERE repo = 'web'",
            (rows) => rows[0]?.["state"] === "merged" && rows[0]?.["merged_sha"] === squash,
          );
          yield* statusSays(core, "Merged in #2.");
        }),
    );

    it.effect(
      "a pull request closed on GitHub whose event never came is found by the sweep: its change closes and its Mate is told to stop",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          const task = yield* opened(core);
          core.github.state.pulls.set(2, {
            ...core.github.state.pulls.get(2)!,
            state: "closed",
            closedBy: { login: "nova", type: "User" },
          });
          yield* rowsWhere(
            core.url,
            "SELECT state FROM hq_change WHERE repo = 'web'",
            (rows) => rows[0]?.["state"] === "closed",
          );
          const stop = yield* core.robot.link.takeWhere(
            "told to stop",
            (frame) => frame.type === "task-stop",
          );
          assert.deepInclude(stop, { taskId: task.id, reason: pullClosed(2) });
        }),
    );

    it.effect(
      "a pull request recorded closed while its change stayed open is finished by the sweep",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* opened(core);
          yield* core.sql`UPDATE hq_pull_request SET state = 'closed'`;
          yield* rowsWhere(
            core.url,
            "SELECT state FROM hq_change WHERE repo = 'web'",
            (rows) => rows[0]?.["state"] === "closed",
          );
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

    it.effect.each([
      ["a person closes it in Mate", "person"],
      ["its Mate closes it", "mate"],
    ] as const)(
      "a change on a branch its Mate named closes its pull request on GitHub as it closes: %s",
      ([_who, by]) =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          // Off any task, the Mate opens a change on a branch it names, and describes it.
          yield* core.call("POST", "/api/mate/repos", {
            headers: core.robot.auth,
            body: { name: "web" },
          });
          yield* core.call("POST", "/api/mate/changes", {
            headers: core.robot.auth,
            body: { repo: "web", title: "Hotter tea", branch: "fix-x" },
          });
          yield* core.sql`UPDATE hq_change SET head = ${HEAD} WHERE repo = 'web' AND number = 1`;
          yield* core.call("PATCH", "/api/mate/changes/web/1", {
            headers: core.robot.auth,
            body: { body: "Boils the water twice." },
          });
          const [made] = yield* asked(core, "POST", "/repos/acme/tea-shop/pulls");
          assert.strictEqual((made!.body as { head: string }).head, "fix-x");
          yield* rowsWhere(
            core.url,
            "SELECT pr_number FROM hq_pull_request",
            (rows) => rows[0]?.["pr_number"] === 2,
          );
          // The test's head is HQ's record alone, never pushed to git: the close reviews none.
          yield* core.sql`UPDATE hq_change SET head = NULL WHERE repo = 'web' AND number = 1`;
          const closed =
            by === "person"
              ? yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/close`, {
                  session: core.owner,
                  body: { expectedHead: null },
                })
              : yield* core.call("POST", "/api/mate/changes/web/1/close", {
                  headers: core.robot.auth,
                });
          assert.strictEqual(closed.status, 200);
          yield* core.github.seenWhere("closed on GitHub", (seen) =>
            seen.some(
              (request) =>
                request.method === "PATCH" &&
                request.path === PULL &&
                (request.body as { state?: string }).state === "closed",
            ),
          );
        }),
    );

    it.effect.each([
      [
        "the first change into a repository holding nothing, carrying another repository's history, as a merge commit",
        "theirs",
        "merge",
      ],
      ["a change of the repository's own history, as a squash", "own", "squash"],
    ] as const)(
      "Merge in Mate merges a change's pull request on GitHub keeping its commits only where it carries another repository's history into an empty repository: %s",
      ([_name, history, method]) =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          yield* core.call("POST", "/api/mate/repos", {
            headers: core.robot.auth,
            body: { name: "web" },
          });
          // Written into HQ's repository, its main still HQ's empty first commit.
          const dir = NodePath.join(core.gitRoot, core.appId, "web.git");
          const main = bare(dir, ["rev-parse", "refs/heads/main"]);
          const theirs = commitIn(dir, [commitIn(dir, [], "README.md")], "kettle.ts");
          const head =
            history === "theirs"
              ? bare(dir, [
                  "commit-tree",
                  `${theirs}^{tree}`,
                  "-p",
                  main,
                  "-p",
                  theirs,
                  "-m",
                  "Join the repository's base",
                ])
              : commitIn(dir, [main], "kettle.ts");
          bare(dir, ["update-ref", "refs/heads/mate/P_ROBOT/1", head]);
          yield* describedChange(core, head);
          yield* asked(core, "POST", "/repos/acme/tea-shop/issues/2/comments");
          yield* squashOnMain(core);
          const merged = yield* core.call("POST", `/api/apps/${core.appId}/changes/web/1/merge`, {
            session: core.owner,
            body: { expectedHead: head },
          });
          assert.strictEqual(merged.status, 200);
          const [put] = yield* asked(core, "PUT", `${PULL}/merge`);
          assert.strictEqual((put!.body as { merge_method: string }).merge_method, method);
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
      "a task that couldn't finish what a review asked says so on the pull request where the reviewer wrote, and on its issue",
      () =>
        Effect.gen(function* () {
          const core = yield* mirroredPool;
          const task = yield* opened(core);
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "done", conversationId: "conversation-1" },
          });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          yield* core.dispatch("pull_request_review", {
            action: "submitted",
            pull_request: { number: 2 },
            review: {
              id: 7,
              body: "Boil it once more.",
              state: "commented",
              user: { login: "nova", type: "User" },
            },
          });
          yield* core.robot.link.takeWhere("the review", (frame) => frame.type === "task-message");
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "working", conversationId: "conversation-1" },
          });
          yield* core.tasks((rows) => rows[0]?.["state"] === "working");
          yield* core.robot.link.send({
            type: "task-state",
            report: { taskId: task.id, state: "failed", detail: "It reached its $5 limit." },
          });
          const words = "Juno couldn't finish this: It reached its $5 limit.";
          yield* statusSays(core, words);
          const onPull = (seen: ReadonlyArray<{ method: string; path: string; body?: unknown }>) =>
            seen.filter(
              (request) =>
                request.method === "POST" &&
                request.path === "/repos/acme/tea-shop/issues/2/comments" &&
                (request.body as { body: string }).body.startsWith(words),
            );
          yield* core.github.seenWhere(
            "said on the pull request",
            (seen) => onPull(seen).length > 0,
          );
          assert.strictEqual(onPull(core.github.state.seen).length, 1);
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
