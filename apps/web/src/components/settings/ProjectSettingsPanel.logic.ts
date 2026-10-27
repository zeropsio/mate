export function projectGroupTitleNeedsUpdate(
  memberTitles: ReadonlyArray<string>,
  nextTitle: string,
  wasEdited: boolean,
): boolean {
  return wasEdited && memberTitles.some((title) => title !== nextTitle);
}

/**
 * What a project's settings page shows: the project, or — only once the projects are read — that
 * there are none, or that this one is gone; before that it reads, saying nothing about it.
 */
export function projectSettingsState(input: {
  readonly found: boolean;
  /**
   * Every environment's projects are read or will not be: live, failed or stopped, an empty catalog
   * included (`useAllEnvironmentShellsBootstrapped`) — a stopped Mate never holds this page waiting.
   */
  readonly read: boolean;
  readonly count: number;
}): "detail" | "reading" | "no-projects" | "gone" {
  if (input.found) return "detail";
  if (!input.read) return "reading";
  return input.count === 0 ? "no-projects" : "gone";
}
