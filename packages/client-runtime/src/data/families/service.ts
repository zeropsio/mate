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
  /** Only the active deploy's id and display label, where the listing carries them. */
  readonly userData?: ReadonlyArray<{ readonly key?: string; readonly content?: string | null }>;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly service: ServiceValue;
  }
}

/** Only evidence consumed by service projections crosses into account memory. */
const optionalString = Schema.optionalKey(Schema.String);
const optionalNullableString = Schema.optionalKey(Schema.NullOr(Schema.String));
const optionalNumber = Schema.optionalKey(Schema.NullOr(Schema.Finite));
const GitIntegration = Schema.Struct({
  isActive: Schema.optionalKey(Schema.Boolean),
  eventType: optionalString,
  branchName: optionalNullableString,
  tagName: optionalNullableString,
  commit: optionalNullableString,
  repositoryFullName: optionalNullableString,
});
const Resource = Schema.Struct({
  cpuCoreCount: optionalNumber,
  memoryGBytes: optionalNumber,
  diskGBytes: optionalNumber,
});
const Row = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  status: Schema.String,
  clientId: optionalString,
  _version: optionalNumber,
  isSystem: Schema.optionalKey(Schema.Boolean),
  subdomainAccess: Schema.optionalKey(Schema.Boolean),
  ports: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        port: Schema.Finite,
        protocol: optionalString,
        scheme: optionalString,
        httpSupport: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  ),
  serviceStackTypeInfo: Schema.optionalKey(
    Schema.Struct({
      serviceStackTypeName: optionalString,
      serviceStackTypeVersionName: optionalString,
      serviceStackTypeCategory: optionalString,
    }),
  ),
  versionNumber: optionalString,
  mode: optionalNullableString,
  created: optionalString,
  lastUpdate: optionalString,
  activeAppVersion: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        id: optionalString,
        name: optionalNullableString,
        status: optionalString,
        source: optionalString,
        created: optionalString,
        lastUpdate: optionalString,
        activationDate: optionalNullableString,
        githubIntegration: Schema.optionalKey(Schema.NullOr(GitIntegration)),
        gitlabIntegration: Schema.optionalKey(Schema.NullOr(GitIntegration)),
        publicGitSource: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              branchName: optionalNullableString,
              repositoryUrl: optionalNullableString,
            }),
          ),
        ),
      }),
    ),
  ),
  githubIntegration: Schema.optionalKey(Schema.NullOr(GitIntegration)),
  gitlabIntegration: Schema.optionalKey(Schema.NullOr(GitIntegration)),
  currentAutoscaling: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        verticalAutoscaling: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              minResource: Schema.optionalKey(Schema.NullOr(Resource)),
              maxResource: Schema.optionalKey(Schema.NullOr(Resource)),
              cpuMode: optionalNullableString,
              startCpuCoreCount: optionalNumber,
            }),
          ),
        ),
        horizontalAutoscaling: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              minContainerCount: optionalNumber,
              maxContainerCount: optionalNumber,
            }),
          ),
        ),
      }),
    ),
  ),
  userData: Schema.optionalKey(Schema.Unknown),
});
const decodeRow = Schema.decodeUnknownOption(Row);
const Variable = Schema.Struct({ key: Schema.String, content: optionalNullableString });
const decodeVariable = Schema.decodeUnknownOption(Variable);

/** Deploy labels belong to listing evidence; full variables have their own demanded family. */
const KEPT_VARIABLES: ReadonlySet<string> = new Set(["appVersionId", "appVersionName"]);

function valueOf(row: typeof Row.Type): ServiceValue {
  const { _version: _ignored, userData, ...fields } = row;
  if (!Array.isArray(userData)) return fields;
  const kept = userData.flatMap((entry: unknown) => {
    const variable = Option.getOrUndefined(decodeVariable(entry));
    return variable !== undefined && KEPT_VARIABLES.has(variable.key)
      ? [{ key: variable.key, content: variable.content ?? null }]
      : [];
  });
  return { ...fields, userData: kept };
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
      member: true,
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
          value: valueOf(row),
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
