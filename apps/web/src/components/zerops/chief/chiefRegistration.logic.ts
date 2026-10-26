import { isChief, type OwnChief } from "~/zerops/chief";

/** A tagged project's direct page offers registration only with current setup and project access. */
export function chiefRegistrationOffered(input: {
  readonly project: { readonly id: string; readonly tagList?: readonly string[] } | undefined;
  readonly own: OwnChief;
  readonly maySetUp: boolean;
  readonly mayObserve: boolean;
  readonly anotherPersonsChief: boolean;
  readonly ownershipAnswered: boolean;
}): boolean {
  return (
    input.project !== undefined &&
    isChief(input.project) &&
    input.own !== undefined &&
    input.own !== input.project.id &&
    input.ownershipAnswered &&
    input.maySetUp &&
    input.mayObserve &&
    !input.anotherPersonsChief
  );
}
