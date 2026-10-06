/**
 * Zerops services: every service of the organization, each as the platform's rows say it,
 * observed by one registration pair for the whole organization — never one read per project. A
 * push folds into the row held (`merge`): the recorded update frames carry a service's identity and
 * status alone. A service that leaves the organization's listing stays one of its project's until
 * its owner says it is gone (its not-found) or not the viewer's (403): one listing that omits it
 * deletes nothing.
 *
 * @module data/families/service
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ZeropsService } from "../../zerops/api.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/**
 * A service as its row says it, with the project it belongs to. A field the row states as `null`
 * is kept: a service whose active version is `null` runs nothing, which is not unsaid.
 */
export interface ServiceValue extends ZeropsService {
  readonly projectId: string;
  readonly clientId?: string;
  /** The service's variables, where the row carries them. */
  readonly userData?: ReadonlyArray<{ readonly key?: string; readonly content?: string | null }>;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly service: ServiceValue;
  }
}

/** The fields a service is known by; the rest of its row is carried as the platform sent it. */
const Row = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  status: Schema.String,
  _version: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null])),
});
const decodeRow = Schema.decodeUnknownOption(Row);

/** The row's fields, as it states them. */
function valueOf(raw: Readonly<Record<string, unknown>>): ServiceValue {
  const { _version: _ignored, ...fields } = raw;
  return fields as unknown as ServiceValue;
}

const organization = (orgId: string) => [{ name: "clientId", operator: "eq", value: orgId }];

const ClientRow = Schema.Struct({ clientId: Schema.optionalKey(Schema.NullOr(Schema.String)) });
const decodeClient = Schema.decodeUnknownOption(ClientRow);

export const serviceFamily: FamilySpec<"service"> = {
  family: "service",
  authority: "zerops",
  scope: {
    source: "zerops",
    suffix: "services",
    leaving: "absent-unverified",
    demand: "navigation",
  },
  indexes: [
    /** The services each project has: one its owner proved deleted is dropped with its fact. */
    { name: "serviceProject", keyOf: (value) => value.projectId },
  ],
  merge: (held, pushed) => ({ ...held, ...pushed }),
  // A row read by its id carries no `_version`: Zerops' own `lastUpdate` orders it.
  readIsNewer: (held, read) =>
    read.lastUpdate !== undefined &&
    (held.lastUpdate === undefined || Date.parse(read.lastUpdate) > Date.parse(held.lastUpdate)),
  details: [
    {
      // One service's own row, read while a screen demands it: the record after its address was
      // turned on, which no push is promised to bring (8c076ec029).
      suffix: "service",
      leaving: "absent-unverified",
      zerops: {
        path: ({ ownerId }) => `/service-stack/${encodeURIComponent(ownerId ?? "")}`,
        items: (answer) =>
          typeof answer === "object" && answer !== null && "id" in answer ? [answer] : undefined,
      },
    },
  ],
  zerops: {
    entity: "service-stack",
    membership: ({ orgId }) => organization(orgId),
    updates: ({ orgId }) => organization(orgId),
    decode: (raw) =>
      Option.match(decodeRow(raw), {
        onNone: () => null,
        onSome: (row) => ({
          id: row.id,
          value: valueOf(raw as Readonly<Record<string, unknown>>),
          version: row._version ?? null,
        }),
      }),
    verifyPath: (id) => `/service-stack/${encodeURIComponent(id)}`,
    organizationOf: (answer) =>
      Option.match(decodeClient(answer), {
        onNone: () => null,
        onSome: (row) => row.clientId ?? null,
      }),
  },
};

export const servicesScope = (orgId: string): ScopeKey => scopeOf(serviceFamily, orgId);
