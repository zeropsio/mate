import { describe, expect, it } from "@effect/vitest";

import {
  selectDeployedVersion,
  selectMateFlag,
  selectSetupMarker,
  statedDeployKey,
  wantStaleVariables,
} from "./deployedVersion.ts";
import {
  ABSENT_BACKOFF_MS,
  reduceTableObservation,
  SERVICE_VARIABLE_KEYS,
  tableRowsWanted,
} from "./entityTable.ts";
import { decodeEntityQueryResponse } from "./platformProtocol.ts";
import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import {
  makeInitialZeropsDataState,
  reduceZeropsDataState,
  wantActiveVersions,
  type ZeropsDataState,
} from "./state.ts";
import type {
  DesiredInterestState,
  ServiceDeployInfo,
  ServiceRecord,
  TableQueryDescriptor,
} from "./types.ts";
import { decodeTableRow } from "./tableProtocol.ts";
import { ReceiptOrdinal, serviceKeyOf } from "./types.ts";
import {
  desiredInterest,
  directTicket,
  entityRegistration,
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
    ref,
    deployment: {
      knowledge: "observed",
      fields: { versionNumber: null, mode: null, activeDeploy },
      unresolvedRequiredFields: [],
      source: "native-push",
      stamp: at,
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

/** The organization's variables (or active versions) as its stream pushed them, at `ordinal`. */
const pushed = (
  state: ZeropsDataState,
  rows: ReadonlyArray<Record<string, unknown>>,
  ordinal: number,
  entity: "user-data" | "app-version" = "user-data",
): ZeropsDataState => ({
  ...state,
  table: reduceTableObservation(state.table, {
    stamp: stamp(ordinal),
    accessEvidence: null,
    input: {
      kind: "table-rows-observed",
      entity,
      rows: rows as never,
      source: "native-push",
      registration: { descriptor: { kind: "table-updates", entity, organization } } as never,
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
      state: failedInterest(empty, "organization-variables"),
      expected: "unknown",
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(selectSetupMarker(testCase.state, ref)).toBe(testCase.expected);
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
    expect(selectSetupMarker(state, ref)).toBe(expected);
  });

  it("is absent for a young container whose other variables arrived", () => {
    const state = withService(
      answered(empty, variables, [variable("ZCP_MATE_ENABLED", "1")]),
      MINUTE_BEFORE,
    );
    expect(selectSetupMarker(state, ref)).toBe(false);
  });
});

describe("a version a service runs that its organization's list lacks", () => {
  /** A read by id of `ids` that began at `startedAtMs` and found none of them. */
  const absentById = (
    state: ZeropsDataState,
    ids: ReadonlyArray<string>,
    receipt: number,
    startedAtMs: number,
  ): ZeropsDataState => ({
    ...state,
    table: reduceTableObservation(state.table, {
      stamp: { receiptOrdinal: ReceiptOrdinal.make(receipt), observedAtMs: startedAtMs + 500 },
      accessEvidence: null,
      input: {
        kind: "table-rows-observed",
        entity: "app-version",
        rows: [],
        source: "direct-read",
        coverage: {
          kind: "exhausted-traversal",
          traversedPages: 1,
          observedTotal: 0,
          guarantee: "non-atomic",
        },
        ticket: {
          ...directTicket(
            { kind: "query", descriptor: { ...versions, ids } as never },
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
  const fresh = (): ZeropsDataState =>
    withService(
      answered(answered(makeInitialZeropsDataState(scope()), versions, []), variables, []),
      deploy({}),
    );

  it("is read by id, waits out the index's lag, then reads unknown on a back-off, never in a loop", () => {
    let state = wantActiveVersions(fresh(), 3, 1_000);
    expect(tableRowsWanted(state.table)).toMatchObject([
      { entity: "app-version", ids: ["v-2"], dueAtMs: 1_000 },
    ]);
    // A read right after it was owed may trail it: no verdict, one more look after the lag.
    state = absentById(state, ["v-2"], 5, 1_500);
    expect(selectDeployedVersion(state, ref).state).toBe("unread");
    expect(tableRowsWanted(state.table)).toMatchObject([{ ids: ["v-2"], dueAtMs: 11_000 }]);
    // The read past the lag finds it absent too.
    state = absentById(state, ["v-2"], 7, 11_000);
    // Every later message asks nothing sooner than its back-off.
    for (const [receipt, nowMs] of [
      [8, 12_100],
      [9, 12_200],
      [10, 13_000],
    ] as const)
      state = wantActiveVersions(state, receipt, nowMs);
    expect(tableRowsWanted(state.table)).toMatchObject([
      { ids: ["v-2"], dueAtMs: 11_500 + ABSENT_BACKOFF_MS[0]! },
    ]);
    expect(selectDeployedVersion(state, ref)).toMatchObject({
      state: "failed",
      retryAtMs: 11_500 + ABSENT_BACKOFF_MS[0]!,
    });
  });

  it("stops asking about a version once no service runs it", () => {
    let state = wantActiveVersions(fresh(), 3, 1_000);
    state = absentById(state, ["v-2"], 5, 11_000);
    expect(tableRowsWanted(state.table)).toMatchObject([{ ids: ["v-2"] }]);
    state = wantActiveVersions(withService(state, null), 6, 12_000);
    expect(tableRowsWanted(state.table)).toEqual([]);
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
    expect(selectDeployedVersion(deployed, ref)).toEqual({ state: "unread", waitingFor: null });
    let state = wantStaleVariables(deployed, 4, 1_000);
    expect(tableRowsWanted(state.table)).toMatchObject([
      { entity: "user-data", ids: ["u-appVersionId", "u-appVersionName"] },
    ]);
    state = readById(
      state,
      [variable("appVersionId", "v-2"), variable("appVersionName", "main 6aeae99")],
      6,
      2_000,
    );
    expect(selectDeployedVersion(state, ref)).toMatchObject({
      state: "known",
      value: { activeId: "v-2", source: "CLI", name: "main 6aeae99" },
    });
    expect(tableRowsWanted(wantStaleVariables(state, 7, 3_000).table)).toEqual([]);
  });

  it("are asked for by the push that moves the service, without a reload", () => {
    const id = identity();
    const watched = reduceZeropsDataState(
      makeInitialZeropsDataState(scope()),
      { kind: "interest-upserted", interest: desiredInterest(id) },
      DEFAULT_ZEROPS_DATA_POLICY,
    ).state;
    const before = answered(watched, variables, [
      variable("appVersionId", "v-import"),
      variable("appVersionName", ""),
    ]);
    const moved = reduceZeropsDataState(
      before,
      {
        kind: "observation",
        observation: {
          stamp: stamp(4, 1_000),
          accessEvidence: null,
          input: {
            kind: "service-deployment-observed",
            ref,
            observation: {
              source: "native-push",
              registration: entityRegistration("service", id),
              fields: { activeDeploy: deploy({ id: "v-2", source: "CLI" }) },
              metadata: {},
            },
          },
        },
      },
      DEFAULT_ZEROPS_DATA_POLICY,
    );
    expect(moved.followUps).toContainEqual({
      kind: "read-table-rows",
      entity: "user-data",
      organization,
      ids: ["u-appVersionId", "u-appVersionName"],
      dueAtMs: 1_000,
    });
    expect(selectDeployedVersion(moved.state, ref).state).toBe("unread");
  });

  it("count from when the version it runs was heard active, not from the service's last push", () => {
    const active = pushed(
      loaded,
      [{ id: "v-2", serviceId: "s-1", projectId: null, status: "ACTIVE", source: "CLI" }],
      6,
      "app-version",
    );
    // Its version went active after the variables were heard, its push long after both.
    const state = wantStaleVariables(
      withService(active, deploy({ id: "v-2" }), stamp(9)),
      10,
      1_000,
    );
    expect(tableRowsWanted(state.table)).toMatchObject([
      { entity: "user-data", ids: ["u-appVersionId", "u-appVersionName"] },
    ]);
  });

  it("are read again once per move, never in a loop, whatever the read answers", () => {
    let state = wantStaleVariables(deployed, 4, 1_000);
    state = readById(
      state,
      [variable("appVersionId", "v-import"), variable("appVersionName", "")],
      6,
      2_000,
    );
    expect(tableRowsWanted(wantStaleVariables(state, 7, 3_000).table)).toEqual([]);
  });

  it.each([
    {
      name: "a build started since: the variables name the newer version first (A11)",
      state: pushed(
        deployed,
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
    {
      name: "the service runs nothing",
      state: withService(loaded, null),
    },
    {
      // The service's push moves its stamp whatever it carries; its version's row does not.
      name: "a later push of the service leaves it on the version whose build failed since",
      state: withService(
        pushed(
          answered(
            answered(makeInitialZeropsDataState(scope()), versions, [
              { id: "v-2", serviceId: "s-1", projectId: null, status: "ACTIVE", source: "CLI" },
            ]),
            variables,
            [],
          ),
          [variable("appVersionId", "v-3"), variable("appVersionName", "main 7e2d4c1")],
          5,
        ),
        deploy({ id: "v-2" }),
        stamp(9),
      ),
    },
  ])("are not read again when $name", ({ state }) => {
    expect(tableRowsWanted(wantStaleVariables(state, 9, 1_000).table)).toEqual([]);
  });
});

// F10, 2026-10-03: B's production `app` as the platform answered t10 — the import's own no-code
// version, which the service's row names without a source and the versions list sources NONE.
describe("a production on the import's no-code version, as the platform answers it", () => {
  const VERSION = "fJCalELVSOuR53ZwvjA1GA";
  const services = {
    kind: "services-of-organization" as const,
    organization,
    schemaVersion: 1 as const,
  };

  it("is known to run that version, sourced NONE and named nothing", () => {
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
      answered(
        answered(makeInitialZeropsDataState(scope()), versions, [
          decodeTableRow("app-version", {
            id: VERSION,
            serviceStackId: "s-1",
            projectId: ref.project.projectId,
            status: "ACTIVE",
            source: "NONE",
            name: null,
          })!,
        ] as never),
        variables,
        [
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
        ] as never,
      ),
      activeDeploy,
    );
    expect(selectDeployedVersion(state, ref)).toMatchObject({
      state: "known",
      value: { activeId: VERSION, source: "NONE", name: null },
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
