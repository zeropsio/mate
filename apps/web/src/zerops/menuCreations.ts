import type { NewProjectBirth } from "./newProjectBirth";

/** An ordinary Create joins the list under its application's id as soon as HQ names it. */
export function menuCreations(
  held: ReadonlyArray<NewProjectBirth>,
): ReadonlyArray<NewProjectBirth> {
  return held.filter((birth) => birth.chief === true || birth.appId !== null);
}
