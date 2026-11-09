import { describe, expect, it } from "vite-plus/test";

import { resolveAddProjectVerb, resolveMateRegistration } from "./groupCreation.ts";
import type { ZeropsRegistry } from "./hq/registry.ts";

const ACME: ZeropsRegistry = {
  groups: [
    {
      groupId: "g-acme",
      name: "Acme",
      projects: [{ projectId: "p-fen", kind: "mate" }],
    },
  ],
};

describe("who may add a project: whom HQ offers making an application", () => {
  it("offers it where HQ does", () => {
    expect(resolveAddProjectVerb({ offer: { kind: "allowed" } })).toEqual({ offered: true });
  });

  it("does not offer it to a member who can create projects — the registry is not theirs", () => {
    // The same person IS offered *Add Mate*: making a project is a platform
    // right, writing the registry is not.
    const verb = resolveAddProjectVerb({
      offer: { kind: "refused", reason: "not_structure_writer" },
    });
    expect(verb).toEqual({ offered: false, reason: "Only an owner or admin adds a project." });
  });
});

describe("resolveMateRegistration", () => {
  it("is registered once the registry names the project", () => {
    expect(resolveMateRegistration({ registry: ACME, projectId: "p-fen" })).toBe("registered");
  });

  it("waits for an owner for a Mate a member created", () => {
    expect(resolveMateRegistration({ registry: ACME, projectId: "p-new" })).toBe("unplaced");
  });
});
