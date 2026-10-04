import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { mateInApp, addProject } from "../test/harness/mates.ts";
import { startCore, sessionFor, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const setup = Effect.gen(function* () {
  const core = yield* startCore(true);
  yield* untilHealth(core.call, "active");
  const owner = yield* sessionFor(core.call, "door-owner");
  const mate = yield* mateInApp(core.call, core.fake, owner, "P_MATE", "Shop");
  for (const [projectId, tier] of [
    ["P_STAGE", "stage"],
    ["P_PROD", "production"],
  ] as const) {
    addProject(core.fake, projectId);
    assert.strictEqual(
      (yield* core.call("POST", `/api/apps/${mate.appId}/projects`, {
        session: owner,
        body: { projectId, kind: tier, environment: { name: tier } },
      })).status,
      201,
    );
    core.fake.tokens.set(`key-${tier}`, {
      id: `key-${tier}`,
      name: `mate-hq-deploy:${tier}:${projectId}`,
      orgId: "ORG",
      roleCode: "NO_ACCESS",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [{ projectId, roleCode: "BASIC_USER" }],
      createdMs: 0,
      createdByUser: "owner",
    });
    assert.strictEqual(
      (yield* core.call("PUT", `/api/apps/${mate.appId}/environments/${tier}/deploy-token`, {
        session: owner,
        body: { token: `key-${tier}` },
      })).status,
      200,
    );
    core.fake.services.push({
      id: `S-${tier}`,
      projectId,
      name: "web",
      status: "ACTIVE",
      isSystem: false,
      subdomainAccess: true,
      http: true,
      named: { id: `V-${tier}`, name: "new-build" },
      activeVersionId: `OLD-${tier}`,
    });
    core.fake.appVersions.set(`OLD-${tier}`, {
      id: `OLD-${tier}`,
      serviceId: `S-${tier}`,
      name: "serving-version",
      status: "ACTIVE",
      archive: undefined,
      zeropsYaml: undefined,
      setup: undefined,
    });
  }
  return { ...core, ...mate, owner };
});

describe("a Mate's application observation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "reads stage and production with their deploy keys, projecting only runtime facts",
      () =>
        Effect.gen(function* () {
          const { call, fake, auth, appId } = yield* setup;
          const list = yield* call("GET", "/api/mate/environments", { headers: auth });
          assert.strictEqual(list.status, 200);
          assert.deepStrictEqual(list.body, {
            appId,
            environments: [
              { projectId: "P_STAGE", name: "stage", tier: "stage" },
              { projectId: "P_PROD", name: "production", tier: "production" },
            ],
          });
          for (const tier of ["stage", "production"]) {
            fake.calls.length = 0;
            const answer = yield* call(
              "GET",
              `/api/mate/environments/P_${tier === "stage" ? "STAGE" : "PROD"}`,
              { headers: auth },
            );
            assert.strictEqual(answer.status, 200);
            assert.deepStrictEqual((answer.body as { services: unknown }).services, [
              {
                id: `S-${tier}`,
                name: "web",
                status: "ACTIVE",
                activeVersion: { id: `OLD-${tier}`, name: "serving-version" },
              },
            ]);
            assert.include(fake.calls, `services:key-${tier}`);
            assert.notInclude(yield* encodeJson(answer.body), "key-");
            assert.notInclude(yield* encodeJson(answer.body), "new-build");
          }
        }),
    );
    it.effect("a missing or widened deploy key is a visible failure, never an empty status", () =>
      Effect.gen(function* () {
        const { call, fake, auth } = yield* setup;
        fake.tokens.delete("key-stage");
        assert.strictEqual(
          (yield* call("GET", "/api/mate/environments/P_STAGE", { headers: auth })).status,
          409,
        );
        const key = fake.tokens.get("key-production")!;
        fake.tokens.set("key-production", { ...key, roleCode: "ADMIN" });
        assert.strictEqual(
          (yield* call("GET", "/api/mate/environments/P_PROD", { headers: auth })).status,
          409,
        );
      }),
    );
  });
});
