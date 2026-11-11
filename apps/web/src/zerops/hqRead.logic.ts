import type { HqNavigationView } from "../state/zerops";

/**
 * Whether HQ's navigation of the organization has said what it will (unknown is not empty, but it
 * ends): its catchup ended, or HQ refused or kept failing its first answer. Until then, HQ's list
 * can contradict an empty answer.
 */
export function hqNavigationSettled(input: {
  readonly organizationId: string | null;
  readonly navigation: Pick<HqNavigationView, "orgId" | "read" | "retrying" | "capped" | "refusal">;
}): boolean {
  if (input.organizationId === null) return true;
  return (
    input.navigation.orgId === input.organizationId &&
    (input.navigation.read === "read" ||
      input.navigation.refusal !== null ||
      input.navigation.capped ||
      input.navigation.retrying)
  );
}

/** A project HQ does not list this person: whether it still exists is not told. */
export const NO_ACCESS = { title: "No access", why: "Deleted or access removed" } as const;

/** What a detail page says in place of a project it cannot read. */
export type UnreadFlowWords = string | typeof NO_ACCESS;

/** The reason a detail page cannot read its project from HQ, without another platform read. */
export function unreadFlowWords(input: {
  readonly failure: string | undefined;
  readonly groupsRead: boolean;
  readonly groupKnown: boolean;
}): UnreadFlowWords | null {
  if (input.failure !== undefined) return input.failure;
  return !input.groupsRead || input.groupKnown ? null : NO_ACCESS;
}
