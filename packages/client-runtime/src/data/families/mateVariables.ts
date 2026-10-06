/**
 * The two variables only a Mate's container carries, read by key (`POST /user-data/search`) —
 * never a service's whole set, which carries every secret it holds: `ZCP_MATE_ENABLED`, whether
 * zcp serves Zerops Mate on it, and the press's marker `MATE_SETUP_RUNTIMES`, whose presence alone
 * is kept (its value, the tier's import document, is not). One read per service a screen or a flow
 * asks about, sampled while it stays asked; nothing the platform pushes of them is relied on.
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
export const SETUP_MARKER = "MATE_SETUP_RUNTIMES";
const KEYS: ReadonlyArray<string> = [MATE_ENABLED, SETUP_MARKER];

/** One container's two variables as its search answered: the flag `null` where it has no row. */
export interface MateVariablesValue {
  readonly flag: boolean | null;
  readonly marker: boolean;
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
const Answer = Schema.Struct({ items: Schema.optionalKey(Schema.Array(Schema.Unknown)) });
const decodeAnswer = Schema.decodeUnknownOption(Answer);
const decodeVariable = Schema.decodeUnknownOption(Variable);

/**
 * The flag reads as on as zcp reads it. One written sensitive answers `REDACTED` to every reader,
 * and both its writers — the press's import and *Enable Zerops Mate* — write it only as `1`:
 * present, it is on.
 */
const flagOn = (variable: typeof Variable.Type): boolean =>
  variable.sensitive === true || variable.content === "REDACTED"
    ? true
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
        onSome: ({ items }) => {
          let flag: boolean | null = null;
          let marker = false;
          for (const raw of items ?? []) {
            const variable = Option.getOrUndefined(decodeVariable(raw));
            if (variable?.key === MATE_ENABLED) flag = flagOn(variable);
            if (variable?.key === SETUP_MARKER) marker = true;
          }
          return { flag, marker };
        },
      }),
    freshMs: STREAM_POLICY.sampledIntervalMs,
  },
};

export const mateVariablesScope = (orgId: string, serviceId: string): ScopeKey =>
  scopeOf(mateVariablesFamily, orgId, serviceId);
