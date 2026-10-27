/**
 * Every variable of a project's services, one fact per row (`POST /user-data/search` for the
 * project): observed only while a screen shows the project's vault, by one registration for that
 * project, whose frames list every row again after any service variable write (measured
 * 2026-10-07). A runtime service's own values are `USER` and editable; its deployed zerops.yml
 * `run.envVariables` are `USER` and not editable, their templates unresolved; the platform's are
 * `SYSTEM` (a database's credentials among them). A sensitive value's content is never kept.
 *
 * @module data/families/serviceVariables
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { keptRow, VariableFields, type VariableRow } from "./projectVariables.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** One service's variable row: whose it is, the rest as `VariableRow` says. */
export interface ServiceVariableValue extends Omit<VariableRow, "id"> {
  readonly serviceId: string;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly serviceVariable: ServiceVariableValue;
  }
}

/** A project's rows are read whole: past this a project's answer is cut (Rhea's held 242). */
const LIMIT = 2000;

const Row = Schema.Struct({
  ...VariableFields.fields,
  serviceStackId: Schema.NonEmptyString,
});
const decodeRow = Schema.decodeUnknownOption(Row);

export const serviceVariableFamily: FamilySpec<"serviceVariable"> = {
  family: "serviceVariable",
  authority: "zerops",
  scope: { source: "zerops", suffix: "variables", leaving: "removed", demand: "detail" },
  zeropsQuery: {
    path: "/user-data/search",
    body: ({ orgId, ownerId }) => ({
      search: [
        { name: "clientId", operator: "eq", value: orgId },
        { name: "projectId", operator: "eq", value: ownerId ?? "" },
      ],
      sort: [],
      limit: LIMIT,
    }),
    frames: "listing",
    decode: (raw) =>
      Option.match(decodeRow(raw), {
        onNone: () => null,
        onSome: (row) => {
          const { id, ...kept } = keptRow(row);
          return { id, version: null, value: { serviceId: row.serviceStackId, ...kept } };
        },
      }),
  },
};

/** One project's services' variables, observed while demanded; the owner is the project's id. */
export const serviceVariablesScope = (orgId: string, projectId: string): ScopeKey =>
  scopeOf(serviceVariableFamily, orgId, projectId);
