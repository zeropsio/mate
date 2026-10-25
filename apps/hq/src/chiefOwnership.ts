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

/**
 * Whether a project is a personal Chief's: one registered, or tagged {@link CHIEF_TAG}, that is not
 * the organisation's marked Chief (`mark`). The marked Chief is an ordinary project to its readers.
 */
export const isPersonalChief = (
  facts: OrgView,
  projectId: string,
  chiefs: ReadonlyMap<string, string | null>,
  mark: string | null,
): boolean =>
  projectId !== mark &&
  (chiefs.has(projectId) ||
    facts.projects.find((candidate) => candidate.id === projectId)?.tags.includes(CHIEF_TAG) ===
      true);

/** Platform org authority never grants another person's personal Chief. */
export const chiefProjectIsVisible = (
  facts: OrgView,
  userId: string,
  projectId: string,
  chiefs: ReadonlyMap<string, string | null>,
  mark: string | null,
): boolean => !isPersonalChief(facts, projectId, chiefs, mark) || chiefs.get(projectId) === userId;

/** A project read requires both personal ownership, when relevant, and platform permission. */
export const readsChiefProject = (
  facts: OrgView,
  userId: string,
  projectId: string,
  chiefs: ReadonlyMap<string, string>,
  mark: string | null,
): boolean =>
  chiefProjectIsVisible(facts, userId, projectId, chiefs, mark) &&
  (!isPersonalChief(facts, projectId, chiefs, mark) ||
    !chiefs.has(projectId) ||
    chiefOfPerson(facts, userId, chiefs)?.projectId === projectId) &&
  can({ kind: "person", userId }, "read_project", { projectId }, facts).allow;
