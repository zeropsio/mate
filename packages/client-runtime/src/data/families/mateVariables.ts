/**
 * A Mate's enable flag, read by key (`POST /user-data/search`) rather than its secrets.
 * One read per service a screen or flow asks about, sampled while demanded. Setup marker
 * evidence is owned by HQ navigation and is never sampled here.
 *
 * What a service runs needs none of these: it rides the service's own row
 * (`projections/serviceRuns`).
 *
 * @module data/families/mateVariables
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readsAsEnabled } from "../../zerops/api.ts";
import type { ScopeKey } from "../model.ts";
import { STREAM_POLICY } from "../streamMachine.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export const MATE_ENABLED = "ZCP_MATE_ENABLED";
const KEYS: ReadonlyArray<string> = [MATE_ENABLED];

/** One container's flag as its search answered: `null` where it has no row. */
export interface MateVariablesValue {
  readonly flag: boolean | "unknown" | null;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly mateVariables: MateVariablesValue;
  }
}

const Variable = Schema.Struct({
  key: Schema.String,
  content: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sensitive: Schema.optionalKey(Schema.Boolean),
});
const Answer = Schema.Struct({
  items: Schema.Array(Schema.Unknown),
  totalHits: Schema.optionalKey(Schema.Number),
});
const decodeAnswer = Schema.decodeUnknownOption(Answer);
const decodeVariable = Schema.decodeUnknownOption(Variable);

/**
 * A disclosed flag reads as zcp reads it. A hidden content value proves only the key's presence,
 * never whether the flag is enabled, even when our own writes always set it to `1`.
 */
const flagOn = (variable: typeof Variable.Type): boolean | "unknown" =>
  variable.content === "REDACTED" || (variable.sensitive === true && variable.content == null)
    ? "unknown"
    : typeof variable.content === "string" && readsAsEnabled(variable.content);

export const mateVariablesFamily: FamilySpec<"mateVariables"> = {
  family: "mateVariables",
  authority: "zerops",
  scope: { source: "zerops", suffix: "mate-variables", leaving: "removed", demand: "detail" },
  sampled: {
    path: () => "/user-data/search",
    search: ({ orgId, ownerId }) => ({
      search: [
        { name: "clientId", operator: "eq", value: orgId },
        { name: "serviceStackId", operator: "eq", value: ownerId },
        { name: "key", operator: "in", value: KEYS },
      ],
      sort: [],
      limit: KEYS.length,
    }),
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        onSome: ({ items, totalHits }) => {
          if (totalHits !== undefined && totalHits > items.length) return null;
          let flag: MateVariablesValue["flag"] = null;
          const seen = new Set<string>();
          for (const raw of items) {
            const variable = Option.getOrUndefined(decodeVariable(raw));
            if (variable === undefined) return null;
            if (!KEYS.includes(variable.key)) continue;
            if (seen.has(variable.key)) return null;
            seen.add(variable.key);
            if (variable.key === MATE_ENABLED) {
              if (variable.content === undefined && variable.sensitive !== true) return null;
              flag = flagOn(variable);
            }
          }
          return { flag };
        },
      }),
    freshMs: STREAM_POLICY.sampledIntervalMs,
  },
};

export const mateVariablesScope = (orgId: string, serviceId: string): ScopeKey =>
  scopeOf(mateVariablesFamily, orgId, serviceId);
