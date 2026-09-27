/**
 * The crew editors' adapter over the crew home format (`@t3tools/shared/crewHome`,
 * the one parser): a crewmate as the editor's form holds it and back, and a
 * definition with one crewmate or the brief changed. What the form does not
 * show — env, the shared database, migrations, context, rotation — is carried
 * over from the crewmate as it was, and dropped with its copy of the code when
 * it becomes read only.
 */
import type { MateTintId } from "@t3tools/shared/brand";
import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "@t3tools/shared/crewHome";

/** The login a crewmate runs on unless its *Runs on* names another (the Mate's default). */
const DEFAULT_LOGIN = "claudeAgent";

export interface CrewmateDraft {
  readonly displayName: string;
  readonly handle: string;
  readonly tint: MateTintId | undefined;
  readonly job: string;
  readonly login: string;
  /** `null`: the login's default. */
  readonly model: string | null;
  /** `null`: the model's default. */
  readonly effort: string | null;
  readonly readOnly: boolean;
  readonly host: string;
  readonly setup: string;
  readonly check: string;
  readonly run: string;
  readonly restartAfterMerge: boolean;
  readonly afterLandRestart: boolean;
}

export const emptyCrewmateDraft = (lead: boolean): CrewmateDraft => ({
  displayName: lead ? "Lead" : "",
  handle: lead ? "lead" : "",
  tint: undefined,
  job: "",
  login: DEFAULT_LOGIN,
  model: null,
  effort: null,
  readOnly: lead,
  host: "",
  setup: "",
  check: "",
  run: "",
  restartAfterMerge: false,
  afterLandRestart: false,
});

export const crewmateDraftOf = (member: CrewMemberSpec): CrewmateDraft => ({
  displayName: member.displayName,
  handle: member.handle,
  tint: member.tint,
  job: member.job,
  login: member.login ?? DEFAULT_LOGIN,
  model: member.model ?? null,
  effort: member.effort ?? null,
  readOnly: member.readOnly,
  host: member.host ?? "",
  setup: member.setup ?? "",
  check: member.check ?? "",
  run: member.run ?? "",
  restartAfterMerge: member.restartAfterMerge,
  afterLandRestart: member.afterLandRestart,
});

const optional = (value: string) => (value.trim() === "" ? undefined : value.trim());

/** The form back as a crewmate; `before` is the crewmate as it was, for what the form does not show. */
export function crewmateSpecOf(
  draft: CrewmateDraft,
  lead: boolean,
  before: CrewMemberSpec | undefined,
): CrewMemberSpec {
  const writes = !lead && !draft.readOnly;
  const host = writes ? optional(draft.host) : undefined;
  const setup = writes ? optional(draft.setup) : undefined;
  const check = writes ? optional(draft.check) : undefined;
  const run = writes ? optional(draft.run) : undefined;
  return {
    handle: draft.handle,
    displayName: draft.displayName.trim(),
    kind: lead ? "lead" : writes ? "writer" : "reader",
    readOnly: !writes,
    ...(draft.tint === undefined ? {} : { tint: draft.tint }),
    ...(host === undefined ? {} : { host }),
    ...(setup === undefined ? {} : { setup }),
    ...(check === undefined ? {} : { check }),
    ...(run === undefined ? {} : { run }),
    restartAfterMerge: writes && draft.restartAfterMerge,
    afterLandRestart: writes && draft.afterLandRestart,
    login: draft.login,
    ...(draft.model === null ? {} : { model: draft.model }),
    ...(draft.effort === null ? {} : { effort: draft.effort }),
    env: writes ? (before?.env ?? {}) : {},
    ...(writes && before?.database !== undefined ? { database: before.database } : {}),
    migrations: writes ? (before?.migrations ?? []) : [],
    ...(before?.context === undefined ? {} : { context: before.context }),
    ...(before?.rotateAfter === undefined ? {} : { rotateAfter: before.rotateAfter }),
    job: draft.job,
  };
}

/** The definition with one crewmate replaced (by its handle before the edit) or, for `null`, added. */
export function withMember(
  definition: CrewDefinition,
  handle: string | null,
  spec: CrewMemberSpec,
): CrewDefinition {
  return {
    ...definition,
    members:
      handle === null
        ? [...definition.members, spec]
        : definition.members.map((member) => (member.handle === handle ? spec : member)),
  };
}

export function withBrief(definition: CrewDefinition, title: string, text: string): CrewDefinition {
  return { ...definition, brief: parseBrief(title, text) };
}
