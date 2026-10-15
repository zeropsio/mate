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

/**
 * What a new conversation with no project to pick says: an invitation to add one only to a role
 * that may create it (`roleOffers`); to anyone else, that there is none yet — never a door to New
 * project they would be refused at.
 */
export function draftHeroNoProject(mayCreateProject: boolean): {
  /** The headline. */
  readonly words: string;
  /** "Add a project" opens New project. */
  readonly offersNewProject: boolean;
} {
  return mayCreateProject
    ? { words: "Add a project to start", offersNewProject: true }
    : { words: "No project to start in yet", offersNewProject: false };
}
