import { describe, expect, it } from "vite-plus/test";

import { zeropsRegistrations } from "./demand.ts";
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
