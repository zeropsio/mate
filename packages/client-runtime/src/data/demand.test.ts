import { describe, expect, it } from "vite-plus/test";

import { detailScopeOf, makeDetailDemands, zeropsRegistrations } from "./demand.ts";
import { FAMILIES } from "./families/index.ts";
import { scopeOf, type AnyFamilySpec, type ScopeOwner } from "./families/spec.ts";
import { emptyAccount } from "./model.ts";
import { streamOf } from "./reducer.ts";

/**
 * A detail family, for this test alone: one project's app versions, registered only while a
 * screen demands that project — never as part of the organization's navigation.
 */
const detailFamily = {
  family: "appVersion",
  authority: "zerops",
  scope: { source: "zerops", suffix: "versions", leaving: "absent-unverified", demand: "detail" },
  zerops: {
    entity: "app-version",
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

const families = [...FAMILIES, detailFamily];
/** The fixture family's name, outside the registered `Family` names on purpose. */
const DETAIL = detailFamily.family;

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
      "zerops:org:services",
      "zerops:org:services",
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
      { family: DETAIL, ownerId: "p1" },
      { family: DETAIL, ownerId: "p2" },
    ]).filter((registration) => registration.family === DETAIL);

    expect(registrations.map(({ scope, role, path }) => [scope, role, path])).toEqual([
      ["zerops:org:versions:p1", "updates", "/app-version/search"],
      ["zerops:org:versions:p1", "membership", "/app-version/search"],
      ["zerops:org:versions:p2", "updates", "/app-version/search"],
      ["zerops:org:versions:p2", "membership", "/app-version/search"],
    ]);
    expect(registrations[0]?.search).toContainEqual({
      name: "projectId",
      operator: "eq",
      value: "p1",
    });
    const scope = scopeOf(detailFamily, "org", "p1");
    expect(streamOf(emptyAccount, scope).parent).toBe("zerops:org");
  });
});

describe("makeDetailDemands", () => {
  it("marks a held scope to be read again once, and asks nothing of one no screen holds", () => {
    let heard = 0;
    const demands = makeDetailDemands({ demanded: () => {} });
    demands.onChange(() => (heard += 1));
    demands.again("zerops:org:project:p1");
    expect(heard).toBe(0);
    expect(demands.takeAgain("zerops:org:project:p1")).toBe(false);

    const release = demands.hold("zerops:org:project:p1");
    heard = 0;
    demands.again("zerops:org:project:p1");
    expect(heard).toBe(1);
    expect(demands.takeAgain("zerops:org:project:p1")).toBe(true);
    expect(demands.takeAgain("zerops:org:project:p1")).toBe(false);

    demands.again("zerops:org:project:p1");
    release();
    expect(demands.takeAgain("zerops:org:project:p1")).toBe(false);
  });

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
