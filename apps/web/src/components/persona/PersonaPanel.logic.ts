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
  type PremadePersonaTemplate,
} from "@t3tools/shared/personaTemplates";

import type { PersonaTemplateDraft } from "~/zerops/usePersonaTemplates";

export type PersonaTemplateSource = MatePersonaTemplateRef["source"];

/** The organization's templates as the page reads them (`useOrgPersonaTemplates`). */
export interface OrgPersonaTemplatesInput {
  readonly state: "loading" | "ready" | "unavailable" | "failed";
  /** Why the read failed, or why the list shown may be out of date; `null` while it holds. */
  readonly failure: string | null;
  readonly templates: readonly PersonaTemplate[];
  readonly orgName: string | null;
  /** Owner or Admin: may save the organization's templates. */
  readonly mayWrite: boolean;
}

/** The Mate's name; `null` while the directory has not named it, said as "this Mate". */
export type MateName = string | null;
/** The Mate inside a sentence. */
export const mateIn = (mate: MateName) => mate ?? "this Mate";
/** The Mate starting one. */
export const mateLeads = (mate: MateName) => mate ?? "This Mate";

export interface PersonaPageInput {
  readonly mate: MateName;
  /** The server's `matePersona` capability; `null` while its config is unread. */
  readonly capability: boolean | null;
  readonly settingsLoaded: boolean;
  readonly persona: MatePersona | null;
  readonly premade: readonly PremadePersonaTemplate[];
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
  | { readonly kind: "empty" | "unavailable" | "failed" | "stale"; readonly text: string };

export interface PersonaTemplateGroup {
  /** `you` and `work` split Zerops's templates; `org` holds the organization's. */
  readonly key: "you" | "work" | "org";
  readonly source: PersonaTemplateSource;
  readonly title: string;
  readonly rows: readonly PersonaTemplateRow[];
  readonly note: PersonaGroupNote | null;
}

export interface PersonaSummary {
  readonly name: string;
  readonly instructions: string;
  /**
   * Where it came from: "From Zerops" ("From Zerops: Reviewer" once the template is named otherwise),
   * "From Acme's templates", "Written for Nova".
   */
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
  /** Its server takes no persona: the line says so and the page offers the Mate's update. */
  | { readonly kind: "update"; readonly line: string; readonly action: "update-mate" }
  | {
      readonly kind: "ready";
      readonly persona: PersonaSummary | null;
      readonly groups: readonly PersonaTemplateGroup[];
    };

export const PERSONA_WORDS = {
  ownWay: (mate: MateName) => `${mateLeads(mate)} works and talks its own way.`,
  update: (mate: MateName) => `Update ${mateIn(mate)} to give it a persona.`,
  fromZerops: "From Zerops",
  aboutYou: "How it works with you",
  aboutWork: "What it focuses on",
  fromZeropsTemplate: (name: string) => `From Zerops: ${name}`,
  orgTemplates: (org: string | null) =>
    org === null ? "Your organization's templates" : `${org}'s templates`,
  fromOrg: (org: string | null) =>
    org === null ? "From your organization's templates" : `From ${org}'s templates`,
  writtenFor: (mate: MateName) => `Written for ${mateIn(mate)}`,
  useFor: (mate: MateName) => `Use for ${mateIn(mate)}`,
  save: "Save",
  noTemplates: "No templates yet",
  orgUnavailable: "Not available here.",
  orgStale: (failure: string) => `This list may be out of date: ${failure}`,
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
      return {
        kind: "failed",
        text: PERSONA_WORDS.orgFailed(org.orgName, org.failure ?? "HQ did not answer."),
      };
    case "ready":
      if (org.failure !== null) return { kind: "stale", text: PERSONA_WORDS.orgStale(org.failure) };
      return org.templates.length === 0 ? { kind: "empty", text: PERSONA_WORDS.noTemplates } : null;
  }
}

/**
 * The templates a persona can start from, as the page and the add-Mate dialog list them: Zerops's
 * by what they shape, then the organization's. `ref` marks the template the persona came from.
 */
export function personaTemplateGroups(
  premade: readonly PremadePersonaTemplate[],
  org: OrgPersonaTemplatesInput,
  ref?: MatePersonaTemplateRef,
): PersonaTemplateGroup[] {
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
  const premadeAbout = (about: "you" | "work", title: string): PersonaTemplateGroup => ({
    key: about,
    source: "premade",
    title,
    rows: rowsOf(
      "premade",
      premade.filter((template) => template.about === about),
    ),
    note: null,
  });
  return [
    premadeAbout("you", PERSONA_WORDS.aboutYou),
    premadeAbout("work", PERSONA_WORDS.aboutWork),
    {
      key: "org",
      source: "org",
      title: PERSONA_WORDS.orgTemplates(org.orgName),
      rows: rowsOf("org", org.state === "ready" ? org.templates : []),
      note: orgNote(org),
    },
  ];
}

export function personaPage(input: PersonaPageInput): PersonaPageModel {
  if (input.capability === null) return { kind: "loading" };
  if (!input.capability)
    return { kind: "update", line: PERSONA_WORDS.update(input.mate), action: "update-mate" };
  if (!input.settingsLoaded) return { kind: "loading" };

  const { persona, org } = input;
  const ref = persona?.template;
  const orgTemplates = org.state === "ready" ? org.templates : [];
  const groups = personaTemplateGroups(input.premade, org, ref);

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
        ? template === undefined || template.name === persona.name
          ? PERSONA_WORDS.fromZerops
          : PERSONA_WORDS.fromZeropsTemplate(template.name)
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

/** What the editor opens on: the persona itself, a template, its template's newer version, nothing. */
export type PersonaEditorStart =
  | { readonly kind: "edit" }
  | { readonly kind: "template"; readonly row: PersonaTemplateRow }
  | { readonly kind: "newer" }
  | { readonly kind: "blank" };

export interface PersonaEditorOpening {
  /** What saving the text unchanged writes: the persona, a template's copy; `null` from nothing. */
  readonly base: MatePersona | null;
  readonly draft: PersonaDraft;
  /** The save's label: the persona's own text saves; anything else is used for the Mate. */
  readonly save: string;
}

/**
 * The editor every persona passes through before the Mate takes it, so a template can be changed
 * before it is used. `null` for an edit or a newer version while the Mate has no persona.
 */
export function personaEditorOpening(
  start: PersonaEditorStart,
  input: {
    readonly mate: MateName;
    readonly persona: MatePersona | null;
    readonly page: Extract<PersonaPageModel, { kind: "ready" }>;
  },
): PersonaEditorOpening | null {
  const use = PERSONA_WORDS.useFor(input.mate);
  const copy = (base: MatePersona, save: string): PersonaEditorOpening => ({
    base,
    draft: { name: base.name, instructions: base.instructions },
    save,
  });
  switch (start.kind) {
    case "blank":
      return { base: null, draft: { name: "", instructions: "" }, save: use };
    case "template":
      return copy(
        personaFromTemplate(start.row.source, start.row.template),
        start.row.current === "same" ? PERSONA_WORDS.save : use,
      );
    case "edit":
      return input.persona === null ? null : copy(input.persona, PERSONA_WORDS.save);
    case "newer": {
      const newer = input.page.persona?.newer;
      return input.persona === null || newer === undefined || newer === null
        ? null
        : copy(personaFromTemplate(newer.source, newer.template), use);
    }
  }
}

/** The draft no longer matches the template it opened on: saving it makes it the Mate's own. */
export function personaLeavesTemplate(base: MatePersona | null, draft: PersonaDraft): boolean {
  return (
    base?.template !== undefined &&
    (draft.name.trim() !== base.name || draft.instructions.trim() !== base.instructions)
  );
}

/**
 * The organization template a persona is saved as: a new one, with no description. Its id is made
 * here, so the Mate can be tied to the template once the organization's list shows it.
 */
export function orgTemplateDraft(persona: MatePersona, templateId: string): PersonaTemplateDraft {
  return {
    templateId,
    revision: 0,
    name: persona.name,
    description: "",
    instructions: persona.instructions,
  };
}

/** A save of the persona as the organization's template, from the moment it was sent. */
export interface SavingTemplate {
  /** The template's id, made by the page. */
  readonly id: string;
  /** The persona as it was saved. */
  readonly persona: MatePersona;
  /** The revision HQ gives what this save created. */
  readonly revision: number;
  /** How many writes the page had sent to the Mate's persona when the save began. */
  readonly writesAtStart: number;
}

export type SavedTemplateLink =
  | { readonly kind: "wait" }
  | { readonly kind: "link"; readonly persona: MatePersona }
  | { readonly kind: "abandon" };

/**
 * Whether the Mate takes the template its persona was just saved as. It waits until the
 * organization's list shows that template, then takes it at the revision it saved, so it later
 * offers the newer ones; it never does once the person chose anything else on the page since the
 * save began (even before the Mate shows that choice), or once the persona shown differs.
 */
export function savedTemplateLink(
  saving: SavingTemplate,
  templates: readonly PersonaTemplate[],
  current: MatePersona | null,
  writes: number,
): SavedTemplateLink {
  if (writes !== saving.writesAtStart) return { kind: "abandon" };
  if (
    current === null ||
    current.name !== saving.persona.name ||
    current.instructions !== saving.persona.instructions
  )
    return { kind: "abandon" };
  if (!templates.some((candidate) => candidate.id === saving.id)) return { kind: "wait" };
  return {
    kind: "link",
    persona: {
      name: saving.persona.name,
      instructions: saving.persona.instructions,
      template: { source: "org", id: saving.id, revision: saving.revision },
    },
  };
}

/** Whether the Mate shows the persona a write sent: the write is done only once it does. */
export function samePersona(written: MatePersona | null, shown: MatePersona | null): boolean {
  if (written === null || shown === null) return written === shown;
  const a = written.template;
  const b = shown.template;
  return (
    written.name === shown.name &&
    written.instructions === shown.instructions &&
    (a === undefined || b === undefined
      ? a === b
      : a.source === b.source && a.id === b.id && a.revision === b.revision)
  );
}
