/**
 * What an organization says to a person with no project in it, by what their role may do
 * (`platformCapabilities`): whether they may create a project, and whether their role reaches
 * every project by itself. A role below Read only sees only the projects it is given, so an empty
 * list there says nothing of the organization: it never reads as an organization with nothing in
 * it, and it never tells someone who may not create a project to start one. Pure.
 *
 * One who may create a project starts one, meeting its first Mate by name (`FirstRunView`); a
 * Developer is told, under it, which projects this page will list.
 */
export type FirstRunWords =
  | {
      readonly kind: "start";
      /** Under it all: what the role means for what this page lists. */
      readonly note: string | undefined;
    }
  | { readonly kind: "wait"; readonly heading: string; readonly body: string };

export function firstRunWords(input: {
  readonly create: boolean;
  readonly reachesEveryProject: boolean;
}): FirstRunWords {
  if (input.create)
    return {
      kind: "start",
      note: input.reachesEveryProject
        ? undefined
        : "You're a Developer: you start projects and join the ones you're added to. Projects an owner or admin gives you access to appear here.",
    };
  return input.reachesEveryProject
    ? {
        kind: "wait",
        heading: "No projects yet",
        body: "Projects appear here once someone on your team starts one.",
      }
    : {
        kind: "wait",
        heading: "Nothing is shared with you yet",
        body: "You're a Guest: you follow the projects you're added to. Projects an owner or admin gives you access to appear here.",
      };
}
