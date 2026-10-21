import { assert, describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sessionFor, startCore, untilHealth } from "../../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../../test/harness/tempPostgres.ts";
import { browseResponse } from "./routes.ts";

const author = { name: "Core", email: "core@example.test" };

describe("Git browse routes", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("A person who cannot see the application reads nothing of its repositories", () =>
      Effect.gen(function* () {
        const { call, gitHost } = yield* startCore(true, { viewTtl: Duration.zero });
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const outsider = yield* sessionFor(call, "door-dev");
        const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
        const appId = (made.body as { id: string }).id;
        const git = yield* gitHost.opened(Duration.seconds(3));
        const main = (yield* git.branches({ appId, id: "group" })).items.find(
          (branch) => branch.ref === "refs/heads/main",
        );
        yield* git.commitFiles({ appId, id: "group" }, "refs/heads/main", {
          files: { "README.md": "# Shop\n" },
          expectedHead: main?.sha ?? null,
          message: "Readme",
          author,
        });
        for (const path of ["home", "refs?kind=branch"]) {
          const refused = yield* call("GET", `/api/apps/${appId}/repos/group/browse/${path}`, {
            session: outsider,
          });
          assert.strictEqual(refused.status, 403, path);
          assert.deepStrictEqual(refused.body, { code: "forbidden", reason: "app_not_seen" });
        }
        const home = yield* call("GET", `/api/apps/${appId}/repos/group/browse/home`, {
          session: owner,
        });
        assert.strictEqual(home.status, 200);
        expect(home.body).toMatchObject({
          ref: { name: "main", kind: "branch" },
          about: { remote: null, mirror: null, branchCount: 1, tagCount: 0 },
          readme: { path: "README.md", content: "# Shop\n", truncated: false },
        });
        const refs = yield* call("GET", `/api/apps/${appId}/repos/group/browse/refs?kind=branch`, {
          session: owner,
        });
        assert.strictEqual(refs.status, 200);
        expect(refs.body).toMatchObject({
          items: [{ name: "main", kind: "branch", subject: "Readme" }],
          next: null,
          total: 1,
        });
      }),
    );

    it.effect(
      "A browse read of a repository the application does not hold is refused as not found",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true, { viewTtl: Duration.zero });
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const appId = (made.body as { id: string }).id;
          const missing = yield* call("GET", `/api/apps/${appId}/repos/elsewhere/browse/home`, {
            session: owner,
          });
          assert.strictEqual(missing.status, 404);
          assert.deepStrictEqual(missing.body, {
            code: "repo_not_found",
            reason: "repo_not_found",
          });
          const commit = yield* call(
            "GET",
            `/api/apps/${appId}/repos/group/browse/home?rev=no-such-branch`,
            { session: owner },
          );
          assert.strictEqual(commit.status, 404);
          assert.deepStrictEqual(commit.body, {
            code: "commit_not_found",
            reason: "commit_not_found",
          });
        }),
    );

    it.effect(
      "Browse reads take from the person's own bucket and never from signing in's",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const colleague = yield* sessionFor(call, "door-dev");
          const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const appId = (made.body as { id: string }).id;
          // One office behind one address: the person browsing, a colleague, and someone signing in.
          const headers = { "x-real-ip": "10.0.0.7" };
          const browse = (session: string) =>
            Effect.map(
              call("GET", `/api/apps/${appId}/repos/elsewhere/browse/home`, { session, headers }),
              (answer) => answer.status,
            );
          // Core runs on the real clock and refills while the reads travel, so the 429 is awaited
          // past the bucket's 600, not counted to; rateLimit.test.ts counts it on a test clock.
          let reads = 0;
          let status = yield* browse(owner);
          while (status !== 429 && reads < 2000) {
            reads++;
            status = yield* browse(owner);
          }
          assert.strictEqual(status, 429);
          const door = yield* call("POST", "/api/door", { body: { token: "unknown" }, headers });
          assert.strictEqual(door.status, 401);
          assert.strictEqual(yield* browse(colleague), 403);
          assert.isAtLeast(reads, 600);
        }),
      60_000,
    );

    it.effect("An empty repository reads as having no commits yet", () =>
      Effect.gen(function* () {
        const { call, gitHost, sql } = yield* startCore(true, { viewTtl: Duration.zero });
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
        const appId = (made.body as { id: string }).id;
        const git = yield* gitHost.opened(Duration.seconds(3));
        yield* git.create({ appId, id: "empty" });
        yield* sql`INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, 'empty', 'owner')`;
        const home = yield* call("GET", `/api/apps/${appId}/repos/empty/browse/home`, {
          session: owner,
        });
        assert.strictEqual(home.status, 200);
        expect(home.body).toMatchObject({
          sha: null,
          ref: { name: "main", kind: "branch" },
          about: { branchCount: 0, tagCount: 0 },
          readme: null,
        });
      }),
    );

    it.effect(
      "An answer pinned to a commit says it never changes; an answer about refs is never cached",
      () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true, { viewTtl: Duration.zero });
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const appId = (made.body as { id: string }).id;
          for (const path of ["home", "refs?kind=tag"]) {
            const moving = yield* call("GET", `/api/apps/${appId}/repos/group/browse/${path}`, {
              session: owner,
            });
            assert.strictEqual(moving.status, 200, path);
            assert.strictEqual(moving.headers.get("cache-control"), "no-store", path);
            assert.isNull(moving.headers.get("etag"), path);
          }
          const sha = "a".repeat(40);
          const params = new URLSearchParams({ sha, path: "src" });
          const first = browseResponse({ headers: {} }, "tree", params, {
            body: { entries: [] },
            pinned: { sha },
          });
          assert.strictEqual(first.status, 200);
          assert.strictEqual(
            first.headers["cache-control"],
            "private, max-age=31536000, immutable",
          );
          // Kept per session: another account on the same browser is checked by HQ again.
          assert.strictEqual(first.headers["vary"], "Authorization");
          const etag = first.headers["etag"]!;
          expect(etag).toMatch(new RegExp(`^"tree:${sha}:[0-9a-f]{8}"$`));
          // The same query in another order is the same answer; another path is another one.
          const again = browseResponse(
            { headers: { "if-none-match": etag } },
            "tree",
            new URLSearchParams({ path: "src", sha }),
            { body: { entries: [] }, pinned: { sha } },
          );
          assert.strictEqual(again.status, 304);
          const other = browseResponse(
            { headers: { "if-none-match": etag } },
            "tree",
            new URLSearchParams({ sha, path: "docs" }),
            { body: { entries: [] }, pinned: { sha } },
          );
          assert.strictEqual(other.status, 200);
        }),
    );
  });
});
