import { assert, describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sessionFor, startCore, untilHealth } from "../../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../../test/harness/tempPostgres.ts";

const author = { name: "Ada", email: "ada@example.test" };

/** An application whose `group` repository commits files onto `main`, read by its owner. */
const shop = Effect.gen(function* () {
  const { call, gitHost, sql } = yield* startCore(true, { viewTtl: Duration.zero });
  yield* untilHealth(call, "active");
  const owner = yield* sessionFor(call, "door-owner");
  const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
  const appId = (made.body as { id: string }).id;
  const repo = { appId, id: "group" };
  const git = yield* gitHost.opened(Duration.seconds(3));
  const write = (files: Record<string, string>, message: string) =>
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
  return { call, sql, owner, appId, write };
});

describe("Git browse blame route", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("Each line names the commit that last changed it", () =>
      Effect.gen(function* () {
        const { call, sql, owner, appId, write } = yield* shop;
        const outsider = yield* sessionFor(call, "door-dev");
        const start = yield* write({ "a.txt": "one\ntwo\nthree\n" }, "Start");
        const count = yield* write({ "a.txt": "one\n2\nthree\n" }, "Count with digits");
        yield* sql`
          INSERT INTO hq_change (app_id, repo, number, mate_project_id, branch, title, state, merged_sha)
          VALUES (${appId}::uuid, 'group', 4, 'P_ROBOT', 'mate/P_ROBOT/4', 'Count with digits', 'merged', ${count})`;

        const path = `/api/apps/${appId}/repos/group/browse/blame?sha=${count}&path=a.txt`;
        const read = yield* call("GET", path, { session: owner });
        assert.strictEqual(read.status, 200);
        expect(read.body).toEqual({
          ranges: [
            { start: 1, count: 1, commit: start },
            { start: 2, count: 1, commit: count },
            { start: 3, count: 1, commit: start },
          ],
          commits: expect.arrayContaining([
            expect.objectContaining({ sha: start, subject: "Start", authorName: "Ada" }),
            expect.objectContaining({
              sha: count,
              subject: "Count with digits",
              authorName: "Ada",
              previous: { sha: start, path: "a.txt" },
              change: { mateId: "P_ROBOT", number: 4 },
            }),
          ]),
        });
        const startCommit = (read.body as { commits: Array<{ sha: string }> }).commits.find(
          (commit) => commit.sha === start,
        );
        expect(startCommit).not.toHaveProperty("change");
        expect(startCommit).not.toHaveProperty("previous");
        expect(JSON.stringify(read.body)).not.toContain("ada@example.test");
        assert.strictEqual(
          read.headers.get("cache-control"),
          "private, max-age=31536000, immutable",
        );

        const refused = yield* call("GET", path, { session: outsider });
        assert.strictEqual(refused.status, 403);
        const gone = yield* call("GET", path.replace("a.txt", "b.txt"), { session: owner });
        assert.strictEqual(gone.status, 404);
        assert.deepStrictEqual(gone.body, { code: "path_not_found" });
      }),
    );

    it.effect("A file over 256 KiB offers no blame and says why", () =>
      Effect.gen(function* () {
        const { call, owner, appId, write } = yield* shop;
        const size = 256 * 1024 + 1;
        const sha = yield* write({ "big.txt": "x".repeat(size) }, "Big");
        const read = yield* call(
          "GET",
          `/api/apps/${appId}/repos/group/browse/blame?sha=${sha}&path=big.txt`,
          { session: owner },
        );
        assert.strictEqual(read.status, 413);
        assert.deepStrictEqual(read.body, { code: "too_large", limit: 256 * 1024, size });
      }),
    );
  });
});
