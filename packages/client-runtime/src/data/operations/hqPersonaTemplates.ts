/**
 * An organization's persona templates, which HQ owns: a save names its template by an id the
 * client made before sending, and the revision its writer saw; HQ refuses one written over a
 * revision it no longer holds (`revision_conflict`), and the person decides what happens next.
 *
 * @module data/operations/hqPersonaTemplates
 */
import type { PersonaTemplate } from "@t3tools/shared/personaTemplates";
import type { ProjectionReads } from "../store.ts";
import type { IntentOf, OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "save-persona-template": {
      readonly orgId: string;
      readonly templateId: string;
      /** The revision its writer saw; 0 for a new template. */
      readonly revision: number;
      readonly name: string;
      readonly description: string;
      readonly instructions: string;
    };
    readonly "delete-persona-template": {
      readonly orgId: string;
      readonly templateId: string;
      readonly revision: number;
    };
  }
}

/** HQ's refusal of a write over a revision it no longer holds. */
export const PERSONA_TEMPLATE_CONFLICT = "revision_conflict";

/**
 * The template as the organization's complete record holds it: `null` where the record proves it
 * absent, `undefined` while no record is known.
 */
export const personaTemplateIn = (
  read: ProjectionReads,
  orgId: string,
  templateId: string,
): PersonaTemplate | null | undefined => {
  const record = read.fact("hqPersonaTemplates", orgId);
  if (record.kind !== "known") return undefined;
  return record.value.templates.find((template) => template.id === templateId) ?? null;
};

/** The record holds the saved text at a revision past the one its writer saw. */
export const personaTemplateSaved = (
  read: ProjectionReads,
  intent: IntentOf<"save-persona-template">,
): boolean => {
  const template = personaTemplateIn(read, intent.orgId, intent.templateId);
  return (
    template != null &&
    template.revision > intent.revision &&
    template.name === intent.name &&
    template.description === intent.description &&
    template.instructions === intent.instructions
  );
};

/** The complete record holds no template of that id. */
export const personaTemplateGone = (
  read: ProjectionReads,
  intent: IntentOf<"delete-persona-template">,
): boolean => personaTemplateIn(read, intent.orgId, intent.templateId) === null;

export const savePersonaTemplate: OperationKind<"save-persona-template"> = {
  kind: "save-persona-template",
  executor: "hq",
  reflected: (read, intent) => personaTemplateSaved(read, intent),
  // HQ's answer ends it; an adopted one ends as the record it adopted shows.
  settledBy: (read, intent) => (personaTemplateSaved(read, intent) ? { kind: "succeeded" } : null),
  // A new template's id is this write's own, so the record showing it with this text is this
  // write. An edit's text another admin could have saved as well: its lost answer stays uncertain.
  effectHandles: (read, intent) => {
    if (
      intent.revision !== 0 ||
      personaTemplateIn(read, intent.orgId, intent.templateId) === undefined
    )
      return null;
    return personaTemplateSaved(read, intent) ? [intent.templateId] : [];
  },
};

export const deletePersonaTemplate: OperationKind<"delete-persona-template"> = {
  kind: "delete-persona-template",
  executor: "hq",
  reflected: (read, intent) => personaTemplateGone(read, intent),
};

export const PERSONA_TEMPLATE_KINDS = [savePersonaTemplate, deletePersonaTemplate] as const;
