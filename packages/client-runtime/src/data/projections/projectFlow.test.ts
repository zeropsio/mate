import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { linkKeys } from "../model.ts";
import { readsOfState } from "../store.ts";
import { projectFlow } from "./projectFlow.ts";

const key = {
  orgId: "org",
  appId: "shop",
  hqAddress: "https://hq.test",
  viewer: { id: "org", name: "Org", membershipId: "owner", roleCode: "OWNER" },
};
function fixture() {
  const registry = AtomRegistry.make();
  const store = mountRoster(
    registry,
    "org",
    [{ id: "prod", name: "Shop - Production", status: "ACTIVE" }],
    {
      services: [
        {
          id: "web",
          projectId: "prod",
          name: "web",
          status: "ACTIVE",
          isSystem: false,
          serviceStackTypeInfo: {
            serviceStackTypeName: "Node.js",
            serviceStackTypeVersionName: "nodejs@24",
            serviceStackTypeCategory: "USER",
          },
          activeAppVersion: { id: "v1", name: "v1.2.3", source: "GIT" },
        },
      ],
    },
  );
  seedHqNavigation(store, "org", {
    structure: {
      ungrouped: [],
      apps: [
        {
          id: "shop",
          name: "Shop",
          projects: [{ projectId: "prod", name: "Production", kind: "production", mate: null }],
          environments: [
            {
              name: "production",
              tier: "production",
              projectId: "prod",
              sources: ["release"],
              order: 1,
              keyHeld: true,
              keyInvalid: false,
              jobs: [],
            },
          ],
        },
        { id: "other", name: "Other", projects: [] },
      ],
    },
  });
  return { registry, store, read: () => projectFlow.derive(readsOfState(store.state()), key) };
}

describe("Projects compact flow", () => {
  it("shows production's actual version while recipes and release history are unread", () => {
    const f = fixture();
    expect(f.read()?.environments[0]?.version.label).toBe("v1.2.3");
    expect(f.read()?.environments[0]?.name).toBe("Production");
    expect(f.read()?.releasesKnown).toBe(false);
    expect(f.read()?.recipeRead).toBe(false);
    expect(f.read()?.changesKnown).toBe(true);
    f.registry.dispose();
  });
  it("keeps an unaffected application's projected value on an unrelated attention update", () => {
    const f = fixture();
    const atom = f.store.data.project(projectFlow, key);
    const release = f.registry.mount(atom);
    const before = f.registry.get(atom);
    const scope = hqMateScope("org", "other");
    f.store.dispatch({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    });
    f.store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
    f.store.dispatch({
      kind: "baseline-commit",
      scope,
      generation: 0,
      via: "hq-stream",
      members: ["other"],
      rows: [
        {
          family: "hqMate",
          id: "other",
          revision: { kind: "hq", incarnation: "seed", revision: 100 },
          value: {
            presence: { online: true, since: "2026-10-08T00:00:00Z", overview: "none" },
            overview: null,
            attention: null,
            attentionState: "none",
          },
        },
      ],
    });
    expect(f.registry.get(atom)).toBe(before);
    release();
    f.registry.dispose();
  });
  it("retains the known flow during HQ recovery and withholds the release action", () => {
    const f = fixture();
    f.store.dispatch({
      kind: "stream",
      key: linkKeys.hq("org"),
      now: 0,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "transient", message: "503" },
      },
    });
    expect(f.read()?.environments[0]?.version.label).toBe("v1.2.3");
    expect(f.read()?.release.gate).toEqual({
      allowed: false,
      reason: "HQ is not answering right now.",
    });
    f.registry.dispose();
  });
  it("purges a denied production's protected version without erasing another application", () => {
    const f = fixture();
    f.store.dispatch({ kind: "access", family: "project", id: "prod", access: "denied" });
    expect(f.read()?.environments[0]?.version.label).toBeUndefined();
    expect(f.read()?.release.gate.allowed).toBe(false);
    expect(
      projectFlow.derive(readsOfState(f.store.state()), { ...key, appId: "other" }),
    ).toBeDefined();
    f.registry.dispose();
  });
});
