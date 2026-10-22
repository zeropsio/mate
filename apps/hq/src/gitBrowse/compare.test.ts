import { assert, describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sessionFor, startCore, untilHealth } from "../../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../../test/harness/tempPostgres.ts";

const author = { name: "Ada", email: "ada@example.test" };

describe("Git browse compare routes", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("Comparing two branches shows what head adds since they split", () =>
      Effect.gen(function* () {
        const { call, gitHost } = yield* startCore(true, { viewTtl: Duration.zero });
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const outsider = yield* sessionFor(call, "door-dev");
        const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
        const appId = (made.body as { id: string }).id;
        const repo = { appId, id: "group" };
        const git = yield* gitHost.opened(Duration.seconds(3));
        const write = (files: Record<string, string | null>, message: string) =>
          Effect.gen(function* () {
            const main = (yield* git.branches(repo)).items.find(
              (branch) => branch.ref === "refs/heads/main",
            );
            const result = yield* git.commitFiles(repo, "refs/heads/main", {
              files,
              expectedHead: main?.sha ?? null,
              message,
              author,
            });
            if (!("sha" in result)) throw new Error(`write refused: ${result.kind}`);
            return result.sha;
          });
        const split = yield* write({ "a.txt": "one\n" }, "Start");
        yield* git.createTag(repo, "v1", split, "First release");
        const first = yield* write({ "a.txt": "two\n" }, "Change a");
        const head = yield* write({ "b.txt": "bee\n" }, "Add b");

        const base = `/api/apps/${appId}/repos/group/browse`;
        const read = yield* call("GET", `${base}/compare?base=v1&head=main`, { session: owner });
        assert.strictEqual(read.status, 200);
        expect(read.body).toMatchObject({
          base: { sha: split, ref: { name: "v1", kind: "tag" } },
          head: { sha: head, ref: { name: "main", kind: "branch" } },
          mergeBase: split,
          commits: [
            { sha: head, subject: "Add b", authorName: "Ada" },
            { sha: first, subject: "Change a", authorName: "Ada" },
          ],
          totalCommits: 2,
          files: [
            { path: "a.txt", status: "modified", additions: 1, deletions: 1 },
            { path: "b.txt", status: "added", additions: 1, deletions: 0 },
          ],
          totalFiles: 2,
          filesTruncated: false,
        });
        expect(JSON.stringify(read.body)).not.toContain("ada@example.test");
        // Both sides move with their refs: the answer is never kept.
        assert.strictEqual(read.headers.get("cache-control"), "no-store");

        const file = yield* call(
          "GET",
          `${base}/compare-file?base=${split}&head=${head}&path=b.txt`,
          { session: owner },
        );
        assert.strictEqual(file.status, 200);
        expect((file.body as { hunks: string }).hunks).toContain("+bee\n");
        assert.strictEqual(
          file.headers.get("cache-control"),
          "private, max-age=31536000, immutable",
        );

        const same = yield* call("GET", `${base}/compare?base=main&head=main`, { session: owner });
        expect(same.body).toMatchObject({ mergeBase: head, commits: [], totalCommits: 0 });

        for (const asked of [
          `${base}/compare?base=v1&head=main`,
          `${base}/compare-file?base=${split}&head=${head}&path=b.txt`,
        ]) {
          const refused = yield* call("GET", asked, { session: outsider });
          assert.strictEqual(refused.status, 403, asked);
        }
        for (const asked of [
          `${base}/compare?base=v1&head=nowhere`,
          `${base}/compare-file?base=${split}&head=${"f".repeat(40)}&path=b.txt`,
        ]) {
          const missing = yield* call("GET", asked, { session: owner });
          assert.strictEqual(missing.status, 404, asked);
          assert.deepStrictEqual(missing.body, {
            code: "commit_not_found",
            reason: "commit_not_found",
          });
        }
      }),
    );
  });
});
