import { describe, expect, it } from "@effect/vitest";

import { selectDeployedVersion, selectMateFlag } from "./deployedVersion.ts";
import { reduceTableObservation, SERVICE_VARIABLE_KEYS } from "./entityTable.ts";
import { makeInitialZeropsDataState, type ZeropsDataState } from "./state.ts";
import type {
  DesiredInterestState,
  ServiceDeployInfo,
  ServiceRecord,
  TableQueryDescriptor,
} from "./types.ts";
import { ReceiptOrdinal, serviceKeyOf } from "./types.ts";
import {
  directTicket,
  identity,
  organization,
  scope,
  service,
  stamp,
} from "./__fixtures__/index.ts";

const ref = service("s-1");

const deploy = (overrides: Partial<ServiceDeployInfo>): ServiceDeployInfo => ({
  id: "v-2",
  status: "ACTIVE",
  source: null,
  activatedAt: "2026-10-01T09:00:00Z",
  name: null,
  branch: null,
  commit: null,
  tag: null,
  repository: null,
  ...overrides,
});

/** The service as its organization's search and stream state it. */
const withService = (state: ZeropsDataState, activeDeploy: ServiceDeployInfo | null) => {
  const record = {
    ref,
    deployment: {
      knowledge: "observed",
      fields: { versionNumber: null, mode: null, activeDeploy },
      unresolvedRequiredFields: [],
      source: "native-push",
      stamp: stamp(3),
    },
  } as unknown as ServiceRecord;
  const services = new Map(state.inventory.services);
  services.set(serviceKeyOf(ref), record);
  return { ...state, inventory: { ...state.inventory, services } };
};

/** The service as a read found it gone. */
const withGoneService = (state: ZeropsDataState) => {
  const record = {
    ref,
    deployment: {
      knowledge: "unavailable",
      reason: "not-found",
      previousFields: {},
      stamp: stamp(3),
    },
  } as unknown as ServiceRecord;
  const services = new Map(state.inventory.services);
  services.set(serviceKeyOf(ref), record);
  return { ...state, inventory: { ...state.inventory, services } };
};

const answered = (
  state: ZeropsDataState,
  descriptor: TableQueryDescriptor,
  rows: ReadonlyArray<Record<string, unknown>>,
): ZeropsDataState => ({
  ...state,
  table: reduceTableObservation(state.table, {
    stamp: stamp(2),
    accessEvidence: null,
    input: {
      kind: "table-rows-observed",
      entity: descriptor.kind === "active-versions-of-organization" ? "app-version" : "user-data",
      rows: rows as never,
      source: "direct-read",
      coverage: {
        kind: "exhausted-traversal",
        traversedPages: 1,
        observedTotal: rows.length,
        guarantee: "non-atomic",
      },
      ticket: {
        ...directTicket({ kind: "query", descriptor }, identity(), 1, 1, 1),
        membershipReceiptOrdinalAtStart: ReceiptOrdinal.make(1),
      } as never,
    },
  }).state,
});

const versions: TableQueryDescriptor = {
  kind: "active-versions-of-organization",
  organization,
  schemaVersion: 1,
};
const variables: TableQueryDescriptor = {
  kind: "service-variables-of-organization",
  organization,
  keys: SERVICE_VARIABLE_KEYS,
  schemaVersion: 1,
};
const variable = (key: string, content: string) => ({
  id: `u-${key}`,
  serviceId: "s-1",
  projectId: ref.project.projectId,
  key,
  content,
});

const failedInterest = (
  state: ZeropsDataState,
  kind: "organization-versions" | "organization-variables",
) => {
  const interests = new Map(state.interests);
  interests.set(
    "failed" as never,
    {
      descriptor: { kind, organization },
      key: "failed",
      leases: 1,
      required: true,
      registrationAttemptsOnReceiver: 1,
      interest: {
        status: "failed",
        identity: identity(),
        reason: "registration",
        retryable: true,
        attempts: 2,
        retryAtMs: 9_000,
      },
      wire: { status: "absent" },
    } as unknown as DesiredInterestState,
  );
  return { ...state, interests };
};

describe("what a service runs, as the account's store states it (A14)", () => {
  const empty = makeInitialZeropsDataState(scope());
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly state: ZeropsDataState;
    readonly expected: object;
  }> = [
    {
      name: "is unread while the service is not",
      state: answered(empty, versions, []),
      expected: { state: "unread" },
    },
    {
      name: "runs nothing without an active version",
      state: withService(empty, null),
      expected: { state: "known", value: { activeId: null, source: null, name: null } },
    },
    {
      name: "takes the source the push stated",
      state: withService(empty, deploy({ source: "GIT", name: "pushed" })),
      expected: { state: "known", value: { activeId: "v-2", source: "GIT", name: "pushed" } },
    },
    {
      name: "waits for the organization's active versions for a source the push left unstated",
      state: withService(empty, deploy({})),
      expected: { state: "unread" },
    },
    {
      name: "takes the source from the organization's active versions",
      state: withService(
        answered(
          answered(empty, versions, [
            { id: "v-2", serviceId: "s-1", projectId: null, status: "ACTIVE", source: "NONE" },
          ]),
          variables,
          [],
        ),
        deploy({}),
      ),
      expected: { state: "known", value: { activeId: "v-2", source: "NONE", name: null } },
    },
    {
      name: "names the version the service last started only while it is the active one",
      state: withService(
        answered(empty, variables, [
          variable("appVersionId", "v-2"),
          variable("appVersionName", "abc123 v1.1.0"),
        ]),
        deploy({ source: "CLI", name: "stale" }),
      ),
      expected: {
        state: "known",
        value: { activeId: "v-2", source: "CLI", name: "abc123 v1.1.0" },
      },
    },
    {
      name: "names nothing while the deploy the service last started is not yet active (A11)",
      state: withService(
        answered(empty, variables, [
          variable("appVersionId", "v-3"),
          variable("appVersionName", "def456 v1.2.0"),
        ]),
        deploy({ source: "CLI" }),
      ),
      expected: { state: "known", value: { activeId: "v-2", source: "CLI", name: null } },
    },
    {
      name: "keeps the name the push gave until the variables answer",
      state: withService(empty, deploy({ source: "CLI", name: "abc123 v1.0.0" })),
      expected: {
        state: "known",
        value: { activeId: "v-2", source: "CLI", name: "abc123 v1.0.0" },
      },
    },
    {
      name: "waits for the variables to name a version the push named nothing",
      state: withService(empty, deploy({ source: "CLI", name: null })),
      expected: { state: "unread" },
    },
    {
      name: "fails for good once the service is gone",
      state: withGoneService(empty),
      expected: { state: "failed", retryAtMs: null },
    },
    {
      name: "fails as its stream failed",
      state: failedInterest(withService(empty, deploy({})), "organization-versions"),
      expected: { state: "failed", retryAtMs: 9_000 },
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(selectDeployedVersion(testCase.state, ref)).toMatchObject(testCase.expected);
    });
  }
});

describe("the Mate flag, as the account's store states it", () => {
  const empty = makeInitialZeropsDataState(scope());
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly state: ZeropsDataState;
    readonly expected: boolean | "unknown" | "unread";
  }> = [
    { name: "is unread before the variables are", state: empty, expected: "unread" },
    {
      name: "is on where the service says so",
      state: answered(empty, variables, [variable("ZCP_MATE_ENABLED", "1")]),
      expected: true,
    },
    {
      name: "is off where the service says so",
      state: answered(empty, variables, [variable("ZCP_MATE_ENABLED", "false")]),
      expected: false,
    },
    {
      name: "is off where the service has no flag",
      state: answered(empty, variables, []),
      expected: false,
    },
    {
      name: "is unknown when its stream failed",
      state: failedInterest(empty, "organization-variables"),
      expected: "unknown",
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(selectMateFlag(testCase.state, ref)).toBe(testCase.expected);
    });
  }
});
