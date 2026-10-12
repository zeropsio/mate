/**
 * The Chief (prototype, 2026-10-12): a person's Mate for the whole organization rather than
 * one project, the way the owner works with a coding agent that reaches every project. Its project
 * carries {@link CHIEF_TAG}; the menu draws it first, apart from the projects, and its empty
 * conversation asks about the organization.
 */
export const CHIEF_TAG = "chief";

/** Whether a project is a Chief's: it carries {@link CHIEF_TAG}. */
export function isChief(project: {
  readonly tagList?: ReadonlyArray<string> | undefined;
}): boolean {
  return project.tagList?.includes(CHIEF_TAG) === true;
}

/** The question a Chief's empty conversation asks: the organization, never its own project. */
export function chiefQuestion(name: string, organization: string | undefined): string {
  return `What should ${name} look into across ${organization ?? "your organization"}?`;
}
