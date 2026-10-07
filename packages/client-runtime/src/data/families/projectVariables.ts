/**
 * A project's own variables — the vault's Shared scope — as its row in `POST /project/search`
 * carries them (`envList`; `GET /project/{id}` carries none): observed only while a screen shows the
 * project's vault, by one registration for that project, whose frames list the project again after
 * any variable write (measured 2026-10-07). A sensitive value's content is never kept: Zerops
 * answers `REDACTED` for it, even to its owner.
 *
 * @module data/families/projectVariables
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** One variable row as the vault keeps it: never a sensitive one's content. */
export interface VariableRow {
  readonly id: string;
  readonly key: string;
  /** `USER`, the person's; `SYSTEM`, the platform's. */
  readonly type: string;
  readonly editable: boolean;
  readonly sensitive: boolean;
  /** The plain content; `null` for a sensitive one. */
  readonly value: string | null;
  readonly created: string | null;
  readonly lastUpdate: string | null;
}

export interface ProjectVariablesValue {
  readonly rows: ReadonlyArray<VariableRow>;
  /** Whether every row was readable: a damaged one is left out, and its absence proves nothing. */
  readonly complete: boolean;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly projectVariables: ProjectVariablesValue;
  }
}

const Time = Schema.optional(Schema.NullOr(Schema.String));
/** The fields of a variable row both searches answer with. */
export const VariableFields = Schema.Struct({
  id: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
  content: Schema.optionalKey(Schema.NullOr(Schema.String)),
  type: Schema.String,
  editable: Schema.optionalKey(Schema.Boolean),
  sensitive: Schema.optionalKey(Schema.Boolean),
  created: Time,
  lastUpdate: Time,
});

/** A variable row as kept: a sensitive one's content (`REDACTED`, or anything) is dropped. */
export const keptRow = (row: typeof VariableFields.Type): VariableRow => {
  const sensitive = row.sensitive === true;
  return {
    id: row.id,
    key: row.key,
    type: row.type,
    editable: row.editable === true,
    sensitive,
    value: sensitive ? null : (row.content ?? null),
    created: row.created ?? null,
    lastUpdate: row.lastUpdate ?? null,
  };
};

const ProjectRow = Schema.Struct({
  id: Schema.NonEmptyString,
  envList: Schema.Array(Schema.Unknown),
});
const decodeProject = Schema.decodeUnknownOption(ProjectRow);
const decodeVariable = Schema.decodeUnknownOption(VariableFields);

export const projectVariablesFamily: FamilySpec<"projectVariables"> = {
  family: "projectVariables",
  authority: "zerops",
  scope: { source: "zerops", suffix: "project-variables", leaving: "removed", demand: "detail" },
  zeropsQuery: {
    path: "/project/search",
    body: ({ orgId, ownerId }) => ({
      search: [
        { name: "clientId", operator: "eq", value: orgId },
        { name: "id", operator: "eq", value: ownerId ?? "" },
      ],
      sort: [],
      limit: 1,
    }),
    frames: "listing",
    decode: (raw) =>
      Option.match(decodeProject(raw), {
        onNone: () => null,
        onSome: (project) => {
          // A damaged row is refused alone: its neighbours are kept, the answer incomplete.
          const rows = project.envList.flatMap((raw) =>
            Option.match(decodeVariable(raw), {
              onNone: () => [],
              onSome: (row) => [keptRow(row)],
            }),
          );
          return {
            id: project.id,
            version: null,
            value: { rows, complete: rows.length === project.envList.length },
          };
        },
      }),
  },
};

/** One project's Shared variables, observed while demanded; the owner is the project's id. */
export const projectVariablesScope = (orgId: string, projectId: string): ScopeKey =>
  scopeOf(projectVariablesFamily, orgId, projectId);
