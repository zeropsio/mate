/**
 * Zerops public port routings: each port a project opens straight to the internet on its own IP
 * address (a database client's way in), with who may connect. Observed by one registration pair
 * for the whole organization, as the domain routings are: the `listStream` hears a port opened or
 * gone, the `updateStream` its changes. A routing changed but not put in place yet serves as it
 * did; one removed serves until the project's port routings are put in place again.
 *
 * The organization's search is refused to a viewer without organization read (as the domain
 * routings' is, read 2026-10-14): that refusal is this scope's alone.
 *
 * @module data/families/publicPortRouting
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** One open port as its row says it. */
export interface PublicPortRoutingValue {
  readonly projectId?: string;
  readonly serviceStackId: string;
  /** `IP_V6`, the project's own and free, or `IP_V4`, the project's own paid IPv4. */
  readonly publicIpType: string;
  readonly publicPort: number;
  readonly internalPort: number;
  /** `tcp` or `udp`. */
  readonly internalProtocol: string;
  /** `WHITELIST`: only the ranges may connect; `BLACKLIST`: everyone but them. */
  readonly firewallPolicy: string;
  readonly firewallIpRanges: ReadonlyArray<string>;
  /** Whether it is in place as it reads. */
  readonly isSynced: boolean;
  /** Removed, and gone once the project's port routings are put in place again. */
  readonly deleteOnSync?: boolean;
  /** Whether it was ever put in place: one never synced serves nothing yet. */
  readonly everSynced?: boolean;
  /** When Zerops last changed it: a write's end is read only from what came after it. */
  readonly lastUpdate?: string;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly publicPortRouting: PublicPortRoutingValue;
  }
}

const Said = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(Schema.Union([schema, Schema.Null]));

const Row = Schema.Struct({
  id: Schema.String,
  projectId: Schema.optionalKey(Schema.String),
  serviceStackId: Schema.String,
  publicIpType: Schema.String,
  publicPort: Schema.Finite,
  internalPort: Schema.Finite,
  internalProtocol: Schema.String,
  firewallPolicy: Said(Schema.String),
  firewallIpRanges: Said(Schema.Array(Schema.String)),
  isSynced: Schema.Boolean,
  deleteOnSync: Said(Schema.Boolean),
  lastSync: Said(Schema.String),
  lastUpdate: Said(Schema.String),
  _version: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null])),
});
const decodeRow = Schema.decodeUnknownOption(Row);

const organization = (orgId: string) => [{ name: "clientId", operator: "eq", value: orgId }];

export const publicPortRoutingFamily: FamilySpec<"publicPortRouting"> = {
  family: "publicPortRouting",
  authority: "zerops",
  scope: { source: "zerops", suffix: "portRoutings", leaving: "removed", demand: "navigation" },
  indexes: [
    /** The ports each project opens: one that left the listing opens none. */
    {
      name: "portRoutingProject",
      keyOf: (value, listed) => (listed === "member" ? (value.projectId ?? null) : null),
    },
  ],
  zerops: {
    entity: "public-port-routing",
    membership: ({ orgId }) => organization(orgId),
    updates: ({ orgId }) => organization(orgId),
    refusedAlone: true,
    decode: (raw) =>
      Option.match(decodeRow(raw), {
        onNone: () => null,
        onSome: ({ id, _version, projectId, firewallPolicy, firewallIpRanges, ...row }) => ({
          id,
          version: _version ?? null,
          value: {
            ...(projectId === undefined ? {} : { projectId }),
            serviceStackId: row.serviceStackId,
            publicIpType: row.publicIpType,
            publicPort: row.publicPort,
            internalPort: row.internalPort,
            internalProtocol: row.internalProtocol,
            // No policy said is nobody kept out: the platform's own default.
            firewallPolicy: firewallPolicy ?? "BLACKLIST",
            firewallIpRanges: firewallIpRanges ?? [],
            isSynced: row.isSynced,
            ...(row.deleteOnSync == null ? {} : { deleteOnSync: row.deleteOnSync }),
            ...(row.lastSync === undefined
              ? {}
              : { everSynced: row.lastSync !== null && row.lastSync !== "" }),
            ...(row.lastUpdate == null ? {} : { lastUpdate: row.lastUpdate }),
          },
        }),
      }),
  },
};

export const portRoutingsScope = (orgId: string): ScopeKey =>
  scopeOf(publicPortRoutingFamily, orgId);
