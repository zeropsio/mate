/**
 * What an organization says to a person with no project in it, by what their role may do
 * (`platformCapabilities`): whether they may create a project, and whether their role reaches
 * every project by itself. A role below Read only sees only the projects it is given, so an empty
 * list there says nothing of the organization: it never reads as an organization with nothing in
 * it, and it never tells someone who may not create a project to start one. Pure.
 */
export interface FirstRunWords {
  readonly heading: string;
  readonly body: string;
  /** New project is offered: the role creates projects. */
  readonly newProject: boolean;
}

const MATE_IS =
  "A Mate is a coding agent with a workspace of its own and one conversation you come back to.";

export function firstRunWords(input: {
  readonly create: boolean;
  readonly reachesEveryProject: boolean;
}): FirstRunWords {
  if (input.create)
    return input.reachesEveryProject
      ? {
          heading: "Start a project",
          body: `${MATE_IS} Name a project and it is up in a few minutes.`,
          newProject: true,
        }
      : {
          heading: "Start a project",
          body: `You're a Developer: you start projects and join the ones you're added to. Projects your team gives you access to appear here. ${MATE_IS}`,
          newProject: true,
        };
  return input.reachesEveryProject
    ? {
        heading: "No projects yet",
        body: "Projects appear here once someone on your team starts one.",
        newProject: false,
      }
    : {
        heading: "Nothing is shared with you yet",
        body: "You're a Guest: you follow the projects you're added to. Projects an owner or admin gives you access to appear here.",
        newProject: false,
      };
}
