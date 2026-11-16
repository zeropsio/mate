/**
 * The Chief: a person's own Mate for the whole organization rather than one project, the way the
 * owner works with a coding agent that reaches every project. Its project carries
 * {@link CHIEF_TAG}, and HQ's person facts say whose it is (`chief`): the viewer's own is the
 * menu's top row, apart from the projects, once it exists or is being set up; before that the
 * account menu offers it, and its empty conversation asks about the organization.
 * Another person's Chief appears nowhere.
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

/** The viewer's Chief from HQ's current person facts; absence needs a complete answer. */
export function hqOwnChief(
  facts: Readonly<Record<string, { readonly chief?: string | undefined }>>,
  read: boolean,
): OwnChief {
  const mine = Object.entries(facts).find(([, fact]) => fact.chief === "mine")?.[0];
  return mine ?? (read ? null : undefined);
}

/** Navigation to setup is offered before creation; the destination owns its permission check. */
export function chiefSetupEntry(
  own: OwnChief,
  setup: "idle" | "running" | "failed" | "done",
): boolean {
  return own === null && setup === "idle";
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
 * Where setting up a Chief stands, for the menu's top row (`chiefRowLine`): an offer to a person with
 * none who may make its project, the setup while it runs or once it stopped — and, set up, still
 * running until HQ reports the Chief, so its row never leaves and comes back — else nothing.
 */
export function chiefSetupLine(input: {
  readonly own: OwnChief;
  /** The person may make the project a Chief lives in (HQ's `create_app`). */
  readonly mayCreate: boolean;
  readonly setup: "idle" | "running" | "failed" | "done";
}): "offer" | "running" | "stopped" | null {
  if (input.setup === "running") return "running";
  if (input.setup === "failed") return "stopped";
  if (input.setup === "done") return typeof input.own === "string" ? null : "running";
  if (input.own !== null || !input.mayCreate) return null;
  return "offer";
}
