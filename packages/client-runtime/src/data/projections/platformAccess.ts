/** Platform admission from the owner's retained project evidence; never expires on a clock. */
import type { ZeropsOrganization } from "../../zerops/api.ts";
import { resolveMateProjectRole } from "../../zerops/mateAccess.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export type PlatformAccess =
  | { readonly kind: "allowed"; readonly role: string }
  | { readonly kind: "unknown" | "denied" | "deleted" };
export interface PlatformAccessKey {
  readonly orgId: string;
  readonly projectId: string;
  readonly viewer: ZeropsOrganization | undefined;
}
export const platformAccess: Projection<PlatformAccessKey, PlatformAccess> = {
  name: "platformAccess",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, { orgId, projectId, viewer }) => {
    const fact = read.fact("project", projectId);
    if (fact.kind === "deleted") return { kind: "deleted" };
    if (fact.kind === "withheld") return { kind: fact.reason === "denied" ? "denied" : "unknown" };
    if (fact.kind !== "known" || viewer === undefined) return { kind: "unknown" };
    const project = fact.value;
    if (project.clientId !== orgId) return { kind: "unknown" };
    const own =
      project.userRoles?.some(({ clientUserId }) => clientUserId === viewer.membershipId) === true
        ? undefined
        : project.viewerRoleCode;
    const role = resolveMateProjectRole({
      project:
        own === undefined
          ? project
          : { ...project, userRoles: [{ clientUserId: viewer.membershipId, roleCode: own }] },
      viewer,
    });
    return role === "NO_ACCESS" ? { kind: "denied" } : { kind: "allowed", role };
  },
  equals: sameValue,
};
