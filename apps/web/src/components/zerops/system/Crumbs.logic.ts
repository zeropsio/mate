/**
 * Where a page sits, outermost first — a containment trail, never a way back to wherever the person
 * came from (the owner, 2026-09-19: a first crumb that went to "some random convo" looked like it
 * knew). Overview, then the project, then the page's own place: "Overview / Tea Shop / Production".
 * Each step but the last opens the page of what contains this one; the last is this page.
 *
 * Pure: no React.
 */

/** Where a step of the trail leads; `undefined` on the trail's last step, the page itself. */
export type TrailTarget =
  | { readonly kind: "overview" }
  | { readonly kind: "project"; readonly groupId: string };

export interface TrailStep {
  readonly label: string;
  readonly to: TrailTarget | undefined;
}

/**
 * A page's trail. `project` is the project it sits in, its name `undefined` while unread: the trail
 * then stops at Overview, which still opens, because a project's id is never a name and a place
 * named under nobody says nothing. `here` is the page's own name past the project — "Production",
 * a stage's name, a change's title — and absent on the project's own page.
 */
export function pageTrail(input: {
  readonly project?: { readonly groupId: string; readonly name: string | undefined } | undefined;
  readonly here?: string | undefined;
}): ReadonlyArray<TrailStep> {
  const overview: TrailStep = { label: "Overview", to: { kind: "overview" } };
  const { project, here } = input;
  if (project === undefined) return [{ ...overview, to: undefined }];
  if (project.name === undefined) return [overview];
  if (here === undefined) return [overview, { label: project.name, to: undefined }];
  return [
    overview,
    { label: project.name, to: { kind: "project", groupId: project.groupId } },
    { label: here, to: undefined },
  ];
}
