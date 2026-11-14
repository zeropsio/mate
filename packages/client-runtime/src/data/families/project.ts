/**
 * Zerops projects: the organization's roster, each project as the platform's whole row says it.
 * Leaving the roster is unverified until the owner says deleted (its not-found) or not the
 * viewer's (403): a project taken from the viewer leaves only through that membership delete.
 *
 * A listing row names at most the viewer's own grant on the project (`{mine, roleCode}`, a
 * NO_ACCESS member's) or none at all (`[]`, an organization member's; read 2026-10-06): everybody's
 * grants — whose `OWNER` makes a Mate somebody's — come only with the project's own row, read
 * while a screen shows it, and that row is Zerops' whole word on them (none named is none). So is
 * an update frame's list: a push that names it, empty or not, is the project's whole override
 * list. A listing's empty list is unsaid, so a listing or the roster read again never takes the
 * grants an own read brought, nor the viewer's own grant a listing named.
 *
 * @module data/families/project
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ZeropsProject } from "../../zerops/api.ts";
import type { ScopeKey } from "../model.ts";
import { viewerMembershipChanged } from "./clientUser.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/**
 * A project as its row says it; where HQ places it is HQ's, never part of it. `viewerRoleCode` is
 * the viewer's own grant a listing row names without saying whose grants it lists.
 */
export type ProjectValue = Omit<ZeropsProject, "hq"> & {
  readonly lastUpdate?: string;
  readonly viewerRoleCode?: string;
  /** Whether the listing named grants; own-row answers never change this demand input. */
  readonly listingNamesGrants?: boolean;
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
  publicIpV4: Optional(Schema.String),
  publicIpV6: Optional(Schema.String),
  maxCreditLimit: Optional(Schema.Finite),
  _version: Optional(Schema.Finite),
});
const decodeRow = Schema.decodeUnknownOption(Row);

/** Fields whose `null` says the project holds none: an own IPv4 goes when its add-on ends. */
const SAID_NONE: ReadonlySet<string> = new Set(["publicIpV4"]);

/**
 * The row's fields, a `null` one left out as unsaid (but `SAID_NONE`'s); of its grants,
 * everybody's where it names them, else the viewer's own one as `viewerRoleCode`.
 */
function valueOf(row: typeof Row.Type): ProjectValue {
  const { _version: _ignored, userRoles, ...fields } = row;
  const everybody = (userRoles ?? []).flatMap(({ clientUserId, roleCode }) =>
    clientUserId === undefined ? [] : [{ clientUserId, roleCode }],
  );
  const own = (userRoles ?? []).find(({ mine }) => mine === true);
  return {
    ...Object.fromEntries(
      Object.entries(fields).filter(([key, value]) => value !== null || SAID_NONE.has(key)),
    ),
    ...(userRoles === undefined ||
    userRoles === null ||
    (own !== undefined && everybody.length === 0)
      ? {}
      : { userRoles: everybody }),
    ...(own === undefined || everybody.length > 0 ? {} : { viewerRoleCode: own.roleCode }),
  } as unknown as ProjectValue;
}

const organization = (orgId: string) => [{ name: "clientId", operator: "eq", value: orgId }];

/** The route's project read ahead of the roster (`routeProjectScope`). */
export const ROUTE_PROJECT = "route-project";

export const projectFamily: FamilySpec<"project"> = {
  family: "project",
  labelOf: (project) => project.name,
  authority: "zerops",
  scope: {
    source: "zerops",
    suffix: "projects",
    leaving: "absent-unverified",
    demand: "navigation",
  },
  // A push names the fields it changed; the grants it names are `keepUnsaid`'s to settle.
  merge: (held, pushed) => {
    const { userRoles: _everybody, viewerRoleCode: _own, ...rest } = held;
    return { ...rest, ...pushed };
  },
  keepUnsaid: (held, row, from) => {
    const { userRoles, viewerRoleCode, listingNamesGrants: _listed, ...fields } = row;
    // The own row is Zerops' whole word on everybody's grants: none named takes them away, and the
    // viewer's own grant a listing named is retired by it.
    if (from === "own")
      return {
        ...fields,
        listingNamesGrants: held?.listingNamesGrants ?? false,
        ...(userRoles === undefined ? {} : { userRoles }),
        ...(viewerRoleCode === undefined ? {} : { viewerRoleCode }),
      };
    // An update frame's list is the project's whole override list (ZEROPS-069/071): an empty one
    // takes every override away, the viewer's own among them. A listing's empty list is unsaid:
    // the list held stays, and so does the viewer's own grant — only the account's membership says
    // the viewer is an organization member (the grant's judgement), never a row. A row without the
    // field says nothing either way.
    const whole = from === "push" && userRoles !== undefined;
    const everybody =
      whole || (userRoles !== undefined && userRoles.length > 0) ? userRoles : held?.userRoles;
    const kept = whole ? viewerRoleCode : (viewerRoleCode ?? held?.viewerRoleCode);
    return {
      ...fields,
      listingNamesGrants:
        viewerRoleCode !== undefined || (userRoles !== undefined && userRoles.length > 0)
          ? true
          : userRoles !== undefined
            ? false
            : (held?.listingNamesGrants ?? false),
      ...(everybody === undefined ? {} : { userRoles: everybody }),
      ...(kept === undefined ? {} : { viewerRoleCode: kept }),
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
    {
      // The route's project, read ahead of the roster (`DetailListing.ahead`): what its Mate's
      // target needs — its status and organization — while the platform's socket logs in.
      suffix: ROUTE_PROJECT,
      leaving: "absent-unverified",
      ahead: true,
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
    // A promotion from NO_ACCESS lists no project to the person (ZEROPS-073): any frame of their
    // own membership reads the roster again.
    refreshOn: ({ orgId }, row, previous) => viewerMembershipChanged(orgId, row, previous),
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

/** The route's project, read ahead of the organization's roster. */
export const routeProjectScope = (orgId: string, projectId: string): ScopeKey =>
  `zerops:${orgId}:${ROUTE_PROJECT}:${projectId}`;
