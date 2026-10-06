import { describe, expect, it } from "vite-plus/test";

import { detailScopeOf, makeDetailDemands, zeropsRegistrations } from "./demand.ts";
import { FAMILIES } from "./families/index.ts";
import { scopeOf, type AnyFamilySpec, type ScopeOwner } from "./families/spec.ts";
import { emptyAccount } from "./model.ts";
import { streamOf } from "./reducer.ts";

/**
 * A detail family, for this test alone: one project's services, registered only while a screen
 * demands that project — never as part of the organization's navigation.
 */
const serviceFamily = {
  family: "service",
  authority: "zerops",
  scope: { source: "zerops", suffix: "services", leaving: "absent-unverified", demand: "detail" },
  zerops: {
    entity: "service-stack",
    membership: ({ orgId, ownerId }: ScopeOwner) => [
      { name: "clientId", operator: "eq", value: orgId },
      { name: "projectId", operator: "eq", value: ownerId },
    ],
    updates: ({ orgId, ownerId }: ScopeOwner) => [
      { name: "clientId", operator: "eq", value: orgId },
      { name: "projectId", operator: "eq", value: ownerId },
    ],
    decode: () => null,
  },
} as unknown as AnyFamilySpec;

const families = [...FAMILIES, serviceFamily];
/** The fixture family's name, outside the registered `Family` names on purpose. */
const SERVICE = serviceFamily.family;

describe("zeropsRegistrations", () => {
  it("registers navigation families for the organization always, a detail family never unasked", () => {
    const navigation = zeropsRegistrations(families, "org", []);
    expect(navigation.map((registration) => registration.scope)).toEqual([
      "zerops:org:projects",
      "zerops:org:projects",
      "zerops:org:running",
      "zerops:org:running",
      "zerops:org:active",
      "zerops:org:active",
    ]);
  });

  it("registers the organization's projects as measured: its whole roster, both streams", () => {
    const projects = zeropsRegistrations(families, "org", []).filter(
      (registration) => registration.scope === "zerops:org:projects",
    );
    expect(projects.map(({ role, path, search }) => [role, path, search])).toEqual([
      ["updates", "/project/search", [{ name: "clientId", operator: "eq", value: "org" }]],
      ["membership", "/project/search", [{ name: "clientId", operator: "eq", value: "org" }]],
    ]);
  });

  it("registers a detail family for each owner it is demanded for, under the organization's link", () => {
    const registrations = zeropsRegistrations(families, "org", [
      { family: SERVICE, ownerId: "p1" },
      { family: SERVICE, ownerId: "p2" },
    ]).filter((registration) => registration.family === SERVICE);

    expect(registrations.map(({ scope, role, path }) => [scope, role, path])).toEqual([
      ["zerops:org:services:p1", "updates", "/service-stack/search"],
      ["zerops:org:services:p1", "membership", "/service-stack/search"],
      ["zerops:org:services:p2", "updates", "/service-stack/search"],
      ["zerops:org:services:p2", "membership", "/service-stack/search"],
    ]);
    expect(registrations[0]?.search).toContainEqual({
      name: "projectId",
      operator: "eq",
      value: "p1",
    });
    const scope = scopeOf(serviceFamily, "org", "p1");
    expect(streamOf(emptyAccount, scope).parent).toBe("zerops:org");
  });
});

describe("makeDetailDemands", () => {
  it("demands a scope at its first hold and lets it go at its last release, once", () => {
    const said: Array<readonly [string, boolean]> = [];
    let heard = 0;
    const demands = makeDetailDemands({ demanded: (scope, on) => said.push([scope, on]) });
    demands.onChange(() => (heard += 1));
    const first = demands.hold("zerops:org:history:p1");
    const second = demands.hold("zerops:org:history:p1");
    expect(demands.scopes()).toEqual(["zerops:org:history:p1"]);

    first();
    first();
    expect(demands.scopes()).toEqual(["zerops:org:history:p1"]);
    second();
    expect(demands.scopes()).toEqual([]);
    expect(said).toEqual([
      ["zerops:org:history:p1", true],
      ["zerops:org:history:p1", false],
    ]);
    expect(heard).toBe(2);
  });

  it("names a listing's scope by the listing, and a detail family's by its own scope", () => {
    expect(detailScopeOf("org", { family: "process", listing: "history", ownerId: "p1" })).toBe(
      "zerops:org:history:p1",
    );
  });
});
