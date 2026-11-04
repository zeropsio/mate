/**
 * The organization's persona templates, read from HQ (`persona-templates`).
 *
 * A stand-in: the org-data part replaces this file with the real hook, from HQ's navigation
 * record. Until then the organization's templates read as unavailable and nobody may write them.
 */
import type { PersonaTemplate, SavePersonaTemplate } from "@t3tools/shared/personaTemplates";

export interface OrgPersonaTemplates {
  readonly state: "loading" | "ready" | "unavailable";
  readonly templates: readonly PersonaTemplate[];
  readonly orgName: string | null;
  /** Owner or Admin: may save and delete the organization's templates. */
  readonly mayWrite: boolean;
}

const UNAVAILABLE: OrgPersonaTemplates = {
  state: "unavailable",
  templates: [],
  orgName: null,
  mayWrite: false,
};

export function useOrgPersonaTemplates(): OrgPersonaTemplates {
  return UNAVAILABLE;
}

export type OrgPersonaTemplateWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** Saves a template under `id`: `revision` 0 creates it. */
export function useSaveOrgPersonaTemplate(): (
  id: string,
  template: SavePersonaTemplate,
) => Promise<OrgPersonaTemplateWrite> {
  return async () => ({ ok: false, message: "Your organization's templates aren't available." });
}
