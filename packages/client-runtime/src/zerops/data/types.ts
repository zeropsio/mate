import * as Schema from "effect/Schema";
/**
 * Stable platform identities. Adapters decode untrusted values with these
 * schemas before they create domain references.
 */
const SourceId = Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty());
const NonNegativeOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const canonicalApiOrigin = (input: string): string | null => {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

export const ZeropsApiOrigin = SourceId.check(
  Schema.makeFilter(
    (input) =>
      canonicalApiOrigin(input) === input ||
      "ZeropsApiOrigin must be a canonical HTTP(S) origin without path, query or fragment",
  ),
).pipe(Schema.brand("ZeropsApiOrigin"));
export type ZeropsApiOrigin = typeof ZeropsApiOrigin.Type;
export const makeZeropsApiOrigin = (input: string): ZeropsApiOrigin => {
  const normalized = canonicalApiOrigin(input.trim());
  if (normalized === null) {
    throw new TypeError("Zerops API origin must use HTTP(S).");
  }
  return ZeropsApiOrigin.make(normalized);
};
export const ZeropsAccountId = SourceId.pipe(Schema.brand("ZeropsAccountId"));
export type ZeropsAccountId = typeof ZeropsAccountId.Type;
export const ZeropsOrganizationId = SourceId.pipe(Schema.brand("ZeropsOrganizationId"));
export type ZeropsOrganizationId = typeof ZeropsOrganizationId.Type;
export const ZeropsProjectId = SourceId.pipe(Schema.brand("ZeropsProjectId"));
export type ZeropsProjectId = typeof ZeropsProjectId.Type;
export const ZeropsServiceId = SourceId.pipe(Schema.brand("ZeropsServiceId"));
export type ZeropsServiceId = typeof ZeropsServiceId.Type;
export const ZeropsProcessId = SourceId.pipe(Schema.brand("ZeropsProcessId"));
export type ZeropsProcessId = typeof ZeropsProcessId.Type;
export const AccountEpoch = NonNegativeOrdinal.pipe(Schema.brand("ZeropsAccountEpoch"));
export type AccountEpoch = typeof AccountEpoch.Type;

export interface AccountRef {
  readonly apiOrigin: ZeropsApiOrigin;
  readonly accountId: ZeropsAccountId;
}

export interface AccountScope {
  readonly account: AccountRef;
  readonly epoch: AccountEpoch;
}

export interface OrganizationRef {
  readonly kind: "organization";
  readonly account: AccountRef;
  readonly organizationId: ZeropsOrganizationId;
}

export interface ProjectRef {
  readonly kind: "project";
  readonly organization: OrganizationRef;
  readonly projectId: ZeropsProjectId;
}

export interface ServiceRef {
  readonly kind: "service";
  readonly project: ProjectRef;
  readonly serviceId: ZeropsServiceId;
}

export interface ProcessRef {
  readonly kind: "process";
  readonly project: ProjectRef;
  readonly processId: ZeropsProcessId;
}

export type EntityRef = ProjectRef | ServiceRef | ProcessRef;

export const OrganizationKey = Schema.String.pipe(Schema.brand("ZeropsOrganizationKey"));
export type OrganizationKey = typeof OrganizationKey.Type;
export const ProjectKey = Schema.String.pipe(Schema.brand("ZeropsProjectKey"));
export type ProjectKey = typeof ProjectKey.Type;
export const ServiceKey = Schema.String.pipe(Schema.brand("ZeropsServiceKey"));
export type ServiceKey = typeof ServiceKey.Type;
export const ProcessKey = Schema.String.pipe(Schema.brand("ZeropsProcessKey"));
export type ProcessKey = typeof ProcessKey.Type;
export type EntityKey = ProjectKey | ServiceKey | ProcessKey;

const scopedKey = (parts: ReadonlyArray<string>): string => JSON.stringify(parts);

/**
 * A ref's key, computed once per ref object. Refs are immutable, and every publication keys the
 * account's refs again, so a key is serialized once rather than on every read.
 */
function keyedOnce<Ref extends object, Key>(keyOf: (ref: Ref) => Key): (ref: Ref) => Key {
  const keys = new WeakMap<Ref, Key>();
  return (ref) => {
    let key = keys.get(ref);
    if (key === undefined) {
      key = keyOf(ref);
      keys.set(ref, key);
    }
    return key;
  };
}

export const organizationKeyOf = keyedOnce((ref: OrganizationRef): OrganizationKey =>
  OrganizationKey.make(
    scopedKey(["organization", ref.account.apiOrigin, ref.account.accountId, ref.organizationId]),
  ),
);

export const projectKeyOf = keyedOnce((ref: ProjectRef): ProjectKey =>
  ProjectKey.make(
    scopedKey([
      "project",
      ref.organization.account.apiOrigin,
      ref.organization.account.accountId,
      ref.organization.organizationId,
      ref.projectId,
    ]),
  ),
);

export const serviceKeyOf = (ref: ServiceRef): ServiceKey =>
  ServiceKey.make(
    scopedKey([
      "service",
      ref.project.organization.account.apiOrigin,
      ref.project.organization.account.accountId,
      ref.project.organization.organizationId,
      ref.project.projectId,
      ref.serviceId,
    ]),
  );

export const processKeyOf = (ref: ProcessRef): ProcessKey =>
  ProcessKey.make(
    scopedKey([
      "process",
      ref.project.organization.account.apiOrigin,
      ref.project.organization.account.accountId,
      ref.project.organization.organizationId,
      ref.project.projectId,
      ref.processId,
    ]),
  );

export const entityKeyOf = (ref: EntityRef): EntityKey => {
  switch (ref.kind) {
    case "project":
      return projectKeyOf(ref);
    case "service":
      return serviceKeyOf(ref);
    case "process":
      return processKeyOf(ref);
  }
};

export type KnownProcessStatus =
  | "PENDING"
  | "RUNNING"
  | "ROLLBACKING"
  | "CANCELING"
  | "FINISHED"
  | "FAILED"
  | "CANCELED";

export type ProcessStatus = KnownProcessStatus | { readonly kind: "unknown"; readonly raw: string };

export type ScopeFailure =
  | { readonly kind: "offline" }
  | { readonly kind: "timeout"; readonly afterMs: number }
  | { readonly kind: "transport"; readonly detail: string }
  | { readonly kind: "throttled"; readonly retryAfterMs: number | null }
  | { readonly kind: "server"; readonly status: number }
  | { readonly kind: "malformed"; readonly detail: string };
export type ScopeAuthority =
  | { readonly kind: "authorized" }
  | {
      readonly kind: "withheld";
      readonly reason: "access-lapsed" | "access-unverified" | "access-denied";
      readonly cause: { readonly failure: ScopeFailure; readonly retryAtMs: number | null } | null;
    };
