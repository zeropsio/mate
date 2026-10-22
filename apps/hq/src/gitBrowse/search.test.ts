import { assert, describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { sessionFor, startCore, untilHealth } from "../../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../../test/harness/tempPostgres.ts";
import { failure } from "../api.ts";
import { BrowseBusy, BrowseHeavy, browseHeavyLayer } from "./heavy.ts";

const author = { name: "Core", email: "core@example.test" };

describe("Git browser search on HQ", () => {
  it.effect("A search while HQ already runs four says HQ is busy and offers Read again", () =>
    Effect.gen(function* () {
      const heavy = yield* BrowseHeavy;
      const release = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      let running = 0;
      const hold = (userId: string) =>
        heavy.run(
          userId,
          Effect.gen(function* () {
            if (++running === 4) yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
          }),
        );
      // Two people's searches fill HQ's four.
      const fibers = yield* Effect.forEach(["ann", "ann", "bob", "bob"], (userId) =>
        Effect.forkChild(hold(userId)),
      );
      yield* Deferred.await(started);
      const busy = yield* Effect.flip(heavy.run("cyd", Effect.succeed("read")));
      assert.deepStrictEqual(busy, new BrowseBusy({ limit: "hq" }));
      // HQ answers it busy, which the person's client reads as try again (`503`).
      const answer = yield* failure(busy);
      assert.strictEqual(answer.status, 503);
      yield* Deferred.succeed(release, undefined);
      yield* Effect.forEach(fibers, Fiber.join);
      // Freed, the next search runs; one person still runs at most two at once.
      assert.strictEqual(yield* heavy.run("cyd", Effect.succeed("read")), "read");
      const gate = yield* Deferred.make<void>();
      const mine = yield* Effect.forEach(["dan", "dan"], (userId) =>
        Effect.forkChild(heavy.run(userId, Deferred.await(gate))),
      );
      yield* Effect.yieldNow;
      assert.deepStrictEqual(
        yield* Effect.flip(heavy.run("dan", Effect.void)),
        new BrowseBusy({ limit: "person" }),
      );
      assert.strictEqual(yield* heavy.run("eve", Effect.succeed(1)), 1);
      yield* Deferred.succeed(gate, undefined);
      yield* Effect.forEach(mine, Fiber.join);
    }).pipe(Effect.provide(browseHeavyLayer)),
  );

  /** A running HQ whose application's group repository holds a commit of two files. */
  const searchable = Effect.gen(function* () {
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
    const written = yield* git.commitFiles({ appId, id: "group" }, "refs/heads/main", {
      files: { "src/tea.ts": "export const tea = 1;\n", "README.md": "# Shop\n" },
      expectedHead: main?.sha ?? null,
      message: "Tea",
      author,
    });
    if (!("sha" in written)) throw new Error(written.kind);
    return {
      call,
      owner,
      outsider,
      sha: written.sha,
      base: `/api/apps/${appId}/repos/group/browse`,
    };
  });

  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "A person who sees the application searches its files by name and content at a commit",
      () =>
        Effect.gen(function* () {
          const { call, owner, outsider, sha, base } = yield* searchable;
          for (const path of [`paths?sha=${sha}`, `grep?sha=${sha}&q=tea`]) {
            const refused = yield* call("GET", `${base}/${path}`, { session: outsider });
            assert.strictEqual(refused.status, 403, path);
          }
          const paths = yield* call("GET", `${base}/paths?sha=${sha}`, { session: owner });
          assert.strictEqual(paths.status, 200);
          expect((paths.body as { paths: string[] }).paths).toEqual(
            expect.arrayContaining(["README.md", "src/tea.ts"]),
          );
          expect(paths.body).toMatchObject({ truncated: false });
          assert.strictEqual(
            paths.headers.get("cache-control"),
            "private, max-age=31536000, immutable",
          );
          const grep = yield* call("GET", `${base}/grep?sha=${sha}&q=TEA`, { session: owner });
          assert.strictEqual(grep.status, 200);
          assert.deepStrictEqual(grep.body, {
            matches: [
              {
                path: "src/tea.ts",
                line: 1,
                text: "export const tea = 1;",
                ranges: [{ start: 13, end: 16 }],
              },
            ],
            truncated: false,
            deadlineHit: false,
          });
          const regex = yield* call("GET", `${base}/grep?sha=${sha}&q=tea(&mode=regex`, {
            session: owner,
          });
          assert.strictEqual(regex.status, 400);
          assert.deepStrictEqual(regex.body, { code: "invalid", reason: "invalid_pattern" });
          const short = yield* call("GET", `${base}/grep?sha=${sha}&q=t`, { session: owner });
          assert.strictEqual(short.status, 400);
          const missing = yield* call("GET", `${base}/paths?sha=${"f".repeat(40)}`, {
            session: owner,
          });
          assert.strictEqual(missing.status, 404);
          assert.deepStrictEqual(missing.body, {
            code: "commit_not_found",
            reason: "commit_not_found",
          });
        }),
    );

    it.effect(
      "A search in a folder outside the repository is refused as asked wrong in either mode, never run",
      () =>
        Effect.gen(function* () {
          const { call, owner, sha, base } = yield* searchable;
          const short = yield* call("GET", `${base}/grep?sha=${sha}&q=t`, { session: owner });
          for (const folder of ["/src", "../src", "src/../.."])
            for (const mode of ["fixed", "regex"]) {
              const outside = yield* call(
                "GET",
                `${base}/grep?sha=${sha}&q=tea&mode=${mode}&path=${encodeURIComponent(folder)}`,
                { session: owner },
              );
              assert.strictEqual(outside.status, 400, `${mode} ${folder}`);
              assert.deepStrictEqual(outside.body, short.body, `${mode} ${folder}`);
            }
          const inside = yield* call("GET", `${base}/grep?sha=${sha}&q=tea&path=src`, {
            session: owner,
          });
          expect((inside.body as { matches: unknown[] }).matches).toHaveLength(1);
        }),
    );
  });
});
