/**
 * The Persona page's model: what it shows from the Mate's persona, the templates it can start from
 * and whether its server takes one, and the persona each of its writes sends.
 *
 * A template is copied with a reference `{source, id, revision}`; any edit drops the reference, so
 * a persona that still carries one is an unedited copy, and only such a copy is offered its
 * template's newer revision.
 */
import {
  MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH,
  MATE_PERSONA_NAME_MAX_LENGTH,
  type MatePersona,
  type MatePersonaTemplateRef,
} from "@t3tools/contracts";
import {
  ORG_PERSONA_TEMPLATES_MAX,
  type PersonaTemplate,
  type SavePersonaTemplate,
} from "@t3tools/shared/personaTemplates";

export type PersonaTemplateSource = MatePersonaTemplateRef["source"];

/** The organization's templates as the page reads them (`useOrgPersonaTemplates`). */
export interface OrgPersonaTemplatesInput {
  readonly state: "loading" | "ready" | "unavailable" | "failed";
  /** Why the read failed, said to the person; only with `failed`. */
  readonly cause?: string;
  readonly templates: readonly PersonaTemplate[];
  readonly orgName: string | null;
  /** Owner or Admin: may save the organization's templates. */
  readonly mayWrite: boolean;
}

export interface PersonaPageInput {
  readonly mate: string;
  /** The server's `matePersona` capability; `null` while its config is unread. */
  readonly capability: boolean | null;
  readonly settingsLoaded: boolean;
  readonly persona: MatePersona | null;
  readonly premade: readonly PersonaTemplate[];
  readonly org: OrgPersonaTemplatesInput;
}

export interface PersonaTemplateRow {
  readonly key: string;
  readonly source: PersonaTemplateSource;
  readonly template: PersonaTemplate;
  /**
   * The persona came from this template: `same` at this revision, so choosing it writes nothing
   * new; `older` at an earlier one. `null` for every other template.
   */
  readonly current: "same" | "older" | null;
}

export type PersonaGroupNote =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" | "unavailable" | "failed"; readonly text: string };

export interface PersonaTemplateGroup {
  readonly source: PersonaTemplateSource;
  readonly title: string;
  readonly rows: readonly PersonaTemplateRow[];
  readonly note: PersonaGroupNote | null;
}

export interface PersonaSummary {
  readonly name: string;
  readonly instructions: string;
  /** Where it came from: "From Zerops: Reviewer", "From Acme's templates", "Written for Nova". */
  readonly origin: string;
  /** Its template now has a higher revision: the copy it would take. */
  readonly newer: {
    readonly source: PersonaTemplateSource;
    readonly template: PersonaTemplate;
  } | null;
  /** Owners and Admins may keep it as one of the organization's templates. */
  readonly saveAsOrg: boolean;
}

export type PersonaPageModel =
  | { readonly kind: "loading" }
  | { readonly kind: "update" }
  | {
      readonly kind: "ready";
      readonly persona: PersonaSummary | null;
      readonly groups: readonly PersonaTemplateGroup[];
    };

export const PERSONA_WORDS = {
  ownWay: (mate: string) => `${mate} works and talks its own way.`,
  update: (mate: string) => `Update ${mate} to give it a persona.`,
  fromZerops: "From Zerops",
  fromZeropsTemplate: (name: string) => `From Zerops: ${name}`,
  orgTemplates: (org: string | null) =>
    org === null ? "Your organization's templates" : `${org}'s templates`,
  fromOrg: (org: string | null) =>
    org === null ? "From your organization's templates" : `From ${org}'s templates`,
  writtenFor: (mate: string) => `Written for ${mate}`,
  noTemplates: "No templates yet.",
  orgUnavailable: "Your organization's templates aren't available here.",
  orgFailed: (org: string | null, cause: string) =>
    `Couldn't read ${org === null ? "your organization's" : `${org}'s`} templates: ${cause}`,
  nameRequired: "Give it a name.",
  nameTooLong: `Keep the name to ${String(MATE_PERSONA_NAME_MAX_LENGTH)} characters.`,
  instructionsRequired: "Write how it works and talks.",
  instructionsTooLong: `Keep the instructions to ${MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH.toLocaleString("en-US")} characters.`,
} as const;

const sameRef = (
  ref: MatePersonaTemplateRef | undefined,
  source: PersonaTemplateSource,
  id: string,
) => ref !== undefined && ref.source === source && ref.id === id;

function orgNote(org: OrgPersonaTemplatesInput): PersonaGroupNote | null {
  switch (org.state) {
    case "loading":
      return { kind: "loading" };
    case "unavailable":
      return { kind: "unavailable", text: PERSONA_WORDS.orgUnavailable };
    case "failed":
      return { kind: "failed", text: PERSONA_WORDS.orgFailed(org.orgName, org.cause ?? "") };
    case "ready":
      return org.templates.length === 0 ? { kind: "empty", text: PERSONA_WORDS.noTemplates } : null;
  }
}

export function personaPage(input: PersonaPageInput): PersonaPageModel {
  if (input.capability === null) return { kind: "loading" };
  if (!input.capability) return { kind: "update" };
  if (!input.settingsLoaded) return { kind: "loading" };

  const { persona, org } = input;
  const ref = persona?.template;
  const orgTemplates = org.state === "ready" ? org.templates : [];
  const rowsOf = (source: PersonaTemplateSource, templates: readonly PersonaTemplate[]) =>
    templates.map((template): PersonaTemplateRow => ({
      key: `${source}:${template.id}`,
      source,
      template,
      current: !sameRef(ref, source, template.id)
        ? null
        : ref !== undefined && ref.revision >= template.revision
          ? "same"
          : "older",
    }));
  const groups: PersonaTemplateGroup[] = [
    {
      source: "premade",
      title: PERSONA_WORDS.fromZerops,
      rows: rowsOf("premade", input.premade),
      note: null,
    },
    {
      source: "org",
      title: PERSONA_WORDS.orgTemplates(org.orgName),
      rows: rowsOf("org", orgTemplates),
      note: orgNote(org),
    },
  ];

  if (persona === null) {
    return { kind: "ready", persona: null, groups };
  }

  const source = ref === undefined ? null : ref.source === "premade" ? input.premade : orgTemplates;
  const template =
    ref === undefined ? undefined : source?.find((candidate) => candidate.id === ref.id);
  const origin =
    ref === undefined
      ? PERSONA_WORDS.writtenFor(input.mate)
      : ref.source === "premade"
        ? PERSONA_WORDS.fromZeropsTemplate(template?.name ?? persona.name)
        : PERSONA_WORDS.fromOrg(org.orgName);
  const newer =
    ref !== undefined && template !== undefined && template.revision > ref.revision
      ? { source: ref.source, template }
      : null;
  const saveAsOrg =
    org.mayWrite &&
    org.state === "ready" &&
    org.templates.length < ORG_PERSONA_TEMPLATES_MAX &&
    ref?.source !== "org";

  return {
    kind: "ready",
    persona: { name: persona.name, instructions: persona.instructions, origin, newer, saveAsOrg },
    groups,
  };
}

/** Choosing a template copies its text, with the reference that offers its later revisions. */
export function personaFromTemplate(
  source: PersonaTemplateSource,
  template: PersonaTemplate,
): MatePersona {
  return {
    name: template.name,
    instructions: template.instructions,
    template: { source, id: template.id, revision: template.revision },
  };
}

export interface PersonaDraft {
  readonly name: string;
  readonly instructions: string;
}

export interface PersonaDraftErrors {
  readonly name?: string;
  readonly instructions?: string;
}

export type PersonaEditorResult =
  | { readonly ok: true; readonly persona: MatePersona }
  | { readonly ok: false; readonly errors: PersonaDraftErrors };

/** The editor's live count: what the server keeps, the trimmed text, in UTF-16 units. */
export const personaInstructionsCount = (instructions: string) => instructions.trim().length;

/**
 * What the editor saves over `previous`, the persona it opened on (`null` when written from
 * nothing). Unchanged text keeps the template reference; any change makes it the person's own.
 */
export function personaFromEditor(
  previous: MatePersona | null,
  draft: PersonaDraft,
): PersonaEditorResult {
  const name = draft.name.trim();
  const instructions = draft.instructions.trim();
  const errors: { name?: string; instructions?: string } = {};
  if (name === "") errors.name = PERSONA_WORDS.nameRequired;
  else if (name.length > MATE_PERSONA_NAME_MAX_LENGTH) errors.name = PERSONA_WORDS.nameTooLong;
  if (instructions === "") errors.instructions = PERSONA_WORDS.instructionsRequired;
  else if (instructions.length > MATE_PERSONA_INSTRUCTIONS_MAX_LENGTH)
    errors.instructions = PERSONA_WORDS.instructionsTooLong;
  if (errors.name !== undefined || errors.instructions !== undefined) return { ok: false, errors };

  const unchanged =
    previous !== null && previous.name === name && previous.instructions === instructions;
  return {
    ok: true,
    persona:
      unchanged && previous.template !== undefined
        ? { name, instructions, template: previous.template }
        : { name, instructions },
  };
}

/** The organization template a persona is saved as: a new one, with no description. */
export function orgTemplateFromPersona(persona: MatePersona): SavePersonaTemplate {
  return { name: persona.name, description: "", instructions: persona.instructions, revision: 0 };
}
