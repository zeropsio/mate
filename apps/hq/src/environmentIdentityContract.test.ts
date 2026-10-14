import { assert, describe, it } from "@effect/vitest";
import { CanonicalHqNavigationEnvironment } from "@t3tools/shared/hqStream";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { startCore, sessionFor, ticketFor, untilHealth } from "../test/harness/runningCore.ts";
import { scopeReset, scopeValue } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const ID = "P_MATE";
const SHA = "a".repeat(40);
const decodeEnvironment = Schema.decodeUnknownSync(CanonicalHqNavigationEnvironment);
interface RawApp {
  readonly id: string;
  readonly environments: ReadonlyArray<Record<string, unknown>>;
}

const currentEnvironment = (raw: Record<string, unknown> | undefined) => {
  assert.isDefined(raw);
  // Check actual transport bytes before the optional legacy decoder can normalize them.
  assert.strictEqual(Object.hasOwn(raw!, "projectId"), false);
  assert.deepStrictEqual(
    {
      id: raw!.id,
      target: raw!.target,
      name: raw!.name,
      tier: raw!.tier,
      sources: raw!.sources,
      order: raw!.order,
      keyHeld: raw!.keyHeld,
      keyInvalid: raw!.keyInvalid,
      can: raw!.can,
      deleteProjectOnRemoval: raw!.deleteProjectOnRemoval,
      release: raw!.release,
    },
    {
      id: ID,
      target: { kind: "zerops", projectId: "P_MATE" },
      name: "live",
      tier: "production",
      sources: ["release"],
      order: 1,
      keyHeld: false,
      keyInvalid: false,
      can: {
        keep_deploy_token: { allow: true },
        redeploy: { allow: true },
        remove_production: { allow: true },
      },
      deleteProjectOnRemoval: false,
      release: null,
    },
  );
  const decoded = decodeEnvironment(raw);
  assert.deepStrictEqual(
    [decoded.id, decoded.target],
    [ID, { kind: "zerops", projectId: "P_MATE" }],
  );
  assert.deepStrictEqual(
    decoded.jobs.map(({ service, sha, state, reason, at, endedAt }) => ({
      service,
      sha,
      state,
      reason,
      at,
      endedAt,
    })),
    [
      {
        service: "web",
        sha: SHA,
        state: "failed",
        reason: "build refused",
        at: "2026-10-01T10:00:00.000Z",
        endedAt: "2026-10-01T10:01:00.000Z",
      },
    ],
  );
};

describe("current environment identity wire contract", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect.each([
      {
        transport: "http",
        title:
          "Current Structure HTTP omits redundant environment projectId and preserves target and durable work.",
      },
      {
        transport: "scopes",
        title:
          "slice 2 is a removal with no behaviour change; it does not wait for slice 3a, and it never removes a field before every live reader tolerates its absence.",
      },
    ] as const)("$title", ({ transport }) =>
      Effect.gen(function* () {
        const core = yield* startCore(true, { reconcileEvery: Duration.hours(1) });
        yield* untilHealth(core.call, "active");
        const session = yield* sessionFor(core.call, "door-owner");
        const created = yield* core.call("POST", "/api/apps", {
          session,
          body: { name: "Shop" },
        });
        const appId = (created.body as { id: string }).id;
        const attached = yield* core.call("POST", `/api/apps/${appId}/projects`, {
          session,
          body: { projectId: "P_MATE", kind: "production", environment: { name: "live" } },
        });
        assert.strictEqual(attached.status, 201);
        const [rollout] = yield* core.sql<{
          id: string;
        }>`INSERT INTO hq_rollout (app_id, cause, environment_id, project_id)
          VALUES (${appId}::uuid, 'env_added', ${ID}, 'P_MATE') RETURNING id::text`;
        yield* core.sql`INSERT INTO hq_deploy_job
          (rollout_id, kind, environment_id, project_id, service, repo, sha, state, reason, created_at, ended_at)
          VALUES (${rollout!.id}::bigint, 'deploy', ${ID}, 'P_MATE', 'web', 'app', ${SHA}, 'failed',
            'build refused', '2026-10-01T10:00:00Z', '2026-10-01T10:01:00Z')`;
        if (transport === "http") {
          const response = yield* core.call("GET", "/api/structure", { session });
          assert.strictEqual(response.status, 200);
          currentEnvironment(
            (response.body as { apps: RawApp[] }).apps.find((app) => app.id === appId)
              ?.environments[0],
          );
        } else {
          const socket = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, session)}`,
          );
          const values = yield* scopeReset(socket, { kind: "navigation" });
          currentEnvironment(scopeValue<RawApp>(values, `app:${appId}`).environments[0]);
          // Demanding detail must not alter the navigation environment's identity.
          yield* scopeReset(socket, { kind: "app-detail", appId });
          currentEnvironment(
            scopeValue<RawApp>(yield* scopeReset(socket, { kind: "navigation" }), `app:${appId}`)
              .environments[0],
          );
        }
      }),
    );
  });
});
