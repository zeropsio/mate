/**
 * IN TRANSIT — owned by the services slice (SVC), deleted with `ZeropsInventoryProvider` and the
 * data runtime.
 *
 * The account's inventory still reads the organization's projects in the data runtime's old shapes
 * (`CollectionRead<ProjectRecord>`, `EntityRead<ProjectRecord>`) to join each with its services and
 * to admit its Mates. This bridge derives them, read only, from the account's store — the project
 * family's `organizationProjects` and `listedProject` — so projects come from one source: the
 * organization's roster. Its freshness is the roster scope's own phase, stated as the
 * organization inventory's interest. Nothing here reads Zerops or holds a value of its own.
 *
 * @module zerops/account/projectBridge
 */
import type { ProjectValue } from "../../data/families/project.ts";
import type { OrganizationProjects } from "../../data/projections/projects.ts";
import { interestKeyOf } from "../data/runtime.ts";
import {
  AccountEpoch,
  InterestEpoch,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ReceiverEpoch,
  ZeropsProjectId,
  ZeropsReceiverId,
  queryKeyOf,
  type AccessState,
  type CollectionRead,
  type EntityRead,
  type FacetAdmission,
  type InterestState,
  type OrganizationRef,
  type ProjectRecord,
  type ProjectRef,
} from "../data/types.ts";

const ADMISSION: FacetAdmission = {
  lastNativeReceiptOrdinal: null,
  lastAppliedAuthoritativeDispatchOrdinal: null,
  hasAuthoritativeObservation: true,
};

const OBSERVED = {
  knowledge: "observed",
  unresolvedRequiredFields: [],
  source: "native-push",
  stamp: { receiptOrdinal: ReceiptOrdinal.make(0), observedAtMs: 0 },
  admission: ADMISSION,
} as const;

const UNVERIFIED: AccessState = { status: "unverified" };

/** The roster scope's phase as the organization inventory's interest states it. */
function interestOf(organization: OrganizationRef, roster: OrganizationProjects): InterestState {
  const identity = {
    receiver: {
      accountEpoch: AccountEpoch.make(0),
      receiverEpoch: ReceiverEpoch.make(0),
      receiverId: ZeropsReceiverId.make("account-store"),
    },
    interestEpoch: InterestEpoch.make(0),
    key: interestKeyOf({ kind: "organization-inventory", organization }),
  };
  if (roster.unavailableReason !== undefined)
    return {
      status: "failed",
      identity,
      reason: roster.unavailableReason,
      retryable: false,
      attempts: 1,
      retryAtMs: null,
    };
  if (roster.live)
    return {
      status: "observing",
      identity,
      guarantee: "source-order-unverified",
      sinceReceiptOrdinal: ReceiptOrdinal.make(0),
    };
  if (roster.reconnecting)
    return {
      status: "failed",
      identity,
      reason: "catching up",
      retryable: true,
      attempts: 1,
      retryAtMs: null,
    };
  return {
    status: "establishing",
    identity,
    startedAtMs: 0,
    deadlineMs: 0,
    progress: {
      requiredRegistrations: 1,
      completedRegistrations: 0,
      requiredReads: 0,
      completedReads: 0,
      crossedReceiptOrdinal: ReceiptOrdinal.make(0),
    },
  };
}

/** One record per project value: an unchanged project is the same record to every reader. */
const records = new WeakMap<ProjectValue, ProjectRecord>();

function recordOf(organization: OrganizationRef, project: ProjectValue): ProjectRecord {
  const held = records.get(project);
  if (held !== undefined) return held;
  const record: ProjectRecord = {
    ref: { kind: "project", organization, projectId: ZeropsProjectId.make(project.id) },
    identity: {
      ...OBSERVED,
      fields: { name: project.name, createdAt: project.created ?? null },
    },
    lifecycle: { ...OBSERVED, fields: { status: project.status } },
    presentation: {
      ...OBSERVED,
      fields: { description: project.description ?? null, tags: project.tagList ?? [] },
    },
    placement: {
      ...OBSERVED,
      fields: {
        publicZone: project.publicZone ?? null,
        zeropsSubdomainHost: project.zeropsSubdomainHost ?? null,
        mode: project.mode ?? null,
      },
    },
  } as ProjectRecord;
  records.set(project, record);
  return record;
}

/** The organization's projects as the inventory reads them, from the account's store. */
export function organizationProjectsRead(
  organization: OrganizationRef,
  roster: OrganizationProjects,
): CollectionRead<ProjectRecord> {
  const descriptor = {
    kind: "projects-of-organization" as const,
    organization,
    statuses: [],
    schemaVersion: 1 as const,
  };
  const common = {
    descriptor,
    key: queryKeyOf(descriptor),
    memberKeys: [],
    unresolvedMemberKeys: [],
    membershipOperations: new Map(),
  };
  return {
    value: roster.projects.map((project) => ({
      knowledge: "observed" as const,
      record: recordOf(organization, project),
    })),
    observation: {
      required: [interestOf(organization, roster)],
      optional: [],
      access: UNVERIFIED,
    },
    query:
      roster.read !== "read"
        ? {
            ...common,
            status: "unresolved",
            coverage: { kind: "none" },
            lastAppliedReadStartOrdinal: null,
          }
        : {
            ...common,
            status: "observed",
            coverage: {
              kind: "exhausted-traversal",
              traversedPages: 1,
              observedTotal: roster.projects.length,
              guarantee: "non-atomic",
            },
            observedTotal: roster.projects.length,
            source: "indexed-search",
            stamp: { receiptOrdinal: ReceiptOrdinal.make(0), observedAtMs: 0 },
            lastAppliedReadStartOrdinal: ReadStartOrdinal.make(0),
          },
  };
}

/** One project as the inventory reads it, from the account's store; unresolved while not held. */
export function projectRead(
  project: ProjectRef,
  value: ProjectValue | null,
): EntityRead<ProjectRecord> {
  return {
    value:
      value === null
        ? { knowledge: "unresolved", ref: project }
        : { knowledge: "observed", record: recordOf(project.organization, value) },
    observation: { required: [], optional: [], access: UNVERIFIED },
  };
}
