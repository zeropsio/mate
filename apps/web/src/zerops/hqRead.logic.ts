import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import type { HqNavigationView } from "../state/zerops";
import { hqDown } from "../state/zerops";

/**
 * Whether HQ's navigation of the organization has said what it will (unknown is not empty, but it
 * ends): its catchup ended, or HQ stopped answering. Until then, HQ's list can contradict an empty
 * answer.
 */
export function hqNavigationSettled(input: {
  readonly organizationId: string | null;
  readonly navigation: Pick<
    HqNavigationView,
    "orgId" | "read" | "live" | "reconnecting" | "capped" | "refusal"
  >;
}): boolean {
  if (input.organizationId === null) return true;
  return (
    input.navigation.orgId === input.organizationId &&
    (input.navigation.read === "read" || hqDown(input.navigation))
  );
}

/** What a page opened by its address says when Zerops gives the viewer none of its project. */
export const NO_ZEROPS_ACCESS_LINE = "Your Zerops role doesn't give you access to this project.";

/**
 * The reason a detail page cannot read its project from HQ, without another platform read. HQ lists
 * what Zerops gives the viewer: a role that reads every project proves a missing one gone, a lower
 * one proves only that none of its environments is theirs; an unread role proves neither.
 */
export function unreadFlowWords(input: {
  readonly failure: string | undefined;
  readonly groupsRead: boolean;
  readonly groupKnown: boolean;
  /** The viewer's organization role as Zerops now says it; undefined while it is not read. */
  readonly orgRole: string | undefined;
}): string | null {
  if (input.failure !== undefined) return input.failure;
  if (!input.groupsRead || input.groupKnown || input.orgRole === undefined) return null;
  return roleAtLeast(input.orgRole, "READ_ONLY")
    ? "This project isn't here any more."
    : NO_ZEROPS_ACCESS_LINE;
}
