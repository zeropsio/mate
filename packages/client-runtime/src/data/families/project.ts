/**
 * Zerops projects: the organization's roster. Leaving the roster is unverified until the owner
 * says deleted (404) or not the viewer's (403).
 *
 * @module data/families/project
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { scopeOf, type FamilySpec } from "./spec.ts";

export interface ProjectValue {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly project: ProjectValue;
  }
}

const Row = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  _version: Schema.optionalKey(Schema.Number),
});
const decodeRow = Schema.decodeUnknownOption(Row);

export const projectFamily: FamilySpec<"project"> = {
  family: "project",
  authority: "zerops",
  scope: { source: "zerops", suffix: "projects", leaving: "absent-unverified" },
  zerops: {
    entity: "project",
    membership: (orgId) => [{ name: "clientId", operator: "eq", value: orgId }],
    updates: (orgId) => [{ name: "clientId", operator: "eq", value: orgId }],
    decode: (raw) =>
      Option.match(decodeRow(raw), {
        onNone: () => null,
        onSome: (row) => ({
          id: row.id,
          value: { id: row.id, name: row.name ?? "", status: row.status ?? "" },
          version: row._version ?? null,
        }),
      }),
    verifyPath: (id) => `/project/${encodeURIComponent(id)}`,
  },
};

export const projectsScope = (orgId: string) => scopeOf(projectFamily, orgId);
