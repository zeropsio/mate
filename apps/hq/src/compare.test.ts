// @effect-diagnostics nodeBuiltinImport:off -- the tests reach Core as zcp and a person do: over HTTP, the scope socket and git.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { gitClient } from "../test/harness/gitClient.ts";
import { mateWithChange, remoteOf, rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, ticketFor, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

interface Compared {
  readonly base: string | null;
  readonly head: string;
  readonly commits: ReadonlyArray<{
    readonly sha: string;
    readonly subject: string;
    readonly change: { readonly number: number } | null;
  }>;
  readonly truncated: boolean;
  readonly total: number;
}

describe("what lies between two commits of a repository", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("retires the HTTP comparison read", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        assert.strictEqual(
          (yield* call("GET", "/api/apps/unknown/repos/appdev/compare?head=main", {
            session: owner,
          })).status,
          404,
        );
      }).pipe(Effect.scoped),
    );
    /**
     * `appdev` with HQ's own first commit, then change 1 and change 2 merged, each a squash on
     * main; change 2's own commit, which main never holds; change 3 open with 101 commits.
     */
    const repository = Effect.gen(function* () {
      const { call, fake, origin, url, socket } = yield* startCore(true);
      yield* untilHealth(call, "active");
      const owner = yield* sessionFor(call, "door-owner");
      const { appId, credential, auth } = yield* mateWithChange(call, fake, owner);
      const git = yield* gitClient;
      yield* git.checked(["clone", remoteOf(origin, credential, appId, "appdev"), "work"]);
      const work = NodePath.join(git.dir, "work");
      const root = yield* git.checked(["rev-parse", "origin/main"], work);
      const headOf = git.checked(["rev-parse", "HEAD"], work);
      const mainOf = Effect.andThen(
        git.checked(["fetch", "-q", "origin"], work),
        git.checked(["rev-parse", "origin/main"], work),
      );
      /** Change `number`, pushed as one commit on main and merged: main's squash of it. */
      const land = (number: number, subject: string) =>
        Effect.gen(function* () {
          if (number > 1) {
            yield* call("POST", "/api/mate/changes", {
              headers: auth,
              body: { repo: "appdev", title: subject },
            });
          } else {
            yield* call("PATCH", "/api/mate/changes/appdev/1", {
              headers: auth,
              body: { title: subject },
            });
          }
          yield* git.checked(["checkout", "-q", "--detach", yield* mainOf], work);
          // A change that changes nothing does not merge.
          NodeFS.writeFileSync(NodePath.join(work, `change-${String(number)}.txt`), `${subject}\n`);
          yield* git.checked(["add", "."], work);
          yield* git.checked(["commit", "-q", "-m", subject], work);
          const head = yield* headOf;
          yield* git.checked(
            ["push", "-q", "origin", `HEAD:refs/heads/mate/P_MATE/${String(number)}`],
            work,
          );
          yield* rowsWhere(
            url,
            `SELECT head FROM hq_change WHERE number = ${String(number)}`,
            (rows) => rows[0]?.["head"] === head,
          );
          const merged = yield* call(
            "POST",
            `/api/apps/${appId}/changes/appdev/${String(number)}/merge`,
            {
              session: owner,
              body: { expectedHead: head },
            },
          ).pipe(
            Effect.filterOrFail((answer) => answer.status === 200),
            Effect.retry(Schedule.spaced(Duration.millis(50))),
            Effect.timeout(Duration.seconds(10)),
          );
          return {
            head,
            squash: String((merged.body as { readonly mergedSha: string }).mergedSha),
          };
        });
      const one = yield* land(1, "Add a login page");
      const two = yield* land(2, "Rename the form");
      yield* call("POST", "/api/mate/changes", {
        headers: auth,
        body: { repo: "appdev", title: "Long" },
      });
      // Main is change 2's squash now, as the fetch brings it.
      yield* git.checked(["checkout", "-q", "--detach", yield* mainOf], work);
      for (let i = 0; i < 101; i++) {
        yield* git.checked(["commit", "-q", "--allow-empty", "-m", `Step ${String(i)}`], work);
      }
      const long = yield* headOf;
      yield* git.checked(["push", "-q", "origin", "HEAD:refs/heads/mate/P_MATE/3"], work);
      let sequence = 0;
      const compare = (session: string, query: string, app = appId, repo = "appdev") =>
        Effect.gen(function* () {
          const client = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, session)}`,
          );
          yield* Effect.addFinalizer(() => client.close);
          assert.isTrue(client.opened);
          const params = new URLSearchParams(query);
          const requestId = `comparison-${++sequence}`;
          yield* client.send({
            type: "compare",
            requestId,
            appId: app,
            repo,
            ...(params.has("base") ? { base: params.get("base") } : {}),
            head: params.get("head"),
          });
          const reply = yield* client.takeWhere(
            "comparison reply",
            (message) => message.requestId === requestId,
          );
          assert.strictEqual(reply.appId, app);
          assert.strictEqual(reply.repo, repo);
          yield* client.close;
          return reply.type === "compare"
            ? { type: reply.type, body: reply.result }
            : {
                type: reply.type,
                body: { code: reply.code, reason: reply.reason },
                disposition: reply.disposition,
              };
        });
      return { call, fake, owner, appId, root, one, two, long, compare };
    });

    it.effect(
      "names what lies between both ways, each commit with the change whose merge it is",
      () =>
        Effect.gen(function* () {
          const { owner, one, two, compare } = yield* repository;
          const between = (query: string) =>
            Effect.map(compare(owner, query), (answer) => {
              assert.strictEqual(answer.type, "compare");
              return answer.body as Compared;
            });
          const forward = yield* between(`base=${one.squash}&head=${two.squash}`);
          assert.deepStrictEqual(
            [
              forward.base,
              forward.head,
              forward.commits.map((c) => [c.sha, c.subject, c.change?.number ?? null]),
              forward.truncated,
              forward.total,
            ],
            [one.squash, two.squash, [[two.squash, "Rename the form (#2)", 2]], false, 1],
          );
          // Change 2's own commit is no ancestor of main, nor main of it: each side has its own.
          const leaving = yield* between(`base=${two.head}&head=${two.squash}`);
          assert.deepStrictEqual(
            leaving.commits.map((c) => c.sha),
            [two.squash],
          );
          const coming = yield* between(`base=${two.squash}&head=${two.head}`);
          assert.deepStrictEqual(
            coming.commits.map((c) => [c.sha, c.change]),
            [[two.head, null]],
          );
          const nothing = yield* between(`base=${two.squash}&head=${two.squash}`);
          assert.deepStrictEqual([nothing.commits, nothing.total], [[], 0]);
        }).pipe(Effect.scoped),
    );

    it.effect("from the root, cut at its bound, naming HQ's own commit no change's", () =>
      Effect.gen(function* () {
        const { owner, root, one, two, long, compare } = yield* repository;
        const main = (yield* compare(owner, `head=${two.squash}`)).body as Compared;
        assert.deepStrictEqual(
          [
            main.base,
            main.commits.map((c) => [c.sha, c.change?.number ?? null]),
            main.truncated,
            main.total,
          ],
          [
            null,
            [
              [two.squash, 2],
              [one.squash, 1],
              [root, null],
            ],
            false,
            3,
          ],
        );
        const cut = (yield* compare(owner, `head=${long}`)).body as Compared;
        assert.deepStrictEqual(
          [cut.commits.length, cut.commits[0]?.subject, cut.truncated, cut.total],
          [100, "Step 100", true, 104],
        );
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a commit the repository lacks, and an unknown repository", () =>
      Effect.gen(function* () {
        const { owner, two, compare } = yield* repository;
        const unknown = "f".repeat(40);
        for (const query of [`head=${unknown}`, `base=${unknown}&head=${two.squash}`]) {
          assert.deepStrictEqual((yield* compare(owner, query)).body, {
            code: "commit_not_found",
            reason: "commit_not_found",
          });
        }
        assert.deepStrictEqual(
          (yield* compare(owner, `head=${two.squash}`, undefined, "nothing")).body,
          {
            code: "repo_not_found",
            reason: "repo_not_found",
          },
        );
      }).pipe(Effect.scoped),
    );

    it.effect("answers no one who may not read the application's changes, and leaks nothing", () =>
      Effect.gen(function* () {
        const { call, fake, two, compare } = yield* repository;
        const dev = yield* sessionFor(call, "door-dev");
        // Whether the repository or the commit exists or not, the same refusal.
        for (const [query, repo] of [
          [`head=${two.squash}`, "appdev"],
          [`head=${two.squash}`, "nothing"],
          [`head=${"f".repeat(40)}`, "appdev"],
        ] as const) {
          assert.deepStrictEqual((yield* compare(dev, query, undefined, repo)).body, {
            code: "forbidden",
            reason: "app_not_seen",
          });
        }
        assert.deepStrictEqual(
          (yield* compare(dev, `head=${two.squash}`, "0b7c4c1e-9f1d-4a43-8f43-6d2b8a1c2e10")).body,
          { code: "forbidden", reason: "app_not_seen" },
        );
        // Seeing the application's project read only is seeing it, not its changes.
        const project = fake.projects.find((candidate) => candidate.id === "P_MATE")!;
        Object.assign(project, { userRoles: [{ clientUserId: "C-dev", roleCode: "READ_ONLY" }] });
        const refused = yield* compare(dev, `head=${two.squash}`).pipe(
          Effect.filterOrFail(
            (answer) =>
              answer.type === "compare-error" &&
              (answer.body as { reason?: string }).reason === "changes_not_seen",
          ),
          Effect.retry(Schedule.spaced(Duration.millis(50))),
          Effect.timeout(Duration.seconds(5)),
        );
        assert.deepStrictEqual(refused.body, { code: "forbidden", reason: "changes_not_seen" });
      }).pipe(Effect.scoped),
    );
  });
});
