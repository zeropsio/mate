/**
 * The Chief: the organization's Mate for the whole organization rather than one project, the way
 * the owner works with a coding agent that reaches every project. An Owner or Admin marks its
 * project as the organization's Chief in HQ (`PUT /api/chief`), and HQ names it `chief: "org"` to
 * every reader whose navigation holds it: the menu's top row, apart from the projects, once it
 * exists or is being set up; before that the account menu offers it (`chiefOffered`), and its empty
 * conversation asks about the organization. A project tagged {@link CHIEF_TAG} the mark does not
 * name appears nowhere.
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

/** The organization's Chief as the viewer sees it: its project; null for none; undefined while that is not known. */
export type OrgChief = string | null | undefined;

/** The organization's Chief from HQ's current person facts; absence needs a complete answer. */
export function hqOrgChief(
  facts: Readonly<Record<string, { readonly chief?: string | undefined }>>,
  read: boolean,
): OrgChief {
  const marked = Object.entries(facts).find(([, fact]) => fact.chief === "org")?.[0];
  return marked ?? (read ? null : undefined);
}

/**
 * Whether the account menu offers *Set up Chief*: a Chief is optional, offered once and quietly,
 * only to a person who may set one up and has none (`entry`, `chiefSetupEntry` and their role),
 * and only once it is useful — the organization holds a second project (an HQ app) besides any
 * person's Chief. Nothing while the projects are not read (`apps` undefined).
 */
export function chiefOffered(input: {
  readonly entry: boolean;
  readonly apps:
    | ReadonlyArray<{ readonly projects: ReadonlyArray<{ readonly projectId: string }> }>
    | undefined;
  /** Every project tagged a Chief's (`othersChiefs`): never counted as a project. */
  readonly chiefs: ReadonlySet<string>;
}): boolean {
  if (!input.entry || input.apps === undefined) return false;
  const projects = input.apps.filter((app) =>
    app.projects.some(({ projectId }) => !input.chiefs.has(projectId)),
  );
  return projects.length >= 2;
}

/** Navigation to setup is offered before creation; the destination owns its permission check. */
export function chiefSetupEntry(
  own: OrgChief,
  setup: "idle" | "running" | "failed" | "done",
): boolean {
  return own === null && setup === "idle";
}

/**
 * The Chiefs the viewer sees nowhere: every project tagged a Chief's but their own, and every one
 * while whose is not known, so none is drawn and then taken back.
 */
export function othersChiefs(
  projects: Iterable<{ readonly id: string; readonly tagList?: ReadonlyArray<string> | undefined }>,
  own: OrgChief,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const project of projects)
    if (isChief(project) && project.id !== own) hidden.add(project.id);
  return hidden;
}

/** The viewer's own Chief among the listed projects: the menu's top row, as HQ names it. */
export function chiefAmong<T extends { readonly project: { readonly id: string } }>(
  candidates: ReadonlyArray<T>,
  own: OrgChief,
): T | undefined {
  if (own === null || own === undefined) return undefined;
  return candidates.find((candidate) => candidate.project.id === own);
}

/** The menu's list below its top row: every Mate but the viewer's own Chief, drawn once above. */
export function withoutChief<T extends { readonly project: { readonly id: string } }>(
  candidates: ReadonlyArray<T>,
  own: OrgChief,
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
  readonly own: OrgChief;
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
