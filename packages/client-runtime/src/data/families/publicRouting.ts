/**
 * Zerops public HTTP routings: every address the organization's projects answer at — their own
 * domains and each service's `*.zerops.app` subdomain — observed by one registration pair for the
 * whole organization, never one read per project. The membership `listStream` is the only path
 * that hears a routing go (a subdomain turned off deletes its routing; turning it on makes a new
 * one); the `updateStream` carries a routing's edits. Leaving the listing is an address no longer
 * served, nothing about its existence: no owner is asked.
 *
 * A viewer the organization's search refuses (a member without organization read) reads a drawn
 * project's routings through a filtered registration pair, demanded while a surface shows it.
 * If that too is refused, its GET listing is refreshed by service-switch or routing-process
 * evidence from the organization streams, never by a timer.
 *
 * @module data/families/publicRouting
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { runsStill } from "./process.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/**
 * One domain of a routing and the platform's last word on reaching it: its DNS check (`PENDING`,
 * `CHECKING`, `OK`, `FAILED`) and its certificate (`INACTIVE`, `WAITING_FOR_DNS`,
 * `BEING_INSTALLED`, `BEING_RENEWED`, `ACTIVE`). A row that says neither leaves them out.
 */
export interface PublicRoutingDomain {
  readonly domainName: string;
  readonly dnsCheckStatus?: string;
  readonly sslStatus?: string;
  /** When the platform last looked the domain up, on its clock. */
  readonly lastDnsCheckAt?: string;
  /** The addresses that look-up found the domain at: none while it points nowhere. */
  readonly resolvedIps?: ReadonlyArray<string>;
  /** Who answers for the domain's DNS: where the person adds its records. */
  readonly nameServers?: ReadonlyArray<string>;
  /** Why the certificate could not be installed, as the platform says it. */
  readonly sslError?: string;
}

/** What an address is made of, as the routing's row says it: nothing else is kept. */
export interface PublicRoutingValue {
  /** The project it routes for; a project's own listing may not say. */
  readonly projectId?: string;
  /** Whether it is in place; one not synced yet serves nothing. */
  readonly isSynced: boolean;
  /**
   * A person's own domains can be changed; each service's zerops.app address is a routing the
   * platform keeps, `false` here. A row that does not say is not counted as either.
   */
  readonly isEditable?: boolean;
  /** Removed, and gone once the project's routings are put in place again. */
  readonly deleteOnSync?: boolean;
  /** Whether it was ever put in place: a routing never synced is new, not changed. */
  readonly everSynced?: boolean;
  /** When Zerops last changed it: a write's end is read only from what came after it. */
  readonly lastUpdate?: string;
  readonly sslEnabled: boolean;
  readonly domains: ReadonlyArray<PublicRoutingDomain>;
  readonly locations: ReadonlyArray<{
    readonly path: string;
    readonly port: number;
    readonly serviceStackId: string;
  }>;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly publicRouting: PublicRoutingValue;
  }
}

const Said = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(Schema.Union([schema, Schema.Null]));

const Row = Schema.Struct({
  id: Schema.String,
  projectId: Schema.optionalKey(Schema.String),
  isSynced: Schema.Boolean,
  isEditable: Said(Schema.Boolean),
  deleteOnSync: Said(Schema.Boolean),
  lastSync: Said(Schema.String),
  lastUpdate: Said(Schema.String),
  sslEnabled: Schema.Boolean,
  domains: Schema.Array(
    Schema.Struct({
      domainName: Schema.String,
      dnsCheckStatus: Said(Schema.String),
      sslStatus: Said(Schema.String),
      lastDnsCheckAt: Said(Schema.String),
      sslCertificateInstallationError: Said(Schema.String),
      lastDnsCheckDetail: Said(
        Schema.Struct({
          resolvedIpAddresses: Said(Schema.Array(Schema.String)),
          resolvedNameServers: Said(Schema.Array(Schema.String)),
        }),
      ),
    }),
  ),
  locations: Schema.Array(
    Schema.Struct({ path: Schema.String, port: Schema.Finite, serviceStackId: Schema.String }),
  ),
  _version: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.Null])),
});
const decodeRow = Schema.decodeUnknownOption(Row);

/** A domain as its row says it, each unsaid part left out. */
function domainOf(domain: (typeof Row.Type)["domains"][number]): PublicRoutingDomain {
  const { dnsCheckStatus, sslStatus, lastDnsCheckAt, sslCertificateInstallationError } = domain;
  const detail = domain.lastDnsCheckDetail;
  return {
    domainName: domain.domainName,
    ...(dnsCheckStatus == null ? {} : { dnsCheckStatus }),
    ...(sslStatus == null ? {} : { sslStatus }),
    ...(lastDnsCheckAt == null ? {} : { lastDnsCheckAt }),
    ...(detail?.resolvedIpAddresses == null ? {} : { resolvedIps: detail.resolvedIpAddresses }),
    ...(detail?.resolvedNameServers == null ? {} : { nameServers: detail.resolvedNameServers }),
    ...(sslCertificateInstallationError == null || sslCertificateInstallationError === ""
      ? {}
      : { sslError: sslCertificateInstallationError }),
  };
}

const organization = (orgId: string) => [{ name: "clientId", operator: "eq", value: orgId }];

const PROJECT_ROUTINGS = "projectRoutings";

export const publicRoutingFamily: FamilySpec<"publicRouting"> = {
  family: "publicRouting",
  authority: "zerops",
  scope: { source: "zerops", suffix: "routings", leaving: "removed", demand: "navigation" },
  indexes: [
    /** The addresses each project serves now: one that left the listing serves none. */
    {
      name: "routingProject",
      keyOf: (value, listed) => (listed === "member" ? (value.projectId ?? null) : null),
    },
  ],
  zerops: {
    entity: "public-http-routing",
    membership: ({ orgId }) => organization(orgId),
    updates: ({ orgId }) => organization(orgId),
    refusedAlone: true,
    decode: (raw) =>
      Option.match(decodeRow(raw), {
        onNone: () => null,
        onSome: ({
          id,
          _version,
          projectId,
          isSynced,
          isEditable,
          deleteOnSync,
          lastSync,
          lastUpdate,
          sslEnabled,
          domains,
          locations,
        }) => ({
          id,
          version: _version ?? null,
          value: {
            ...(projectId === undefined ? {} : { projectId }),
            isSynced,
            ...(isEditable == null ? {} : { isEditable }),
            ...(deleteOnSync == null ? {} : { deleteOnSync }),
            ...(lastSync === undefined ? {} : { everSynced: lastSync !== null && lastSync !== "" }),
            ...(lastUpdate == null ? {} : { lastUpdate }),
            sslEnabled,
            domains: domains.map(domainOf),
            locations: locations.map(({ path, port, serviceStackId }) => ({
              path,
              port,
              serviceStackId,
            })),
          },
        }),
      }),
  },
  details: [
    {
      // One project's live routings where the organization's search is refused.
      suffix: PROJECT_ROUTINGS,
      leaving: "removed",
      zerops: {
        subscription: ({ ownerId }) => [{ name: "projectId", operator: "eq", value: ownerId }],
        refreshOn: ({ ownerId }, row, previous) => {
          if (row.family === "service" && row.value.projectId === ownerId) {
            const held = previous.fact("service", row.id);
            return (
              row.value.subdomainAccess !== undefined &&
              (held.kind !== "known" || held.value.subdomainAccess !== row.value.subdomainAccess)
            );
          }
          if (
            row.family !== "process" ||
            row.value.projectId !== ownerId ||
            runsStill(row.value.status)
          )
            return false;
          const held = previous.fact("process", row.id);
          return (
            (held.kind !== "known" || runsStill(held.value.status)) &&
            [
              "stack.enableSubdomainAccess",
              "stack.disableSubdomainAccess",
              "project.syncPublicHttpRouting",
            ].includes(row.value.actionName)
          );
        },
        path: ({ ownerId }) => `/project/${encodeURIComponent(ownerId ?? "")}/public-http-routing`,
        items: (answer) =>
          typeof answer === "object" &&
          answer !== null &&
          "list" in answer &&
          Array.isArray(answer.list)
            ? answer.list
            : undefined,
      },
    },
  ],
};

export const routingsScope = (orgId: string): ScopeKey => scopeOf(publicRoutingFamily, orgId);

/** One project's routings, read while a surface shows it to a viewer the organization's refused. */
export const projectRoutingsScope = (orgId: string, projectId: string): ScopeKey =>
  `zerops:${orgId}:${PROJECT_ROUTINGS}:${projectId}`;

/** What a surface demands for a project whose routings the organization's search refused. */
export const PROJECT_ROUTINGS_LISTING = PROJECT_ROUTINGS;
