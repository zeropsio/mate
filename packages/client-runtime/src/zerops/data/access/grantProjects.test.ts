/**
 * One rule says which projects a person can see: what the inventory admits and what a listing
 * counts as never this person's are read from it, so the two can never disagree.
 */
import { describe, expect, it } from "vite-plus/test";

import { project } from "../__fixtures__/index.ts";
import type { AccessState, ProjectEffectiveAccess } from "../types.ts";
import type { Evidence } from "./grant.ts";
import { evidenceProjectRefs, inventoryProjectRefs, projectsNeverSeen } from "./grantProjects.ts";

type Role = ProjectEffectiveAccess["role"];
const P = project("project-vault");

/** The evidence's round, the project verified with `role`; none where it names no role. */
const evidenceWith = (role: Role | undefined): Evidence =>
  ({
    projects: new Map(role === undefined ? [] : [[P.projectId, { access: { project: P, role } }]]),
    unverified: new Map(),
    closedProjects: new Map(),
  }) as unknown as Evidence;

/** The grant's access, a command having established `role` on the project. */
const accessWith = (status: AccessState["status"], role: Role): AccessState => {
  const grant = { projects: [{ project: P, role, mutationsAllowed: false }] };
  return (status === "verified"
    ? { status, ...grant }
    : { status, previous: grant }) as unknown as AccessState;
};

describe("which projects a person can see: one rule", () => {
  it.each([
    { name: "verified with access", evidence: "BASIC_USER", access: undefined, sees: true },
    { name: "verified NO_ACCESS", evidence: "NO_ACCESS", access: undefined, sees: false },
    {
      name: "a command established a role after NO_ACCESS evidence",
      evidence: "NO_ACCESS",
      access: accessWith("verified", "BASIC_USER"),
      sees: true,
    },
    {
      name: "a command established NO_ACCESS after a verified role",
      evidence: "BASIC_USER",
      access: accessWith("verified", "NO_ACCESS"),
      sees: false,
    },
    {
      name: "established before, while it is verified again",
      evidence: "NO_ACCESS",
      access: accessWith("verifying", "BASIC_USER"),
      sees: true,
    },
    {
      name: "established before its read failed",
      evidence: "NO_ACCESS",
      access: accessWith("failed", "BASIC_USER"),
      sees: true,
    },
    {
      name: "established NO_ACCESS before the grant expired: the evidence decides",
      evidence: "BASIC_USER",
      access: accessWith("expired", "NO_ACCESS"),
      sees: true,
    },
    {
      name: "established NO_ACCESS before a denial: the evidence decides",
      evidence: "BASIC_USER",
      access: accessWith("denied", "NO_ACCESS"),
      sees: true,
    },
    {
      name: "established NO_ACCESS, no evidence yet",
      evidence: undefined,
      access: accessWith("verified", "NO_ACCESS"),
      sees: false,
    },
  ] satisfies ReadonlyArray<{
    name: string;
    evidence: Role | undefined;
    access: AccessState | undefined;
    sees: boolean;
  }>)("$name: sees $sees", ({ evidence: role, access, sees }) => {
    const evidence = evidenceWith(role);
    const admitted = inventoryProjectRefs(evidenceProjectRefs(evidence), access).some(
      (ref) => ref.projectId === P.projectId,
    );
    const never = projectsNeverSeen({ evidence, access, withheld: () => false });
    expect(admitted).toBe(sees);
    expect(never(P.projectId)).toBe(!sees);
  });

  it.each([
    { name: "a denial", denied: true, withheld: false, never: true },
    { name: "one the grant withholds", denied: false, withheld: true, never: true },
    { name: "one only named so far", denied: false, withheld: false, never: false },
  ] as const)("$name: never seen $never", ({ denied, withheld, never }) => {
    const evidence = {
      projects: new Map(),
      unverified: new Map([[P.projectId, { project: P, failure: null }]]),
      closedProjects: new Map(
        denied ? [[P.projectId, { project: P, evidence: "direct-forbidden" }]] : [],
      ),
    } as unknown as Evidence;
    expect(
      projectsNeverSeen({ evidence, access: undefined, withheld: () => withheld })(P.projectId),
    ).toBe(never);
  });
});
