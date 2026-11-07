// @effect-diagnostics nodeBuiltinImport:off -- disposable local HQ and Zerops services.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import { startGithubFake } from "../../fakes/github.ts";
import { ZeropsFake } from "../../fakes/zerops.ts";
import { definePerson, projectRoles, type PersonOptions } from "../../fakes/zeropsWorld.ts";
import { seedCoreWorld } from "../../harness/coreSeed.ts";
import { startScenarioCore } from "../../harness/hqCore.ts";
import { serve } from "../../harness/http.ts";
import { personDoor } from "../../harness/mateAccess.ts";
import { installBuildProtocol } from "../../fakes/e-env/builds.ts";

/** The same HQ and Zerops sources as the environment scenarios, without a browser. */
export const environmentSources = Effect.gen(function* () {
  const world = seedCoreWorld(yield* Clock.currentTimeMillis, true, "ORG");
  const zerops = new ZeropsFake(world);
  installBuildProtocol(zerops);
  const api = yield* Effect.acquireRelease(
    Effect.promise(() => serve(zerops.handle, zerops.socket)),
    (server) => Effect.promise(server.close),
  );
  zerops.origin = api.origin;
  const github = yield* Effect.acquireRelease(Effect.promise(startGithubFake), (server) =>
    Effect.promise(server.close),
  );
  const core = yield* startScenarioCore({
    baseUrl: `${api.origin}/api/rest/public`,
    world,
    github,
  });
  const personal = core.fake.tokens.get("door-owner")!;
  core.fake.tokens.set("personal", {
    ...personal,
    id: "personal",
    name: "Scenario personal access token",
  });
  zerops.people.set("personal", "owner");
  const person = (name: string, options: PersonOptions = {}) =>
    definePerson(zerops.world, name, options);
  person("owner", { role: "OWNER" });
  const owner = yield* personDoor(core, "owner");
  const appIds = new Map<string, string>();
  const app = Effect.fn("environmentSources.app")(function* (name: string) {
    const held = appIds.get(name);
    if (held !== undefined) return held;
    const response = yield* core.call("POST", "/api/apps", { session: owner, body: { name } });
    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    appIds.set(name, id);
    return id;
  });
  const project = Effect.fn("environmentSources.project")(function* (
    name: string,
    options: {
      mate?: boolean;
      app?: string;
      kind?: "mate" | "stage" | "production";
      environmentName?: string;
    } = {},
  ) {
    const kind = options.kind ?? (options.mate ? "mate" : undefined);
    zerops.put("project", {
      id: name,
      name,
      clientId: "ORG",
      status: "ACTIVE",
      tags: [],
      userRoles: projectRoles(zerops.world, name),
    });
    if (kind === "mate") {
      zerops.put("service-stack", {
        id: `service-${name}`,
        projectId: name,
        clientId: "ORG",
        name: "zcp",
        status: "ACTIVE",
        subdomainAccess: true,
        serviceStackTypeInfo: {
          serviceStackTypeName: "zcp",
          serviceStackTypeVersionName: "zcp@1",
          serviceStackTypeCategory: "USER",
        },
        ports: [{ port: 8080, scheme: "http" }],
      });
      zerops.put("user-data", {
        id: `mate-flag-${name}`,
        clientId: "ORG",
        serviceStackId: `service-${name}`,
        key: "ZCP_MATE_ENABLED",
        content: "1",
      });
      const key = `mate-key-${name}`;
      world.tokens.set(key, {
        id: key,
        name: `Mate ${name}`,
        orgId: "ORG",
        roleCode: "NO_ACCESS",
        canCreateProjects: false,
        canViewFinances: false,
        canEditFinances: false,
        projects: [{ projectId: name, roleCode: "ADMIN" }],
        createdMs: zerops.clock.currentTimeMillis(),
        createdByUser: "owner",
      });
    }
    if (options.app !== undefined && kind !== undefined) {
      const appId = yield* app(options.app);
      const response = yield* core.call("POST", `/api/apps/${appId}/projects`, {
        session: owner,
        body:
          kind === "mate"
            ? { projectId: name, kind, mate: { face: "face-1" } }
            : {
                projectId: name,
                kind,
                environment: { name: options.environmentName ?? name.toLowerCase() },
              },
      });
      expect(response.status).toBe(201);
    }
    return kind === "mate" ? `mate-key-${name}` : undefined;
  });
  return { owner, appIds, given: { person, project }, drivers: { core, zerops } };
});
