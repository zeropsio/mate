/** Zerops-native capabilities: one derivation for controls and operation admission. */
import { mayCreateProjects, roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { zeropsClientsFromUser, type ZeropsOrganization } from "../../zerops/api.ts";
import type { Projection } from "../store.ts";
import { platformAccess } from "./platformAccess.ts";
import { sameValue } from "./equal.ts";

export interface PlatformMembership {
  readonly kind: "known" | "unavailable";
  readonly viewer: ZeropsOrganization | undefined;
}
export const platformMembership: Projection<string, PlatformMembership> = {
  name: "platformMembership",
  keyOf: (id) => id,
  derive: (read, orgId) => {
    const fact = read.fact("organizationUser", orgId);
    if (fact.kind !== "known") return { kind: "unavailable", viewer: undefined };
    return {
      kind: "known",
      viewer: zeropsClientsFromUser(fact.value).find((org) => org.id === orgId),
    };
  },
  equals: sameValue,
};
export interface PlatformCapabilitiesKey {
  readonly orgId: string;
  readonly projectId?: string | undefined;
  readonly viewer: ZeropsOrganization | undefined;
}
export const platformCapabilities: Projection<
  PlatformCapabilitiesKey,
  {
    readonly createProject: boolean;
    readonly manageOrganization: boolean;
    readonly read: boolean;
    readonly operate: boolean;
    readonly administer: boolean;
  }
> = {
  name: "platformCapabilities",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, { orgId, projectId, viewer }) => {
    const access =
      projectId === undefined
        ? undefined
        : platformAccess.derive(read, { orgId, projectId, viewer });
    const role = access?.kind === "allowed" ? access.role : undefined;
    return {
      createProject: viewer !== undefined && viewer.id === orgId && mayCreateProjects(viewer),
      manageOrganization:
        viewer !== undefined && viewer.id === orgId && roleAtLeast(viewer.roleCode, "ADMIN"),
      read: roleAtLeast(role, "READ_ONLY"),
      operate: roleAtLeast(role, "BASIC_USER"),
      administer: roleAtLeast(role, "ADMIN"),
    };
  },
  equals: sameValue,
};
