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
