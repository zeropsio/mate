import { assert, describe, it } from "@effect/vitest";
import type { HqIntakeView } from "@t3tools/shared/hqIntake";
import type { HqNavigationApp } from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";

import { GITHUB_TOKEN, connectedRepo } from "../test/harness/automated.ts";
import { githubFake } from "../test/harness/githubFake.ts";
import { sessionFor, startCore, ticketFor, untilHealth } from "../test/harness/runningCore.ts";
import { nextScopeValue, scopeReset, scopeValue } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const NAV = { kind: "navigation" } as const;

/** A Core over a fake GitHub, its owner's session, and an application with a connected repository. */
const withRepo = Effect.gen(function* () {
  const github = yield* githubFake;
  const core = yield* startCore(true, { githubApi: github.url });
  yield* untilHealth(core.call, "active");
  const owner = yield* sessionFor(core.call, "door-owner");
  const app = yield* core.call("POST", "/api/apps", { session: owner, body: { name: "Tea Shop" } });
  const appId = (app.body as { readonly id: string }).id;
  yield* connectedRepo(core, appId, "web", "acme/tea-shop");
  return { ...core, github, owner, appId };
});

describe("an application's intake", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a structure writer points the application's automated Mates at a repository's labelled issues; HQ makes the webhook with the repository's token",
      () =>
        Effect.gen(function* () {
          const { call, github, owner, appId, socket } = yield* withRepo;
          const watching = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, owner)}`,
          );
          const before = scopeValue<HqNavigationApp>(
            yield* scopeReset(watching, NAV),
            `app:${appId}`,
          );
          assert.isNull(before.intake);
          const kept = yield* call("PUT", `/api/apps/${appId}/intake`, {
            session: owner,
            body: { repo: "Acme/Tea-Shop", label: "mate" },
          });
          assert.strictEqual(kept.status, 200);
          const view = kept.body as HqIntakeView;
          assert.deepInclude(view, { appId, repo: "acme/tea-shop", label: "mate" });
          assert.deepStrictEqual(view.hook, { kind: "made" });
          assert.match(
            view.webhookUrl,
            /^https:\/\/hqzone\.prg1-zerops\.zone\/api\/intake\/github\/[A-Za-z0-9_-]{20,}$/u,
          );
          const made = github.state.seen.find((request) => request.method === "POST");
          assert.strictEqual(made?.path, "/repos/acme/tea-shop/hooks");
          assert.strictEqual(made?.authorization, `Bearer ${GITHUB_TOKEN}`);
          const body = made?.body as {
            events: Array<string>;
            config: { url: string; content_type: string; secret: string };
          };
          assert.deepStrictEqual(body.events, ["issues", "issue_comment"]);
          assert.deepInclude(body.config, { url: view.webhookUrl, content_type: "json" });
          assert.isAtLeast(body.config.secret.length, 32);
          // The secret is GitHub's and HQ's: never in what HQ answers.
          assert.notInclude(new TextDecoder().decode(kept.bytes), body.config.secret);
          const listed = yield* nextScopeValue<HqNavigationApp>(
            watching,
            NAV,
            `app:${appId}`,
            (app) => app.intake != null,
          );
          assert.deepStrictEqual(listed.intake, {
            repo: "acme/tea-shop",
            label: "mate",
            waiting: 0,
          });
          yield* watching.close;
        }),
    );

    it.effect(
      "where the repository's token may not make webhooks, HQ shows the address and the secret for the person to paste",
      () =>
        Effect.gen(function* () {
          const { call, github, owner, appId } = yield* withRepo;
          github.state.hookStatus = 403;
          const kept = yield* call("PUT", `/api/apps/${appId}/intake`, {
            session: owner,
            body: { repo: "acme/tea-shop", label: "mate" },
          });
          assert.strictEqual(kept.status, 200);
          const { hook } = kept.body as HqIntakeView;
          assert.strictEqual(hook.kind, "paste");
          if (hook.kind !== "paste") return;
          assert.isAtLeast(hook.secret.length, 32);
          assert.include(hook.why, "Webhooks");
          // GitHub's form defaults to a form-encoded push event; HQ reads issues, as JSON.
          assert.include(hook.why, "Content type: application/json; events: Issues");
          const structure = yield* call("GET", "/api/structure", { session: owner });
          assert.notInclude(new TextDecoder().decode(structure.bytes), hook.secret);
        }),
    );

    it.effect("only the organization's structure writers set or stop an application's intake", () =>
      Effect.gen(function* () {
        const { call, appId } = yield* withRepo;
        const reader = yield* sessionFor(call, "door-reader");
        for (const method of ["PUT", "DELETE"]) {
          const refused = yield* call(method, `/api/apps/${appId}/intake`, {
            session: reader,
            ...(method === "PUT" ? { body: { repo: "acme/tea-shop", label: "mate" } } : {}),
          });
          assert.deepStrictEqual(
            [refused.status, refused.body],
            [403, { code: "forbidden", reason: "not_structure_writer" }],
          );
        }
      }),
    );

    it.effect(
      "an intake takes only one of the application's repositories with a GitHub remote",
      () =>
        Effect.gen(function* () {
          const { call, owner, appId } = yield* withRepo;
          const refused = yield* call("PUT", `/api/apps/${appId}/intake`, {
            session: owner,
            body: { repo: "acme/elsewhere", label: "mate" },
          });
          assert.deepStrictEqual(
            [refused.status, refused.body],
            [409, { code: "conflict", reason: "repo_not_connected" }],
          );
          const nowhere = yield* call(
            "PUT",
            "/api/apps/00000000-0000-4000-8000-000000000000/intake",
            {
              session: owner,
              body: { repo: "acme/tea-shop", label: "mate" },
            },
          );
          assert.strictEqual(nowhere.status, 404);
        }),
    );

    it.effect("stopping an application's intake removes the webhook HQ made", () =>
      Effect.gen(function* () {
        const { call, github, owner, appId } = yield* withRepo;
        yield* call("PUT", `/api/apps/${appId}/intake`, {
          session: owner,
          body: { repo: "acme/tea-shop", label: "mate" },
        });
        const stopped = yield* call("DELETE", `/api/apps/${appId}/intake`, { session: owner });
        assert.strictEqual(stopped.status, 204);
        assert.isTrue(
          github.state.seen.some(
            (request) =>
              request.method === "DELETE" && request.path === "/repos/acme/tea-shop/hooks/7",
          ),
        );
        const structure = yield* call("GET", "/api/structure", { session: owner });
        const app = (structure.body as { apps: Array<{ id: string; intake: unknown }> }).apps.find(
          (candidate) => candidate.id === appId,
        );
        assert.isNull(app?.intake);
      }),
    );
  });
});
