import { AtomRegistry } from "effect/unstable/reactivity";
import { expect, it } from "vite-plus/test";
import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  makeZeropsApiOrigin,
  projectKeyOf,
} from "../../zerops/data/types.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { projectsScope } from "../families/project.ts";
import { readsOfState } from "../store.ts";
import { inventory, inventoryCandidates } from "./inventory.ts";

const organization = {
  kind: "organization" as const,
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make("org"),
};
const viewer = { id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" };
const key = { organization, viewer };
const project = { id: "p", clientId: "org", name: "Platform name", status: "ACTIVE" };

it.each(["live", "outage", "partial", "refused", "denied"] as const)(
  "inventory joins source facts with %s coverage",
  (state) => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, "org", [project], { services: [] });
    seedHqNavigation(store, "org", {
      structure: {
        ungrouped: [],
        apps: [
          {
            id: "app",
            name: "Application",
            projects: [{ projectId: "p", name: "HQ name", kind: "mate", mate: { face: "face" } }],
          },
        ],
      },
    });
    const scope = projectsScope("org");
    if (state === "outage")
      store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "parent-lost" } });
    if (state === "partial") {
      store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
      store.dispatch({
        kind: "baseline-commit",
        scope,
        generation: 1,
        via: "zerops-realtime",
        members: ["p", "unread"],
        rows: [],
        partial: true,
      });
    }
    if (state === "refused")
      store.dispatch({
        kind: "stream",
        key: scope,
        now: 0,
        event: {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "definitive-refusal", message: "No" },
        },
      });
    if (state === "denied")
      store.dispatch({ kind: "access", family: "project", id: "p", access: "denied" });
    const result = inventory.derive(readsOfState(store.state()), key);
    expect(result.projects.map(({ name }) => name)).toEqual(
      state === "denied" ? [] : ["Platform name"],
    );
    if (state !== "denied")
      expect(result.projects[0]?.hq).toMatchObject({
        appId: "app",
        appName: "Application",
        kind: "mate",
        mate: { face: "face" },
      });
    expect(result.authority.get(projectKeyOf([...result.projectRefs.values()][0]!))?.kind).toBe(
      state === "denied" ? "withheld" : "authorized",
    );
    expect(result.lost.has("p")).toBe(state === "denied");
    expect(result.trouble).toBe(
      state === "outage" ? "retrying" : state === "refused" ? "refused" : null,
    );
    registry.dispose();
  },
);

it("does not wait on HQ detail or inventory services to show a new platform project", () => {
  const registry = AtomRegistry.make();
  const store = mountRoster(registry, "org", [project]);
  const result = inventory.derive(readsOfState(store.state()), key);
  expect(result.projects).toMatchObject([project]);
  expect(result.projects[0]?.hq).toBeUndefined();
  expect(inventoryCandidates.derive(readsOfState(store.state()), key)[0]?.project.name).toBe(
    "Platform name",
  );
  registry.dispose();
});
