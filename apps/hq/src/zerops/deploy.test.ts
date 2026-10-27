/**
 * The fake deploy moves as the rig measured it on 2026-10-02 (`mate-rig-t8b-*`, an environment's
 * NO_ACCESS + Basic user token): the service names the new version as its build starts and runs it
 * when its job ends; a failed build leaves the old one running; an org Read only token is refused a
 * write. HQ's deploy engine is tested over this fake, so it must hold what the platform does.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import {
  type FakeService,
  emptyWorld,
  fakeZeropsApi,
  fakeZeropsDeploy,
} from "../../test/harness/zeropsFake.ts";

const token = (
  roleCode: string,
  projects: ReadonlyArray<{ projectId: string; roleCode: string }>,
) => ({
  id: roleCode,
  name: roleCode,
  orgId: "ORG",
  roleCode,
  canCreateProjects: false,
  canViewFinances: false,
  canEditFinances: false,
  projects,
  createdMs: 0,
  createdByUser: null,
});

const rig = () => {
  const world = emptyWorld();
  world.projects.push({
    id: "P",
    orgId: "ORG",
    name: "Shop - stage",
    status: "ACTIVE",
    tags: [],
    userRoles: [],
    publicZone: "p.prg1-zerops.zone",
  });
  const app: FakeService = {
    id: "S-app",
    projectId: "P",
    name: "app",
    status: "ACTIVE",
    isSystem: false,
    subdomainAccess: false,
    http: true,
    // A service imported without code runs an empty version: settled, named nothing.
    named: { id: "V-0", name: "" },
    activeVersionId: "V-0",
  };
  world.services.push(app);
  world.tokens.set("key", token("NO_ACCESS", [{ projectId: "P", roleCode: "BASIC_USER" }]));
  world.tokens.set("org-read", token("READ_ONLY", []));
  return {
    world,
    api: fakeZeropsApi(world),
    deploy: fakeZeropsDeploy(world),
    key: Redacted.make("key"),
    orgRead: Redacted.make("org-read"),
  };
};

describe("fakeZeropsDeploy", () => {
  it.effect("names the version as its build starts, and runs it when its job ends", () =>
    Effect.gen(function* () {
      const { api, deploy, key } = rig();
      const version = yield* deploy.createAppVersion("S-app", "main 7e2d4c1")(key);
      yield* deploy.upload(version.id, new Uint8Array([1]))(key);
      const job = yield* deploy.buildAndDeploy(version.id, "zerops: []\n", "app")(key);
      const building = yield* api.service("S-app")(key);
      assert.deepStrictEqual(
        [building.named, building.activeVersionId],
        [{ id: version.id, name: "main 7e2d4c1" }, "V-0"],
      );
      assert.deepStrictEqual(yield* deploy.process(job.processId)(key), {
        status: "FINISHED",
        failure: null,
      });
      assert.strictEqual((yield* api.service("S-app")(key)).activeVersionId, version.id);
    }),
  );

  it.effect("leaves the old version running when a build fails, still naming the failed one", () =>
    Effect.gen(function* () {
      const { world, api, deploy, key } = rig();
      world.outcome = () => "BUILD_FAILED";
      const version = yield* deploy.createAppVersion("S-app", "main 7e2d4c1")(key);
      yield* deploy.upload(version.id, new Uint8Array([1]))(key);
      const job = yield* deploy.buildAndDeploy(version.id, "zerops: []\n", "app")(key);
      const ended = yield* deploy.process(job.processId)(key);
      assert.strictEqual(ended.status, "FAILED");
      assert.isNotNull(ended.failure);
      const service = yield* api.service("S-app")(key);
      assert.deepStrictEqual([service.named?.id, service.activeVersionId], [version.id, "V-0"]);
    }),
  );

  it.effect("keeps a job running while its build does", () =>
    Effect.gen(function* () {
      const { world, deploy, key } = rig();
      world.outcome = () => "BUILDING";
      const version = yield* deploy.createAppVersion("S-app", "main 7e2d4c1")(key);
      yield* deploy.upload(version.id, new Uint8Array([1]))(key);
      const job = yield* deploy.buildAndDeploy(version.id, "zerops: []\n", "app")(key);
      assert.strictEqual((yield* deploy.process(job.processId)(key)).status, "RUNNING");
    }),
  );

  it.effect(
    "turns the subdomain on for the environment's token, never for an org Read only one",
    () =>
      Effect.gen(function* () {
        const { api, deploy, key, orgRead } = rig();
        const refused = yield* Effect.all([
          Effect.flip(deploy.enableSubdomainAccess("S-app")(orgRead)),
          Effect.flip(deploy.createAppVersion("S-app", "main 7e2d4c1")(orgRead)),
        ]);
        assert.deepStrictEqual(
          refused.map((error) => (error._tag === "ZeropsRefused" ? error.code : error._tag)),
          ["insufficientPermissions", "insufficientPermissions"],
        );
        yield* deploy.enableSubdomainAccess("S-app")(key);
        assert.isTrue((yield* api.service("S-app")(key)).subdomainAccess);
      }),
  );

  // Measured 2026-10-02: an environment's Basic user token imports services into its project.
  it.effect("imports services for the environment's token, never for an org Read only one", () =>
    Effect.gen(function* () {
      const { world, api, deploy, key, orgRead } = rig();
      const yaml = "services:\n  - hostname: cache\n    type: valkey@7.2\n";
      const refused = yield* Effect.flip(deploy.importServices("P", yaml)(orgRead));
      assert.strictEqual(
        refused._tag === "ZeropsRefused" ? refused.code : refused._tag,
        "insufficientPermissions",
      );
      const imported = yield* deploy.importServices("P", yaml)(key);
      // Each service with the process bringing it up, which its importer follows.
      assert.deepStrictEqual(
        imported.services.map(({ name, processes }) => [name, processes.length]),
        [["cache", 1]],
      );
      assert.deepStrictEqual(
        (yield* api.services("P")(key)).map((service) => service.name),
        ["app", "cache"],
      );
      assert.deepStrictEqual(world.imports, [{ projectId: "P", yaml }]);
    }),
  );
});
