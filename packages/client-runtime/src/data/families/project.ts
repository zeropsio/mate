/**
 * Zerops projects: the organization's roster, each project as the platform's whole row says it.
 * Leaving the roster is unverified until the owner says deleted (its not-found) or not the
 * viewer's (403): a project taken from the viewer leaves only through that membership delete.
 *
 * A listing row names at most the viewer's own grant on the project (`{mine, roleCode}`, a
 * NO_ACCESS member's) or none at all (`[]`, an organization member's; read 2026-10-06): everybody's
 * grants — whose `OWNER` makes a Mate somebody's — come only with the project's own row, read
 * while a screen shows it. A list a row does not carry is unsaid, so a push or a listing never
 * takes the grants an own read brought — nor does the roster read again from its start.
 *
 * @module data/families/project
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ZeropsProject } from "../../zerops/api.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/**
 * A project as its row says it; where HQ places it is HQ's, never part of it. `viewerRoleCode` is
 * the viewer's own grant a listing row names without saying whose grants it lists.
 */
export type ProjectValue = Omit<ZeropsProject, "hq" | "hqTool"> & {
  readonly lastUpdate?: string;
  readonly viewerRoleCode?: string;
};

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
    Schema.Array(
      Schema.Struct({
        clientUserId: Schema.optionalKey(Schema.String),
        mine: Schema.optionalKey(Schema.Boolean),
        roleCode: Schema.String,
      }),
    ),
  ),
  lastUpdate: Optional(Schema.String),
  publicIpV4Shared: Optional(Schema.Boolean),
  maxCreditLimit: Optional(Schema.Finite),
  _version: Optional(Schema.Finite),
});
const decodeRow = Schema.decodeUnknownOption(Row);

/**
 * The row's fields, a `null` one left out as unsaid; of its grants, everybody's where it names
 * them, else the viewer's own one as `viewerRoleCode`.
 */
function valueOf(row: typeof Row.Type): ProjectValue {
  const { _version: _ignored, userRoles, ...fields } = row;
  const everybody = (userRoles ?? []).flatMap(({ clientUserId, roleCode }) =>
    clientUserId === undefined ? [] : [{ clientUserId, roleCode }],
  );
  const own = (userRoles ?? []).find(({ mine }) => mine === true);
  return {
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)),
    ...(everybody.length > 0 ? { userRoles: everybody } : {}),
    ...(own === undefined || everybody.length > 0 ? {} : { viewerRoleCode: own.roleCode }),
  } as unknown as ProjectValue;
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
  merge: (held, pushed) => ({ ...held, ...pushed }),
  // A row naming no list of grants keeps the one held, and one naming no grant at all keeps the
  // viewer's own one held beside it: whichever a row names is the newest word on it.
  keepUnsaid: (held, row) => {
    const { userRoles, viewerRoleCode } = held;
    if (row.userRoles !== undefined) return row;
    const named = row.viewerRoleCode !== undefined;
    return {
      ...row,
      ...(userRoles === undefined ? {} : { userRoles }),
      ...(named || viewerRoleCode === undefined ? {} : { viewerRoleCode }),
    };
  },
  // A row read by its id carries no `_version`: Zerops' own `lastUpdate` orders it. One as current
  // as the row held is taken: a change of grants alone leaves `lastUpdate` as it was.
  readIsNewer: (held, read) =>
    read.lastUpdate !== undefined &&
    (held.lastUpdate === undefined || Date.parse(read.lastUpdate) >= Date.parse(held.lastUpdate)),
  details: [
    {
      // One project's own row, read while a screen shows whose it is: everybody's grants.
      suffix: "project",
      leaving: "absent-unverified",
      member: true,
      zerops: {
        path: ({ ownerId }) => `/project/${encodeURIComponent(ownerId ?? "")}`,
        items: (answer) =>
          typeof answer === "object" && answer !== null && "id" in answer ? [answer] : undefined,
      },
    },
  ],
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
