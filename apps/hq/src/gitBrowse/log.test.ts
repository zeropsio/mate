import { assert, describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sessionFor, startCore, untilHealth } from "../../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../../test/harness/tempPostgres.ts";

const author = { name: "Core", email: "core@example.test" };

describe("Git browse log route", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "A commit's history is read at that commit, never changes, and refuses another list's cursor",
      () =>
        Effect.gen(function* () {
          const { call, gitHost } = yield* startCore(true, { viewTtl: Duration.zero });
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const outsider = yield* sessionFor(call, "door-dev");
          const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
          const appId = (made.body as { id: string }).id;
          const git = yield* gitHost.opened(Duration.seconds(3));
          const before = (yield* git.branches({ appId, id: "group" })).items.find(
            (branch) => branch.ref === "refs/heads/main",
          );
          const written = yield* git.commitFiles({ appId, id: "group" }, "refs/heads/main", {
            files: { "docs/guide.md": "# Guide\n" },
            expectedHead: before?.sha ?? null,
            message: "Guide",
            author,
          });
          assert.isTrue("sha" in written);
          const sha = (written as { readonly sha: string }).sha;
          const base = `/api/apps/${appId}/repos/group/browse/log`;

          const refused = yield* call("GET", `${base}?sha=${sha}`, { session: outsider });
          assert.strictEqual(refused.status, 403);

          const log = yield* call("GET", `${base}?sha=${sha}&path=docs`, { session: owner });
          assert.strictEqual(log.status, 200);
          expect(log.body).toMatchObject({
            items: [{ sha, subject: "Guide", authorName: "Core" }],
            next: null,
            addsPath: true,
            stopped: false,
          });
          assert.notInclude(JSON.stringify(log.body), author.email);
          assert.strictEqual(
            log.headers.get("cache-control"),
            "private, max-age=31536000, immutable",
          );

          const missing = yield* call("GET", `${base}?sha=${"f".repeat(40)}`, { session: owner });
          assert.strictEqual(missing.status, 404);
          assert.deepStrictEqual(missing.body, {
            code: "commit_not_found",
            reason: "commit_not_found",
          });

          const foreign = yield* call("GET", `${base}?sha=${sha}&cursor=${"e".repeat(40)}:100`, {
            session: owner,
          });
          assert.strictEqual(foreign.status, 400);
        }),
    );
  });
});
