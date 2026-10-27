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

/**
 * What a new conversation's headline asks: what to do in its project, once that is known; in a
 * Mate's environment whose project is still read, nothing yet — it has a project, and saying there
 * is none (or offering to pick one) would be taken back the moment it is read; elsewhere, to pick
 * one of the projects there are, or that there is none.
 */
export function draftHeroHeadlineKind(input: {
  readonly hasResolvedProject: boolean;
  /** The draft belongs to an environment (`activeProjectRef`). */
  readonly inEnvironment: boolean;
  readonly canChooseProject: boolean;
}): "question" | "reading" | "choose" | "no-project" {
  if (input.hasResolvedProject) return "question";
  if (input.inEnvironment) return "reading";
  return input.canChooseProject ? "choose" : "no-project";
}
