import type { OrgView } from "./roles.ts";
import { can } from "./permissions.ts";
import { asOrgRole, roleAtLeast } from "@t3tools/shared/zeropsRoles";
/** Retired history never inherits a former project grant. An existing hidden project stays live. */
export const mayReadUsage = (
  facts: OrgView,
  userId: string,
  projectId: string,
  deleted: boolean,
) => {
  const member = facts.members.find(
    (value) => value.kind === "person" && value.userId === userId && value.status === "ACTIVE",
  );
  if (member === undefined) return false;
  if (deleted) return roleAtLeast(asOrgRole(member.roleCode), "READ_ONLY");
  return (
    facts.projects.some((project) => project.id === projectId) &&
    can({ kind: "person", userId }, "observe_mate", { projectId }, facts).allow
  );
};
/** The same canonical owner rule used for navigation and retained usage grouping. */
export const usageOwner = (input: {
  readonly facts: OrgView;
  readonly projectId: string;
  readonly everSignedIn: Readonly<Record<string, string>>;
  readonly runsWithoutSignIn: boolean;
  readonly madeBy: string | null;
  readonly standupRequestedBy: string | null;
}) => {
  const owner = input.facts.projects
    .find((project) => project.id === input.projectId)
    ?.userRoles.find((role) => role.roleCode === "OWNER");
  return owner !== undefined
    ? (input.facts.members.find(
        (member) => member.kind === "person" && member.clientUserId === owner.clientUserId,
      )?.userId ?? null)
    : (input.everSignedIn["claude-code"] ??
        input.everSignedIn.codex ??
        (input.runsWithoutSignIn ? (input.madeBy ?? input.standupRequestedBy) : null));
};
