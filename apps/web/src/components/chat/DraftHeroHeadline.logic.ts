/**
 * The project a new conversation's question names: where a Mate lives, its Zerops project as HQ
 * names it — known before its workspace is read, and never the workspace's own title, which a
 * Mate's container names after the Mate; elsewhere the project as the header names it. Null while
 * neither is known.
 */
export function draftHeroProjectName(input: {
  readonly mateProject: string | undefined;
  readonly activeProjectTitle: string | null;
}): string | null {
  return input.mateProject ?? input.activeProjectTitle;
}
