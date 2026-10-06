/**
 * Zerops services: every service of the organization, each as the platform's whole row says it,
 * observed by one registration pair for the whole organization — never one read per project. A
 * service that leaves the organization's listing is no longer one of its projects' services; that
 * says nothing of why (deleted, or its project taken from the viewer), so it claims no deletion:
 * the project family's own answer says which.
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

export const serviceFamily: FamilySpec<"service"> = {
  family: "service",
  authority: "zerops",
  scope: { source: "zerops", suffix: "services", leaving: "removed", demand: "navigation" },
  indexes: [
    /** The services each project has now: one that left the listing is none of them. */
    {
      name: "serviceProject",
      keyOf: (value, listed) => (listed === "removed" ? null : value.projectId),
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
  },
};

export const servicesScope = (orgId: string): ScopeKey => scopeOf(serviceFamily, orgId);
