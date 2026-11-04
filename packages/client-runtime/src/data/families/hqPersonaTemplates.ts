import { PersonaTemplate } from "@t3tools/shared/personaTemplates";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import type { ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

/**
 * The organization's templates as this version reads them. A template it cannot read is left out
 * and named by its id (`null` where it has none readable), so the others still show and no write
 * mistakes a template it could not read for one HQ does not hold; a record it cannot read at all
 * is `"record"`.
 */
export interface HqPersonaTemplatesRecord {
  readonly templates: ReadonlyArray<PersonaTemplate>;
  readonly unreadable: "record" | ReadonlyArray<string | null>;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqPersonaTemplates: HqPersonaTemplatesRecord;
  }
}
export const personaTemplatesScope = (orgId: string): ScopeKey => `hq:${orgId}:persona-templates`;
const decodeRecord = Schema.decodeUnknownOption(
  Schema.Struct({ orgId: Schema.String, templates: Schema.Array(Schema.Unknown) }),
);
const decodeTemplate = Schema.decodeUnknownOption(PersonaTemplate);
const decodeId = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String }));

const readRecord = (raw: unknown): HqPersonaTemplatesRecord => {
  const record = Option.getOrNull(decodeRecord(raw));
  if (record === null) return { templates: [], unreadable: "record" };
  const templates: PersonaTemplate[] = [];
  const unreadable: Array<string | null> = [];
  for (const entry of record.templates) {
    const template = Option.getOrNull(decodeTemplate(entry));
    if (template !== null) templates.push(template);
    else unreadable.push(Option.getOrNull(decodeId(entry))?.id ?? null);
  }
  return { templates, unreadable };
};

/**
 * The organization's persona templates, one whole record in its navigation. An HQ that predates
 * them sends no such key: its complete baseline without one is that HQ's answer.
 */
export const hqPersonaTemplatesFamily: FamilySpec<"hqPersonaTemplates"> = {
  family: "hqPersonaTemplates",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "persona-templates",
    leaving: "removed",
    demand: "navigation",
  },
  hq: {
    scope: "navigation",
    idOf: (key, { orgId }) => (key === "persona-templates" ? orgId : null),
    keyOf: () => "persona-templates",
    decode: readRecord,
  },
};
