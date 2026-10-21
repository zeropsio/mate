import { assert, describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sessionFor, startCore, untilHealth } from "../../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../../test/harness/tempPostgres.ts";

const author = { name: "Ada", email: "ada@example.test" };

describe("Git browse commit routes", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("A commit shows its message, author and each changed file with its counts", () =>
      Effect.gen(function* () {
        const { call, gitHost, sql } = yield* startCore(true, { viewTtl: Duration.zero });
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
        const before = yield* write({ "a.txt": "one\ntwo\n", "old.txt": "bye\n" }, "Start");
        const sha = yield* write(
          { "a.txt": "one\n2\nthree\n", "old.txt": null, "new.txt": "hi\n" },
          "Count to three\n\nThe second line is a number now.",
        );
        yield* sql`
          INSERT INTO hq_change (app_id, repo, number, mate_project_id, branch, title, state, merged_sha)
          VALUES (${appId}::uuid, 'group', 4, 'P_ROBOT', 'mate/P_ROBOT/4', 'Count to three', 'merged', ${sha})`;

        const path = `/api/apps/${appId}/repos/group/browse/commit?sha=${sha}`;
        const read = yield* call("GET", path, { session: owner });
        assert.strictEqual(read.status, 200);
        expect(read.body).toMatchObject({
          sha,
          parents: [before],
          subject: "Count to three",
          body: "The second line is a number now.",
          authorName: "Ada",
          change: { mateId: "P_ROBOT", number: 4 },
          files: [
            { path: "a.txt", status: "modified", additions: 2, deletions: 1, binary: false },
            { path: "new.txt", status: "added", additions: 1, deletions: 0 },
            { path: "old.txt", status: "deleted", additions: 0, deletions: 1 },
          ],
          totalFiles: 3,
          filesTruncated: false,
        });
        expect(JSON.stringify(read.body)).not.toContain("ada@example.test");
        assert.strictEqual(
          read.headers.get("cache-control"),
          "private, max-age=31536000, immutable",
        );

        const file = yield* call(
          "GET",
          `/api/apps/${appId}/repos/group/browse/commit-file?sha=${sha}&path=new.txt`,
          { session: owner },
        );
        assert.strictEqual(file.status, 200);
        expect((file.body as { hunks: string }).hunks).toContain("+hi\n");

        const earlier = yield* call(
          "GET",
          `/api/apps/${appId}/repos/group/browse/commit?sha=${before}`,
          { session: owner },
        );
        expect(earlier.body).not.toHaveProperty("change");

        for (const asked of [path, `${path.replace("commit?", "commit-file?")}&path=a.txt`]) {
          const refused = yield* call("GET", asked, { session: outsider });
          assert.strictEqual(refused.status, 403, asked);
        }
        const missing = yield* call(
          "GET",
          `/api/apps/${appId}/repos/group/browse/commit?sha=${"f".repeat(40)}`,
          { session: owner },
        );
        assert.strictEqual(missing.status, 404);
        assert.deepStrictEqual(missing.body, {
          code: "commit_not_found",
          reason: "commit_not_found",
        });
      }),
    );
  });
});
