/**
 * What an organization says to a person with no project in it, by what their role may do
 * (`platformCapabilities`): whether they may create a project, and whether their role reaches
 * every project by itself. A role below Read only sees only the projects it is given, so an empty
 * list there says nothing of the organization: it never reads as an organization with nothing in
 * it, and it never tells someone who may not create a project to start one. Pure.
 *
 * One who may create a project meets its first Mate by name — the one the screen's own form
 * proposes, and renames as it is typed.
 */
interface FirstRunWords {
  /** Above the heading, to one who starts here; none otherwise. */
  readonly welcome: string | undefined;
  readonly heading: string;
  readonly body: string;
  /** New project is offered: the role creates projects. */
  readonly newProject: boolean;
  /** Under it all: what the role means for what this page lists. */
  readonly note: string | undefined;
}

export function firstRunWords(input: {
  readonly create: boolean;
  readonly reachesEveryProject: boolean;
  /** The first Mate the form proposes, met by name; the Mate until it has one. */
  readonly mateName: string;
}): FirstRunWords {
  if (input.create)
    return {
      welcome: "Welcome to Mate",
      heading: `Meet ${input.mateName}, your first Mate`,
      body: `A Mate is a coding agent with a workspace of its own. Tell ${input.mateName} what to build, and it writes the code, runs it and gives you a preview to try.`,
      newProject: true,
      note: input.reachesEveryProject
        ? undefined
        : "You're a Developer: you start projects and join the ones you're added to. Projects an owner or admin gives you access to appear here.",
    };
  return input.reachesEveryProject
    ? {
        welcome: undefined,
        heading: "No projects yet",
        body: "Projects appear here once someone on your team starts one.",
        newProject: false,
        note: undefined,
      }
    : {
        welcome: undefined,
        heading: "Nothing is shared with you yet",
        body: "You're a Guest: you follow the projects you're added to. Projects an owner or admin gives you access to appear here.",
        newProject: false,
        note: undefined,
      };
}
