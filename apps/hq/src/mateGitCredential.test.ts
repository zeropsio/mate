import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import {
  GITHUB_TOKEN,
  automatedPool,
  connectedRepo,
  mateLinked,
  throughOrgApp,
} from "../test/harness/automated.ts";
import { addProject } from "../test/harness/mates.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

/**
 * The application `Tea Shop`'s repository `web` mounted on GitHub's `acme/tea-shop` through the
 * organization's app, its automated Mate `P_ROBOT` enrolled in it.
 */
const mountedPool = Effect.gen(function* () {
  const core = yield* automatedPool();
  yield* throughOrgApp(core, "tea-shop-mate");
  /** What the Mate holding `auth` is answered for `path` on `host`, as zcp's helper asks. */
  const credential = (path: string, auth = core.robot.auth, host = "github.com") =>
    core.call(
      "GET",
      `/api/mate/git-credential?host=${encodeURIComponent(host)}&path=${encodeURIComponent(path)}`,
      { headers: auth },
    );
  /** The permissions and repositories GitHub minted the token `password` with. */
  const mintedAs = (password: unknown) =>
    core.github.state.minted.find((minted) => minted.token === password);
  return { ...core, credential, mintedAs };
});

type Answer = { readonly username: string; readonly password: string; readonly expiresAt: string };

describe("a Mate's agent's git credential", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a Mate's agent gets a one-hour token for its mounted repository that cannot write commit statuses",
      () =>
        Effect.gen(function* () {
          const core = yield* mountedPool;
          const before = yield* Clock.currentTimeMillis;
          const answered = yield* core.credential("acme/tea-shop.git");
          assert.strictEqual(answered.status, 200);
          assert.strictEqual(answered.headers.get("cache-control"), "no-store");
          const body = answered.body as Answer;
          assert.strictEqual(body.username, "x-access-token");
          const lifetime = Date.parse(body.expiresAt) - before;
          assert.isAtLeast(lifetime, 59 * 60_000);
          assert.isAtMost(lifetime, 61 * 60_000);
          // The installation granted Commit statuses: write; the agent's token has none of it.
          assert.deepStrictEqual(core.mintedAs(body.password), {
            token: body.password,
            installation: 7001,
            repositoryIds: [501],
            permissions: {
              contents: "write",
              pull_requests: "write",
              workflows: "write",
              checks: "read",
              actions: "read",
              metadata: "read",
            },
          });
        }),
    );

    it.effect("each ask mints its own token, which HQ keeps nowhere", () =>
      Effect.gen(function* () {
        const core = yield* mountedPool;
        const first = (yield* core.credential("acme/tea-shop.git")).body as Answer;
        // zcp's helper may name the repository as git spells it: any case, `.git` or none.
        const second = (yield* core.credential("Acme/Tea-Shop")).body as Answer;
        assert.notStrictEqual(first.password, second.password);
        assert.isDefined(core.mintedAs(second.password));
        const kept = yield* core.sql<{ readonly sealed: Uint8Array | null }>`
          SELECT sealed FROM hq_repo_remote WHERE repo = 'web'`;
        assert.deepStrictEqual(kept, [{ sealed: null }]);
      }),
    );

    it.effect(
      "a Mate's agent gets only a read token for a repository its application follows without pushing to it",
      () =>
        Effect.gen(function* () {
          const core = yield* mountedPool;
          core.github.state.installations
            .get(7001)!
            .repositories.push({ id: 502, full_name: "acme/tea-docs" });
          yield* connectedRepo(core, core.appId, "docs", "acme/tea-docs");
          const answered = yield* core.credential("acme/tea-docs.git");
          assert.strictEqual(answered.status, 200);
          const body = answered.body as Answer;
          assert.strictEqual(body.username, "x-access-token");
          assert.notStrictEqual(body.password, GITHUB_TOKEN);
          assert.deepStrictEqual(core.mintedAs(body.password)?.permissions, {
            contents: "read",
            metadata: "read",
          });
          assert.deepStrictEqual(core.mintedAs(body.password)?.repositoryIds, [502]);
        }),
    );

    it.effect(
      "a Mate's agent gets no token for a repository its application does not mount, and never a person's",
      () =>
        Effect.gen(function* () {
          const core = yield* mountedPool;
          // Followed with a person's token, on a repository the organization's app does not reach.
          yield* connectedRepo(core, core.appId, "docs", "acme/tea-docs");
          // Mounted, but by another application.
          const other = yield* core.call("POST", "/api/apps", {
            session: core.owner,
            body: { name: "Coffee Shop" },
          });
          yield* connectedRepo(
            core,
            (other.body as { readonly id: string }).id,
            "api",
            "acme/coffee-shop",
          );
          const rows = [
            ["acme/tea-docs", "github.com"],
            ["acme/coffee-shop", "github.com"],
            ["acme/nowhere", "github.com"],
            ["acme/tea-shop", "gitlab.com"],
            ["acme/../tea-shop", "github.com"],
          ] as const;
          for (const [path, host] of rows) {
            const answered = yield* core.credential(path, core.robot.auth, host);
            assert.deepStrictEqual(
              [answered.status, (answered.body as { readonly reason?: string }).reason],
              [404, "not_mounted"],
              `${host}/${path}`,
            );
            assert.notInclude(JSON.stringify(answered.body), GITHUB_TOKEN);
          }
        }),
    );

    it.effect("a Mate in no application gets no token", () =>
      Effect.gen(function* () {
        const core = yield* mountedPool;
        addProject(core.fake, "P_LONE");
        const lone = yield* mateLinked(core, core.owner, "P_LONE");
        const answered = yield* core.credential("acme/tea-shop", lone.auth);
        assert.deepStrictEqual(
          [answered.status, (answered.body as { readonly reason?: string }).reason],
          [403, "no_access"],
        );
      }),
    );

    it.effect("a Mate whose project access is gone gets no token", () =>
      Effect.gen(function* () {
        const core = yield* mountedPool;
        core.fake.projects.splice(
          core.fake.projects.findIndex((project) => project.id === "P_ROBOT"),
          1,
        );
        const answered = yield* core.credential("acme/tea-shop");
        assert.deepStrictEqual(
          [answered.status, (answered.body as { readonly reason?: string }).reason],
          [403, "no_access"],
        );
        assert.notProperty(answered.body, "password");
        // Nothing was minted for an agent: HQ's own sweeps mint only theirs.
        assert.isFalse(
          core.github.state.minted.some(
            ({ permissions }) =>
              permissions?.["workflows"] === "write" && permissions["pull_requests"] === "write",
          ),
        );
      }),
    );

    it.effect("a repository the organization's app no longer reaches gets no token", () =>
      Effect.gen(function* () {
        const core = yield* mountedPool;
        core.github.state.installations.delete(7001);
        const answered = yield* core.credential("acme/tea-shop");
        assert.deepStrictEqual(
          [answered.status, (answered.body as { readonly reason?: string }).reason],
          [409, "app_not_installed"],
        );
      }),
    );

    it.effect("a Mate's agent asking while GitHub does not answer is told to try again", () =>
      Effect.gen(function* () {
        const core = yield* mountedPool;
        core.github.state.mintStatus = 502;
        const answered = yield* core.credential("acme/tea-shop");
        assert.strictEqual(answered.status, 503);
        assert.isNotNull(answered.headers.get("retry-after"));
      }),
    );
  });
});
