/**
 * The Chief: a person's own Mate for the whole organization rather than one project, the way the
 * owner works with a coding agent that reaches every project. Its project carries
 * {@link CHIEF_TAG}, and HQ says whose it is (`GET /api/chief`): the viewer's own is the menu's top
 * row, apart from the projects, and its empty conversation asks about the organization. Another
 * person's Chief appears nowhere.
 */
export const CHIEF_TAG = "chief";

/** What a Chief is called. */
export const CHIEF_NAME = "Chief";

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

/** Whose Chief the viewer has: its project; null for none; undefined while that is not known. */
export type OwnChief = string | null | undefined;

/**
 * The Chiefs the viewer sees nowhere: every project tagged a Chief's but their own, and every one
 * while whose is not known, so none is drawn and then taken back.
 */
export function othersChiefs(
  projects: Iterable<{ readonly id: string; readonly tagList?: ReadonlyArray<string> | undefined }>,
  own: OwnChief,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const project of projects)
    if (isChief(project) && project.id !== own) hidden.add(project.id);
  return hidden;
}

/** The viewer's own Chief among the listed projects: the menu's top row, as HQ names it. */
export function ownChiefAmong<T extends { readonly project: { readonly id: string } }>(
  candidates: ReadonlyArray<T>,
  own: OwnChief,
): T | undefined {
  if (own === null || own === undefined) return undefined;
  return candidates.find((candidate) => candidate.project.id === own);
}

/** The menu's list below its top row: every Mate but the viewer's own Chief, drawn once above. */
export function withoutOwnChief<T extends { readonly project: { readonly id: string } }>(
  candidates: ReadonlyArray<T>,
  own: OwnChief,
): ReadonlyArray<T> {
  if (own === null || own === undefined) return candidates;
  return candidates.filter((candidate) => candidate.project.id !== own);
}

/** The person a Chief is named after, as Zerops knows them. */
export interface ChiefPerson {
  readonly firstName?: string | undefined;
  readonly fullName?: string | undefined;
  readonly email?: string | undefined;
}

/**
 * A new Chief's names, as the new-project path takes them: its application "Chief · <first name>",
 * and its Mate "Chief".
 */
export function chiefNames(person: ChiefPerson | null): {
  readonly name: string;
  readonly botName: string;
} {
  const first =
    person?.firstName?.trim() ||
    person?.fullName?.trim().split(/\s+/u)[0] ||
    person?.email?.split("@")[0]?.trim() ||
    "";
  return { name: first === "" ? CHIEF_NAME : `${CHIEF_NAME} · ${first}`, botName: CHIEF_NAME };
}

/**
 * What the menu says of setting up a Chief beside the Overview row: an offer to a person with none
 * who may make its project, the setup while it runs or once it stopped, else nothing.
 */
export function chiefSetupLine(input: {
  readonly own: OwnChief;
  /** The person may make the project a Chief lives in (HQ's `create_app`). */
  readonly mayCreate: boolean;
  readonly setup: "idle" | "running" | "failed" | "done";
}): "offer" | "running" | "stopped" | null {
  if (input.setup === "running") return "running";
  if (input.setup === "failed") return "stopped";
  if (input.setup === "done" || input.own !== null || !input.mayCreate) return null;
  return "offer";
}
