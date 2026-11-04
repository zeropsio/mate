import { HqPersonaTemplates } from "@t3tools/shared/personaTemplates";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import type { ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqPersonaTemplates: HqPersonaTemplates;
  }
}
export const personaTemplatesScope = (orgId: string): ScopeKey => `hq:${orgId}:persona-templates`;
const decodeTemplates = Schema.decodeUnknownOption(HqPersonaTemplates);
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
    decode: (raw) => Option.getOrNull(decodeTemplates(raw)),
  },
};
