/**
 * Zerops projects: the organization's roster, each project as the platform's whole row says it.
 * Leaving the roster is unverified until the owner says deleted (its not-found) or not the
 * viewer's (403): a project taken from the viewer leaves only through that membership delete.
 *
 * @module data/families/project
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ZeropsProject } from "../../zerops/api.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** A project as its row says it; where HQ places it is HQ's, never part of it. */
export type ProjectValue = Omit<ZeropsProject, "hq" | "hqTool">;

declare module "../model.ts" {
  interface FamilyValues {
    readonly project: ProjectValue;
  }
}

const Optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(Schema.Union([schema, Schema.Null]));

const Row = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  clientId: Optional(Schema.String),
  created: Optional(Schema.String),
  description: Optional(Schema.String),
  tagList: Optional(Schema.Array(Schema.String)),
  publicZone: Optional(Schema.String),
  zeropsSubdomainHost: Optional(Schema.String),
  mode: Optional(Schema.String),
  userRoles: Optional(
    Schema.Array(Schema.Struct({ clientUserId: Schema.String, roleCode: Schema.String })),
  ),
  publicIpV4Shared: Optional(Schema.Boolean),
  maxCreditLimit: Optional(Schema.Finite),
  _version: Optional(Schema.Finite),
});
const decodeRow = Schema.decodeUnknownOption(Row);

/** The row's fields, a `null` one left out as unsaid. */
function valueOf(row: typeof Row.Type): ProjectValue {
  const { _version: _ignored, ...fields } = row;
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null),
  ) as unknown as ProjectValue;
}

const organization = (orgId: string) => [{ name: "clientId", operator: "eq", value: orgId }];

export const projectFamily: FamilySpec<"project"> = {
  family: "project",
  authority: "zerops",
  scope: {
    source: "zerops",
    suffix: "projects",
    leaving: "absent-unverified",
    demand: "navigation",
  },
  zerops: {
    entity: "project",
    membership: ({ orgId }) => organization(orgId),
    updates: ({ orgId }) => organization(orgId),
    decode: (raw) =>
      Option.match(decodeRow(raw), {
        onNone: () => null,
        onSome: (row) => ({ id: row.id, value: valueOf(row), version: row._version ?? null }),
      }),
    verifyPath: (id) => `/project/${encodeURIComponent(id)}`,
    organizationOf: (answer) =>
      Option.match(decodeRow(answer), {
        onNone: () => null,
        onSome: (row) => row.clientId ?? null,
      }),
  },
};

export const projectsScope = (orgId: string): ScopeKey => scopeOf(projectFamily, orgId);
