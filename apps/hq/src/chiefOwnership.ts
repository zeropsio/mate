import { ZEROPS_ACTIVE_MEMBER_STATUS } from "@t3tools/shared/zeropsRoles";
import { can } from "./permissions.ts";
import type { OrgView } from "./roles.ts";

/** The tag a Chief's project carries. */
export const CHIEF_TAG = "chief";

/** A registered Chief is usable only while its person and project still have access. */
export const chiefOfPerson = (
  facts: OrgView,
  ownerUserId: string | null,
  chiefs: ReadonlyMap<string, string>,
) => {
  if (
    ownerUserId === null ||
    !facts.members.some(
      (member) =>
        member.kind === "person" &&
        member.userId === ownerUserId &&
        member.status === ZEROPS_ACTIVE_MEMBER_STATUS,
    )
  )
    return null;
  const projectId = [...chiefs].find(([, userId]) => userId === ownerUserId)?.[0];
  return projectId !== undefined &&
    facts.projects.some(
      (project) =>
        project.id === projectId &&
        project.tags.includes(CHIEF_TAG) &&
        project.status !== "DELETED" &&
        project.status !== "DELETING",
    ) &&
    can({ kind: "person", userId: ownerUserId }, "observe_mate", { projectId }, facts).allow
    ? { ownerUserId, projectId }
    : null;
};

/** Platform org authority never grants another person's personal Chief. */
export const chiefProjectIsVisible = (
  facts: OrgView,
  userId: string,
  projectId: string,
  chiefs: ReadonlyMap<string, string | null>,
): boolean => {
  const project = facts.projects.find((candidate) => candidate.id === projectId);
  const personal = chiefs.has(projectId) || project?.tags.includes(CHIEF_TAG) === true;
  return !personal || chiefs.get(projectId) === userId;
};

/** A project read requires both personal ownership, when relevant, and platform permission. */
export const readsChiefProject = (
  facts: OrgView,
  userId: string,
  projectId: string,
  chiefs: ReadonlyMap<string, string>,
): boolean =>
  chiefProjectIsVisible(facts, userId, projectId, chiefs) &&
  (!chiefs.has(projectId) || chiefOfPerson(facts, userId, chiefs)?.projectId === projectId) &&
  can({ kind: "person", userId }, "read_project", { projectId }, facts).allow;
