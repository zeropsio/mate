/**
 * The Mastermate (prototype, 2026-10-12): a person's Mate for the whole organization rather than
 * one project, the way the owner works with a coding agent that reaches every project. Its project
 * carries {@link MASTERMATE_TAG}; the menu draws it first, apart from the projects, and its empty
 * conversation asks about the organization.
 */
export const MASTERMATE_TAG = "mastermate";

/** Whether a project is a Mastermate's: it carries {@link MASTERMATE_TAG}. */
export function isMastermate(project: {
  readonly tagList?: ReadonlyArray<string> | undefined;
}): boolean {
  return project.tagList?.includes(MASTERMATE_TAG) === true;
}

/** The question a Mastermate's empty conversation asks: the organization, never its own project. */
export function mastermateQuestion(name: string, organization: string | undefined): string {
  return `What should ${name} look into across ${organization ?? "your organization"}?`;
}
