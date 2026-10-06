import { describe, expect, it } from "@effect/vitest";

import {
  selectDeployedVersion,
  selectMateFlag,
  selectSetupMarker,
  observeServiceDeploys,
  statedDeployKey,
} from "./deployedVersion.ts";
import { reduceTableObservation, SERVICE_VARIABLE_KEYS, tableRowsWanted } from "./entityTable.ts";
import { makeUnresolvedService } from "./inventory.ts";
import { decodeEntityQueryResponse } from "./platformProtocol.ts";
import { makeInitialZeropsDataState, type ZeropsDataState } from "./state.ts";
import type {
  DesiredInterestState,
  ServiceDeployInfo,
  ServiceRecord,
  TableQueryDescriptor,
} from "./types.ts";
import { decodeTableRow } from "./tableProtocol.ts";
import { InterestKey, ReceiptOrdinal, serviceKeyOf } from "./types.ts";
import {
  desiredInterest,
  directTicket,
  identity,
  organization,
  queryTicket,
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
const withService = (
  state: ZeropsDataState,
  activeDeploy: ServiceDeployInfo | null,
  at = stamp(3),
) => {
  const record = {
    ...makeUnresolvedService(ref),
    deployment: {
      knowledge: "observed",
      fields: { versionNumber: null, mode: null, activeDeploy },
      admission: makeUnresolvedService(ref).deployment.admission,
      unresolvedRequiredFields: [],
      source: "native-push",
      stamp: at,
    },
  } as unknown as ServiceRecord;
  const services = new Map(state.inventory.services);
  services.set(serviceKeyOf(ref), record);
  const interests = new Map(state.interests);
  const key = InterestKey.make("project-variables");
  interests.set(key, {
    ...desiredInterest(identity()),
    key,
    descriptor: { kind: "project-variables", project: ref.project, serviceIds: [ref.serviceId] },
  });
  return { ...state, interests, inventory: { ...state.inventory, services } };
};

/** The service's record as the store holds it, kept in the test's state beside its variables. */
const held = (state: ZeropsDataState) => state.inventory.services.get(serviceKeyOf(ref));

/** The store's row of the service names `deployId` as of receipt `receipt`. */
const moveTo = (state: ZeropsDataState, deployId: string, receipt: number, nowMs: number) =>
  observeServiceDeploys(
    { ...state, lastReceiptOrdinal: ReceiptOrdinal.make(receipt - 1) },
    [{ organization, serviceId: ref.serviceId, deployId }],
    nowMs,
  );

/** The service as a read found it gone. */
const withGoneService = (state: ZeropsDataState) => {
  const record = {
    ...makeUnresolvedService(ref),
    deployment: {
      knowledge: "unavailable",
      reason: "not-found",
      previousFields: {},
      stamp: stamp(3),
    },
  } as unknown as ServiceRecord;
  const services = new Map(state.inventory.services);
  services.set(serviceKeyOf(ref), record);
  const interests = new Map(state.interests);
  const key = InterestKey.make("project-variables");
  interests.set(key, {
    ...desiredInterest(identity()),
    key,
    descriptor: { kind: "project-variables", project: ref.project, serviceIds: [ref.serviceId] },
  });
  return { ...state, interests, inventory: { ...state.inventory, services } };
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
      entity: "user-data",
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

/** The organization's variables as its stream pushed them, at `ordinal`. */
const pushed = (
  state: ZeropsDataState,
  rows: ReadonlyArray<Record<string, unknown>>,
  ordinal: number,
): ZeropsDataState => ({
  ...state,
  table: reduceTableObservation(state.table, {
    stamp: stamp(ordinal),
    accessEvidence: null,
    input: {
      kind: "table-rows-observed",
      entity: "user-data",
      rows: rows as never,
      source: "native-push",
      registration: {
        descriptor: { kind: "table-updates", entity: "user-data", organization },
      } as never,
    },
  }).state,
});

const variables: TableQueryDescriptor = {
  kind: "service-variables-of-services",
  organization,
  serviceIds: ["s-1", "s-2", "service", "service-a", "app", "mate"],
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

/** The organization's variables stream failed. */
const failedInterest = (state: ZeropsDataState) => {
  const interests = new Map(state.interests);
  interests.set(
    "failed" as never,
    {
      descriptor: { kind: "project-variables", project: ref.project, serviceIds: [ref.serviceId] },
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
      state: answered(empty, variables, []),
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
      name: "leaves a source the push did not state to the organization's active versions",
      state: withService(answered(empty, variables, []), deploy({})),
      expected: { state: "known", value: { activeId: "v-2", source: null, name: null } },
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
      state: pushed(
        withService(answered(empty, variables, []), deploy({ source: "CLI" })),
        [variable("appVersionId", "v-3"), variable("appVersionName", "def456 v1.2.0")],
        5,
      ),
      expected: { state: "known", value: { activeId: "v-2", source: "CLI", name: null } },
    },
    {
      name: "checks again variables heard before the service moved to the version it runs",
      state: withService(
        answered(empty, variables, [
          variable("appVersionId", "v-1"),
          variable("appVersionName", "abc123 v1.0.0"),
        ]),
        deploy({ source: "CLI" }),
      ),
      expected: { state: "unread" },
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
      state: failedInterest(withService(empty, deploy({}))),
      expected: { state: "failed", retryAtMs: 9_000 },
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(selectDeployedVersion(testCase.state, ref, held(testCase.state))).toMatchObject(
        testCase.expected,
      );
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
      state: failedInterest(empty),
      expected: "unknown",
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(selectMateFlag(testCase.state, ref)).toBe(testCase.expected);
    });
  }
});

describe("the press's marker, as the account's store states it", () => {
  const empty = makeInitialZeropsDataState(scope());
  // Base64 of an import document: only whether it is there matters.
  const MARKER = ["c2Vy", "dmljZXM6IFtd"].join("");
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly state: ZeropsDataState;
    readonly expected: boolean | "unknown" | "unread";
  }> = [
    { name: "is unread before the variables are", state: empty, expected: "unread" },
    {
      name: "is there on a container the press made",
      state: answered(empty, variables, [variable("MATE_SETUP_RUNTIMES", MARKER)]),
      expected: true,
    },
    {
      name: "is absent on a container made before the press",
      state: answered(empty, variables, [variable("ZCP_MATE_ENABLED", "1")]),
      expected: false,
    },
    {
      name: "is unknown when its stream failed",
      state: failedInterest(empty),
      expected: "unknown",
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(selectSetupMarker(testCase.state, ref, held(testCase.state))).toBe(testCase.expected);
    });
  }
  // A container the stream has not delivered a single variable of yet, made within five minutes
  // of the list's answer: its marker may be on its way, and it is not read as absent (pass 28).
  const withService = (state: ZeropsDataState, createdAt: string): ZeropsDataState => ({
    ...state,
    inventory: {
      ...state.inventory,
      services: new Map([
        [
          serviceKeyOf(ref),
          {
            ref,
            lifecycle: { knowledge: "observed", fields: { createdAt }, stamp: stamp(1) },
          } as never,
        ],
      ]),
    },
  });
  // The list answers at the fixtures' stamp(2): 20 ms past the epoch.
  const MINUTE_BEFORE = "1969-12-31T23:59:00.020Z";
  const HOUR_BEFORE = "1969-12-31T23:00:00.020Z";
  it.each([
    {
      name: "a container made a minute before the list answered",
      createdAt: MINUTE_BEFORE,
      expected: "unread",
    },
    { name: "a container made an hour before", createdAt: HOUR_BEFORE, expected: false },
  ])("is $expected for $name, with none of its variables delivered", ({ createdAt, expected }) => {
    const state = withService(
      answered(empty, variables, [{ ...variable("ZCP_MATE_ENABLED", "1"), serviceId: "s-other" }]),
      createdAt,
    );
    expect(selectSetupMarker(state, ref, held(state))).toBe(expected);
  });

  it("is absent for a young container whose other variables arrived", () => {
    const state = withService(
      answered(empty, variables, [variable("ZCP_MATE_ENABLED", "1")]),
      MINUTE_BEFORE,
    );
    expect(selectSetupMarker(state, ref, held(state))).toBe(false);
  });
});

// F13, 2026-10-03: HQ deployed `main 6aeae99` to a stage while its page was open. The service's
// push moved it to the new version; the variables the page loaded with still named the import's,
// nothing read them again, and the stage read "none" until a reload.
describe("a service's variables heard before it moved to another version", () => {
  /** A read by id that began at `startedAtMs` (receipt `receipt - 1`) and answered `rows`. */
  const readById = (
    state: ZeropsDataState,
    rows: ReadonlyArray<Record<string, unknown>>,
    receipt: number,
    startedAtMs: number,
  ): ZeropsDataState => ({
    ...state,
    table: reduceTableObservation(state.table, {
      stamp: { receiptOrdinal: ReceiptOrdinal.make(receipt), observedAtMs: startedAtMs + 500 },
      accessEvidence: null,
      input: {
        kind: "table-rows-observed",
        entity: "user-data",
        rows: rows as never,
        source: "direct-read",
        coverage: {
          kind: "exhausted-traversal",
          traversedPages: 1,
          observedTotal: rows.length,
          guarantee: "non-atomic",
        },
        ticket: {
          ...directTicket(
            {
              kind: "query",
              descriptor: { ...variables, ids: rows.map((row) => row.id as string) } as never,
            },
            identity(),
            receipt - 1,
            receipt - 1,
            receipt - 1,
          ),
          startedAtMs,
        } as never,
      },
    }).state,
  });
  /** The variables as the page loaded them: the import's version, named nothing. */
  const loaded = answered(makeInitialZeropsDataState(scope()), variables, [
    variable("appVersionId", "v-import"),
    variable("appVersionName", ""),
  ]);
  /** The service's push once HQ's deploy went live: the new version, its source known. */
  const deployed = withService(loaded, deploy({ id: "v-2", source: "CLI" }));

  it("are read again by id, and then name the version the service runs", () => {
    // Checked, not nameless, while they are read again: "none" was the stage's word for it.
    expect(selectDeployedVersion(deployed, ref, held(deployed))).toEqual({
      state: "unread",
      waitingFor: null,
    });
    let state = moveTo(deployed, "v-2", 4, 1_000);
    expect(tableRowsWanted(state.table)).toMatchObject([
      { entity: "user-data", ids: ["u-appVersionId", "u-appVersionName"], dueAtMs: 1_000 },
    ]);
    state = readById(
      state,
      [variable("appVersionId", "v-2"), variable("appVersionName", "main 6aeae99")],
      6,
      2_000,
    );
    expect(selectDeployedVersion(state, ref, held(state))).toMatchObject({
      state: "known",
      value: { activeId: "v-2", source: "CLI", name: "main 6aeae99" },
    });
    expect(tableRowsWanted(moveTo(state, "v-2", 7, 3_000).table)).toEqual([]);
  });

  it("stand when the service's row stays on the version it ran: no move, no read", () => {
    // The service moved to v-2 at receipt 3; a build started since named v-3 in the variables at
    // 5 and failed; its row at 9 changes nothing of what it runs and moves nothing.
    const moved = moveTo(
      withService(
        answered(makeInitialZeropsDataState(scope()), variables, []),
        deploy({ id: "v-2", source: "CLI" }),
      ),
      "v-2",
      3,
      1_000,
    );
    const started = pushed(
      moved,
      [variable("appVersionId", "v-3"), variable("appVersionName", "main 7e2d4c1")],
      5,
    );
    const later = moveTo(started, "v-2", 9, 2_000);
    expect(tableRowsWanted(later.table)).toEqual([]);
    expect(selectDeployedVersion(later, ref, held(later))).toMatchObject({
      state: "known",
      value: { activeId: "v-2", name: null },
    });
  });

  it("are read again once per move, never in a loop, whatever the read answers", () => {
    let state = moveTo(deployed, "v-2", 4, 1_000);
    state = readById(
      state,
      [variable("appVersionId", "v-import"), variable("appVersionName", "")],
      6,
      2_000,
    );
    expect(tableRowsWanted(moveTo(state, "v-2", 7, 3_000).table)).toEqual([]);
  });

  it.each([
    {
      name: "a build started since: the variables name the newer version first (A11)",
      state: pushed(
        moveTo(deployed, "v-2", 3, 1_000),
        [variable("appVersionId", "v-3"), variable("appVersionName", "main 7e2d4c1")],
        5,
      ),
    },
    {
      name: "the variables already name the version it runs",
      state: withService(
        answered(makeInitialZeropsDataState(scope()), variables, [
          variable("appVersionId", "v-2"),
          variable("appVersionName", "main 6aeae99"),
        ]),
        deploy({ id: "v-2", source: "CLI" }),
      ),
    },
    {
      name: "the organization's variables have not answered yet",
      state: withService(makeInitialZeropsDataState(scope()), deploy({ id: "v-2", source: "CLI" })),
    },
  ])("are not read again when $name", ({ state }) => {
    expect(tableRowsWanted(moveTo(state, "v-2", 9, 1_000).table)).toEqual([]);
  });
});

// F10, 2026-10-03: B's production `app` as the platform answered t10 — the import's own no-code
// version, which the service's row names without a source. The organization's active versions
// source it NONE, in the account's store (`account/stops.ts`).
describe("a production on the import's no-code version, as the platform answers it", () => {
  const VERSION = "fJCalELVSOuR53ZwvjA1GA";
  const services = {
    kind: "services-of-project" as const,
    project: service().project,
    schemaVersion: 1 as const,
  };

  it("is known to run that version, its source left to the active versions, named nothing", () => {
    const decoded = decodeEntityQueryResponse(
      services,
      queryTicket(services),
      {
        items: [
          {
            id: "s-1",
            projectId: ref.project.projectId,
            name: "app",
            status: "ACTIVE",
            activeAppVersion: {
              base: "nodejs@22",
              created: "2026-10-02T23:16:00Z",
              id: VERSION,
              lastUpdate: "2026-10-02T23:16:00Z",
              os: "ubuntu",
              status: "ACTIVE",
            },
          },
        ],
        limit: 2000,
        offset: 0,
        totalHits: 1,
      },
      "indexed-search",
    );
    const pushed = decoded.observations.find(
      (observation) => observation.kind === "service-deployment-observed",
    );
    const activeDeploy = (
      pushed as { observation: { fields: { activeDeploy: ServiceDeployInfo } } }
    ).observation.fields.activeDeploy;
    // The row names the version and nothing of where it came from.
    expect(activeDeploy).toMatchObject({ id: VERSION, source: null, name: null });
    const state = withService(
      answered(makeInitialZeropsDataState(scope()), variables, [
        decodeTableRow("user-data", {
          id: "u-appVersionId",
          serviceStackId: "s-1",
          projectId: ref.project.projectId,
          key: "appVersionId",
          content: VERSION,
        })!,
        decodeTableRow("user-data", {
          id: "u-appVersionName",
          serviceStackId: "s-1",
          projectId: ref.project.projectId,
          key: "appVersionName",
          content: "",
        })!,
      ] as never),
      activeDeploy,
    );
    expect(selectDeployedVersion(state, ref, held(state))).toMatchObject({
      state: "known",
      value: { activeId: VERSION, source: null, name: null },
    });
  });
});

describe("the deploy name a group's read is keyed on", () => {
  const version = { appVersionId: "v-1", source: "GIT", name: null };
  it.each([
    ["nothing read yet", undefined, "?"],
    ["unread", { state: "unread", waitingFor: null }, "?"],
    ["reading", { state: "reading" }, "?"],
    ["failed", { state: "failed", failure: { kind: "timeout" }, retryAtMs: null }, "?"],
    ["known without a name", { state: "known", value: version }, "="],
    ["known with a name", { state: "known", value: { ...version, name: "d-1" } }, "=d-1"],
  ] as const)("%s", (_, shown, expected) => {
    expect(statedDeployKey(shown as never)).toBe(expected);
  });
});
