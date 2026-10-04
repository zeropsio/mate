/** The reason a detail page cannot read its project from HQ, without another platform read. */
export function unreadFlowWords(input: {
  readonly failure: string | undefined;
  readonly groupsRead: boolean;
  readonly groupKnown: boolean;
}): string | null {
  if (input.failure !== undefined) return input.failure;
  if (input.groupsRead && !input.groupKnown) return "This project isn't here any more.";
  return null;
}
