import { describe, expect, it } from "@effect/vitest";

import {
  decodeEntityDirectResponse,
  decodeEntityQueryResponse,
  decodeNativeFrame,
  decodeProjectCommandResponse,
  decodeRegistrationResponse,
  decodeRestartServiceResponse,
} from "./platformProtocol.ts";
import {
  AccountEpoch,
  DispatchOrdinal,
  InterestEpoch,
  InterestKey,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ReceiverEpoch,
  ZeropsAccountId,
  ZeropsCommandAttemptId,
  ZeropsOrganizationId,
  ZeropsProcessId,
  ZeropsProjectId,
  ZeropsReceiverId,
  ZeropsRequestId,
  ZeropsServiceId,
  ZeropsWireSubscriptionName,
  makeZeropsApiOrigin,
  type AccountRef,
  type EntityQueryDescriptor,
  type InterestIdentity,
  type OrganizationRef,
  type PlatformCommand,
  type ReadTicket,
  type RegistrationRequest,
} from "./types.ts";

const account: AccountRef = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account"),
};
const organization: OrganizationRef = {
  kind: "organization",
  account,
  organizationId: ZeropsOrganizationId.make("org"),
};
const project = {
  kind: "project" as const,
  organization,
  projectId: ZeropsProjectId.make("project"),
};
const receiver = {
  accountEpoch: AccountEpoch.make(1),
  receiverEpoch: ReceiverEpoch.make(1),
  receiverId: ZeropsReceiverId.make("receiver"),
};
const interest: InterestIdentity = {
  receiver,
  interestEpoch: InterestEpoch.make(1),
  key: InterestKey.make("interest"),
};
const processStatuses = [
  "PENDING",
  "RUNNING",
  "ROLLBACKING",
  "CANCELING",
  "FINISHED",
  "FAILED",
  "CANCELED",
] as const;
const restartCommand: PlatformCommand = {
  kind: "restart-service",
  service: {
    kind: "service",
    project,
    serviceId: ZeropsServiceId.make("service"),
  },
  attemptId: ZeropsCommandAttemptId.make("restart-attempt"),
  accountEpoch: AccountEpoch.make(1),
  startedAtReceiptOrdinal: ReceiptOrdinal.make(7),
  dispatchOrdinal: DispatchOrdinal.make(8),
};

function ticket(descriptor: EntityQueryDescriptor): ReadTicket {
  return {
    kind: "baseline",
    requestId: ZeropsRequestId.make("request"),
    owner: { kind: "interest", identity: interest },
    target: { kind: "query", descriptor },
    receiptOrdinalAtStart: ReceiptOrdinal.make(0),
    membershipReceiptOrdinalAtStart: ReceiptOrdinal.make(0),
    readStartOrdinal: ReadStartOrdinal.make(1),
    dispatchOrdinal: DispatchOrdinal.make(1),
    startedAtMs: 0,
  };
}

function directProcessTicket(status = "RUNNING"): ReadTicket {
  return {
    kind: "direct",
    requestId: ZeropsRequestId.make(`process-${status}`),
    owner: { kind: "interest", identity: interest },
    target: {
      kind: "process",
      ref: {
        kind: "process",
        project,
        processId: ZeropsProcessId.make("process"),
      },
    },
    receiptOrdinalAtStart: ReceiptOrdinal.make(0),
    readStartOrdinal: ReadStartOrdinal.make(1),
    dispatchOrdinal: DispatchOrdinal.make(1),
    startedAtMs: 0,
  };
}

function registration(
  descriptor: EntityQueryDescriptor,
  name = "opaque::chosen-by-runtime",
): RegistrationRequest {
  return {
    identity: interest,
    subscriptionName: ZeropsWireSubscriptionName.make(name),
    descriptor: { kind: "query-membership", query: descriptor },
    baselineTicket: ticket(descriptor),
  } as RegistrationRequest;
}

describe("Zerops platform protocol decoding", () => {
  it("decodes Project search rows into explicit facets and exhaustive non-atomic coverage", () => {
    const descriptor = {
      kind: "projects-of-organization" as const,
      organization,
      statuses: ["ACTIVE"],
      schemaVersion: 1 as const,
    };
    const result = decodeEntityQueryResponse(
      descriptor,
      ticket(descriptor),
      {
        items: [
          {
            id: "project",
            name: "Mate",
            status: "ACTIVE",
            created: "2026-09-07T00:00:00Z",
            description: null,
            tagList: ["mate"],
            _version: 7,
            envList: [{ key: "SECRET", content: "not admitted" }],
          },
        ],
        limit: 100,
        offset: 0,
        totalHits: 1,
      },
      "indexed-search",
    );

    expect(result.issues).toEqual([]);
    expect(result.observations.map((observation) => observation.kind)).toEqual([
      "project-identity-observed",
      "project-lifecycle-observed",
      "project-presentation-observed",
      "query-baseline-observed",
    ]);
    expect(result.observations).not.toContainEqual(
      expect.objectContaining({ envList: expect.anything() }),
    );
    expect(result.observations.at(-1)).toMatchObject({
      coverage: {
        kind: "exhausted-traversal",
        observedTotal: 1,
        guarantee: "non-atomic",
      },
    });
  });

  it("keeps good rows but marks coverage partial when one required row is malformed", () => {
    const descriptor = {
      kind: "services-of-project" as const,
      project,
      schemaVersion: 1 as const,
    };
    const result = decodeEntityQueryResponse(
      descriptor,
      ticket(descriptor),
      {
        list: [
          { id: "service-1", name: "app", status: "ACTIVE", projectId: "project" },
          { id: "service-2", status: "ACTIVE", projectId: "project" },
        ],
        totalCount: 2,
      },
      "direct-read",
    );

    expect(result.issues).toEqual([
      expect.objectContaining({ kind: "malformed-row", rowIndex: 1 }),
    ]);
    expect(result.observations.at(-1)).toMatchObject({
      kind: "query-baseline-observed",
      coverage: { kind: "partial", reason: "malformed" },
    });
  });

  it("rejects blank top-level and metadata ids without throwing from branded constructors", () => {
    const cases = [
      {
        descriptor: {
          kind: "projects-of-organization" as const,
          organization,
          statuses: [] as const,
          schemaVersion: 1 as const,
        },
        row: { id: " ", name: "Mate", status: "ACTIVE" },
      },
      {
        descriptor: {
          kind: "services-of-project" as const,
          project,
          schemaVersion: 1 as const,
        },
        row: { id: "", projectId: "project", name: "app", status: "ACTIVE" },
      },
      {
        descriptor: {
          kind: "process-history-window" as const,
          project,
          limit: 10,
          before: null,
          schemaVersion: 1 as const,
        },
        row: {
          id: "\t",
          projectId: "project",
          actionName: "stack.restart",
          created: "2026-09-07T00:00:00Z",
          status: "RUNNING",
        },
      },
      {
        descriptor: {
          kind: "services-of-project" as const,
          project,
          schemaVersion: 1 as const,
        },
        row: { id: "service", projectId: "project", name: "app", status: "ACTIVE", rootId: "" },
      },
      {
        descriptor: {
          kind: "process-history-window" as const,
          project,
          limit: 10,
          before: null,
          schemaVersion: 1 as const,
        },
        row: {
          id: "process",
          projectId: "project",
          actionName: "stack.restart",
          created: "2026-09-07T00:00:00Z",
          status: "RUNNING",
          parentId: " parent",
        },
      },
    ];

    for (const { descriptor, row } of cases) {
      const decode = () =>
        decodeEntityQueryResponse(
          descriptor,
          ticket(descriptor),
          { items: [row], limit: 1, offset: 0, totalHits: 1 },
          "indexed-search",
        );
      expect(decode).not.toThrow();
      expect(decode().issues).toEqual([
        expect.objectContaining({ kind: "malformed-row", rowIndex: 0 }),
      ]);
      expect(decode().observations.at(-1)).toMatchObject({
        kind: "query-baseline-observed",
        coverage: { kind: "partial", reason: "malformed" },
      });
    }
  });

  it("reports contradictory totals instead of treating a short page as complete", () => {
    const descriptor = {
      kind: "projects-of-organization" as const,
      organization,
      statuses: [],
      schemaVersion: 1 as const,
    };
    const result = decodeEntityQueryResponse(
      descriptor,
      ticket(descriptor),
      {
        items: [{ id: "project", name: "Mate", status: "ACTIVE" }],
        limit: 1,
        offset: 1,
        totalHits: 1,
      },
      "indexed-search",
    );
    expect(result.observations.at(-1)).toMatchObject({
      coverage: { kind: "partial", reason: "contradictory-total" },
    });
  });

  it("routes arbitrary names through the registry and decodes list deletes as membership only", () => {
    const descriptor = {
      kind: "running-processes-of-project" as const,
      project,
      statuses: ["PENDING", "RUNNING"] as const,
      schemaVersion: 1 as const,
    };
    const request = registration(descriptor, "name/that-is-not-parsed");
    const decoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: request.subscriptionName,
        data: { add: ["process-a"], delete: ["process-b"] },
      }),
      new Map([[request.subscriptionName, request]]),
    );

    expect(decoded).toMatchObject({ kind: "observations" });
    if (decoded.kind !== "observations") throw new Error("expected observations");
    expect(decoded.observations.map((observation) => observation.kind)).toEqual([
      "query-membership-observed",
      "query-membership-observed",
    ]);
    expect(decoded.observations).not.toContainEqual(
      expect.objectContaining({ kind: "entity-unavailable" }),
    );
  });

  it("rejects blank native membership ids as a malformed frame", () => {
    const descriptor = {
      kind: "services-of-project" as const,
      project,
      schemaVersion: 1 as const,
    };
    const request = registration(descriptor);

    expect(
      decodeNativeFrame(
        JSON.stringify({
          type: "search",
          subscriptionName: request.subscriptionName,
          data: { add: [" "], delete: [] },
        }),
        new Map([[request.subscriptionName, request]]),
      ),
    ).toMatchObject({ kind: "malformed", subscriptionName: request.subscriptionName });
  });

  it.each(processStatuses)("admits Process status %s on the update stream", (wireStatus) => {
    const request: RegistrationRequest = {
      identity: interest,
      subscriptionName: ZeropsWireSubscriptionName.make("process-update"),
      descriptor: { kind: "entity-updates", entity: "process", organization },
      baselineTicket: null,
    };
    const decoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: request.subscriptionName,
        data: {
          update: [
            {
              id: "process",
              projectId: "project",
              status: wireStatus,
              actionName: "restart",
              created: "2026-09-07T00:00:00Z",
            },
          ],
        },
      }),
      new Map([[request.subscriptionName, request]]),
    );
    if (decoded.kind !== "observations") throw new Error("expected observations");
    expect(decoded.observations).toContainEqual(
      expect.objectContaining({
        kind: "process-lifecycle-observed",
        observation: expect.objectContaining({ fields: { status: wireStatus } }),
      }),
    );
  });

  it("decodes every Process status from indexed search, direct lists, and direct entities", () => {
    const descriptor = {
      kind: "process-history-window" as const,
      project,
      limit: processStatuses.length,
      before: null,
      schemaVersion: 1 as const,
    };
    const rows = processStatuses.map((status, index) => ({
      id: `process-${index}`,
      projectId: "project",
      status,
      actionName: "restart",
      created: "2026-09-07T00:00:00Z",
    }));
    for (const [source, envelope] of [
      ["indexed-search", { items: rows, limit: rows.length, offset: 0, totalHits: rows.length }],
      ["direct-read", { list: rows, totalCount: rows.length }],
    ] as const) {
      const decoded = decodeEntityQueryResponse(descriptor, ticket(descriptor), envelope, source);
      expect(decoded.issues).toEqual([]);
      expect(
        decoded.observations
          .filter((observation) => observation.kind === "process-lifecycle-observed")
          .map((observation) => observation.observation.fields.status),
      ).toEqual(processStatuses);
    }

    for (const status of processStatuses) {
      const direct = directProcessTicket(status);
      const decoded = decodeEntityDirectResponse(direct, {
        id: "process",
        projectId: "project",
        status,
        actionName: "restart",
        created: "2026-09-07T00:00:00Z",
      });
      expect(decoded.issues).toEqual([]);
      expect(decoded.observations).toContainEqual(
        expect.objectContaining({
          kind: "process-lifecycle-observed",
          observation: expect.objectContaining({ fields: { status } }),
        }),
      );
    }
  });

  it("preserves an unknown Process status without mapping it to idle or success", () => {
    const request: RegistrationRequest = {
      identity: interest,
      subscriptionName: ZeropsWireSubscriptionName.make("process-update"),
      descriptor: { kind: "entity-updates", entity: "process", organization },
      baselineTicket: null,
    };
    const decoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: request.subscriptionName,
        data: {
          update: [
            {
              id: "process",
              projectId: "project",
              status: "PAUSING",
              actionName: "restart",
              created: "2026-09-07T00:00:00Z",
            },
          ],
        },
      }),
      new Map([[request.subscriptionName, request]]),
    );
    if (decoded.kind !== "observations") throw new Error("expected observations");
    expect(decoded.observations).toContainEqual(
      expect.objectContaining({
        observation: expect.objectContaining({
          fields: { status: { kind: "unknown", raw: "PAUSING" } },
        }),
      }),
    );
  });

  it("returns an issue for invalid ids in a direct Process body", () => {
    const decode = () =>
      decodeEntityDirectResponse(directProcessTicket(), {
        id: "process",
        projectId: "project",
        serviceStackId: "service",
        serviceStacks: [{ id: "" }],
        status: "RUNNING",
        actionName: "stack.restart",
        created: "2026-09-07T00:00:00Z",
      });

    expect(decode).not.toThrow();
    expect(decode()).toEqual({
      observations: [],
      issues: [expect.objectContaining({ kind: "malformed-row" })],
    });
  });

  it("skips an embedded serviceStacks entry without an id, keeping the Process observations", () => {
    const result = decodeEntityDirectResponse(directProcessTicket(), {
      id: "process",
      projectId: "project",
      serviceStackId: "service",
      serviceStacks: [{}, { id: "service" }],
      status: "RUNNING",
      actionName: "stack.restart",
      created: "2026-09-07T00:00:00Z",
    });

    expect(result.issues).toEqual([expect.objectContaining({ kind: "malformed-row" })]);
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "process-identity-observed",
          observation: expect.objectContaining({
            fields: expect.objectContaining({ serviceIds: ["service"] }),
          }),
        }),
      ]),
    );
  });

  it("accepts a null lastUpdate on a direct Process body as absent source metadata", () => {
    const result = decodeEntityDirectResponse(directProcessTicket(), {
      id: "process",
      projectId: "project",
      status: "RUNNING",
      actionName: "stack.restart",
      created: "2026-09-07T00:00:00Z",
      lastUpdate: null,
    });

    expect(result.issues).toEqual([]);
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "process-lifecycle-observed",
          observation: expect.objectContaining({ metadata: {} }),
        }),
      ]),
    );
  });

  it.each([
    ["embedded service", { serviceStacks: [{ id: " " }] }],
    ["top-level service", { serviceStackId: "" }],
    ["pipeline build service", { appVersion: { build: { serviceStackId: " bad" } } }],
    [
      "pipeline prepare service",
      { appVersion: { prepareCustomRuntime: { serviceStackId: " bad" } } },
    ],
    ["root metadata", { rootId: "bad " }],
  ])("reports a malformed Process update with an invalid %s id", (_label, invalidFields) => {
    const request: RegistrationRequest = {
      identity: interest,
      subscriptionName: ZeropsWireSubscriptionName.make("invalid-process-update"),
      descriptor: { kind: "entity-updates", entity: "process", organization },
      baselineTicket: null,
    };
    const decode = () =>
      decodeNativeFrame(
        JSON.stringify({
          type: "search",
          subscriptionName: request.subscriptionName,
          data: {
            update: [
              {
                id: "process",
                projectId: "project",
                status: "RUNNING",
                actionName: "stack.restart",
                created: "2026-09-07T00:00:00Z",
                ...invalidFields,
              },
            ],
          },
        }),
        new Map([[request.subscriptionName, request]]),
      );

    expect(decode).not.toThrow();
    expect(decode()).toMatchObject({
      kind: "observations",
      observations: [],
      issues: [expect.objectContaining({ kind: "malformed-row", rowIndex: 0 })],
    });
  });

  it("decodes the measured direct restart Process as command-linked entity facets", () => {
    const result = decodeRestartServiceResponse(restartCommand, {
      id: "independent-process-id",
      projectId: "project",
      serviceStackId: "service",
      serviceStacks: [{ id: "service" }],
      actionName: "stack.restart",
      status: "PENDING",
      sequence: 0,
      created: "2026-09-04T12:41:00.728Z",
      lastUpdate: "2026-09-04T12:41:00.728Z",
      started: null,
      finished: null,
      appVersion: null,
    });

    expect(result.issues).toEqual([]);
    expect(result.processRefs).toEqual([
      {
        kind: "process",
        project,
        processId: "independent-process-id",
      },
    ]);
    expect(result.observations.map((observation) => observation.kind)).toEqual([
      "process-identity-observed",
      "process-lifecycle-observed",
      "process-pipeline-observed",
    ]);
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "process-identity-observed",
          ref: expect.objectContaining({ processId: "independent-process-id" }),
          observation: expect.objectContaining({
            source: "command-response",
            command: restartCommand,
            fields: expect.objectContaining({
              actionName: "stack.restart",
              serviceIds: ["service"],
            }),
            metadata: { lastUpdate: "2026-09-04T12:41:00.728Z", sequence: 0 },
          }),
        }),
      ]),
    );
  });

  it("rejects a restart body that cannot prove the returned Process belongs to the command", () => {
    const result = decodeRestartServiceResponse(restartCommand, {
      id: "unrelated-process",
      projectId: "project",
      serviceStackId: "another-service",
      actionName: "stack.restart",
      status: "PENDING",
      created: "2026-09-04T12:41:00.728Z",
    });

    expect(result).toEqual({
      processRefs: [],
      observations: [],
      issues: [expect.objectContaining({ kind: "malformed-row" })],
    });
  });

  it("turns a validated Project mutation response into command-linked facets", () => {
    const command: PlatformCommand = {
      kind: "name-project-agent",
      project,
      name: "Ada",
      attemptId: ZeropsCommandAttemptId.make("name-attempt"),
      accountEpoch: AccountEpoch.make(1),
      startedAtReceiptOrdinal: ReceiptOrdinal.make(2),
      dispatchOrdinal: DispatchOrdinal.make(3),
    };
    const result = decodeProjectCommandResponse(command, {
      id: "project",
      name: "application",
      status: "ACTIVE",
      tagList: ["mate", "mate:bot:Ada"],
    });

    expect(result.issues).toEqual([]);
    expect(result.observations.map((observation) => observation.kind)).toEqual([
      "project-identity-observed",
      "project-lifecycle-observed",
      "project-presentation-observed",
    ]);
    expect(result.observations[0]).toMatchObject({
      ref: project,
      observation: { source: "command-response", command },
    });
  });

  it("rejects a Project mutation response for another project", () => {
    const command: PlatformCommand = {
      kind: "update-project-group-tags",
      project,
      next: {},
      attemptId: ZeropsCommandAttemptId.make("tags-attempt"),
      accountEpoch: AccountEpoch.make(1),
      startedAtReceiptOrdinal: ReceiptOrdinal.make(2),
      dispatchOrdinal: DispatchOrdinal.make(3),
    };
    expect(
      decodeProjectCommandResponse(command, {
        id: "other-project",
        name: "application",
        status: "ACTIVE",
      }),
    ).toEqual({
      observations: [],
      issues: [expect.objectContaining({ kind: "malformed-row" })],
    });
  });

  it.each([
    ["process", { id: " " }],
    ["parent metadata", { parentId: "" }],
    ["embedded service", { serviceStacks: [{ id: " service" }] }],
  ])("rejects a restart response with an invalid %s id", (_label, invalidFields) => {
    const decode = () =>
      decodeRestartServiceResponse(restartCommand, {
        id: "process",
        projectId: "project",
        serviceStackId: "service",
        actionName: "stack.restart",
        status: "PENDING",
        created: "2026-09-04T12:41:00.728Z",
        ...invalidFields,
      });

    expect(decode).not.toThrow();
    expect(decode()).toEqual({
      processRefs: [],
      observations: [],
      issues: [expect.objectContaining({ kind: "malformed-row" })],
    });
  });

  it("keeps current and history registrations distinct and enforces data.items vs data.update", () => {
    const currentName = ZeropsWireSubscriptionName.make("metric-current");
    const historyName = ZeropsWireSubscriptionName.make("metric-history");
    const current = {
      identity: interest,
      subscriptionName: currentName,
      descriptor: {
        kind: "current-metrics" as const,
        query: {
          kind: "current-metrics-of-project" as const,
          project,
          groupBy: "containerId" as const,
          schemaVersion: 1 as const,
        },
      },
      baselineTicket: ticket({
        kind: "services-of-project",
        project,
        schemaVersion: 1,
      }),
    } as RegistrationRequest;
    const history = {
      identity: interest,
      subscriptionName: historyName,
      descriptor: {
        kind: "metric-history" as const,
        query: {
          kind: "metric-history-of-project" as const,
          project,
          groupBy: "serviceStackId" as const,
          window: { timeGroupBy: "1m" as const, limit: 10, timeZone: "UTC" },
          schemaVersion: 1 as const,
        },
      },
      baselineTicket: ticket({
        kind: "services-of-project",
        project,
        schemaVersion: 1,
      }),
    } as RegistrationRequest;
    const registry = new Map([
      [currentName, current],
      [historyName, history],
    ]);
    const currentDecoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: currentName,
        data: {
          items: [
            {
              serviceStackId: "service",
              containerId: "container",
              vCpu: { used: 0.1, limit: 1 },
            },
          ],
        },
      }),
      registry,
    );
    const historyDecoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: historyName,
        data: {
          update: [
            {
              serviceStackId: "service",
              from: "2026-09-07T00:00:00Z",
              till: "2026-09-07T00:00:59Z",
              billingEnabled: true,
              vCpuUsed: 0.1,
              vCpuLimit: 1,
            },
          ],
        },
      }),
      registry,
    );
    expect(currentDecoded).toMatchObject({
      kind: "observations",
      observations: [expect.objectContaining({ kind: "current-metrics-replaced" })],
    });
    expect(historyDecoded).toMatchObject({
      kind: "observations",
      observations: [expect.objectContaining({ kind: "metric-history-window-observed" })],
    });
    expect(
      decodeNativeFrame(
        JSON.stringify({ type: "search", subscriptionName: currentName, data: { update: [] } }),
        registry,
      ),
    ).toMatchObject({ kind: "malformed" });
  });

  it("consumes a query registration response into observations", () => {
    const descriptor = {
      kind: "services-of-project" as const,
      project,
      schemaVersion: 1 as const,
    };
    const result = decodeRegistrationResponse(registration(descriptor), {
      items: [{ id: "service", name: "app", status: "ACTIVE", projectId: "project" }],
      limit: 500,
      offset: 0,
      totalHits: 1,
    });
    expect(result.issues).toEqual([]);
    expect(result.observations.at(-1)).toMatchObject({ kind: "query-baseline-observed" });

    const malformed = decodeRegistrationResponse(registration(descriptor), {
      items: [{ id: " ", name: "app", status: "ACTIVE", projectId: "project" }],
      limit: 500,
      offset: 0,
      totalHits: 1,
    });
    expect(malformed.issues).toEqual([
      expect.objectContaining({ kind: "malformed-row", rowIndex: 0 }),
    ]);
  });

  it("requires an explicit success response for update registration", () => {
    const request: RegistrationRequest = {
      identity: interest,
      subscriptionName: ZeropsWireSubscriptionName.make("updates"),
      descriptor: { kind: "entity-updates", entity: "project", organization },
      baselineTicket: null,
    };
    expect(decodeRegistrationResponse(request, { success: true }).issues).toEqual([]);
    expect(decodeRegistrationResponse(request, {}).issues).toEqual([
      expect.objectContaining({ kind: "malformed-envelope" }),
    ]);
  });

  it("marks blank current/history metric ids malformed in registration responses", () => {
    const current = {
      identity: interest,
      subscriptionName: ZeropsWireSubscriptionName.make("invalid-current"),
      descriptor: {
        kind: "current-metrics" as const,
        query: {
          kind: "current-metrics-of-project" as const,
          project,
          groupBy: "containerId" as const,
          schemaVersion: 1 as const,
        },
      },
      baselineTicket: ticket({ kind: "services-of-project", project, schemaVersion: 1 }),
    } as RegistrationRequest;
    const history = {
      identity: interest,
      subscriptionName: ZeropsWireSubscriptionName.make("invalid-history"),
      descriptor: {
        kind: "metric-history" as const,
        query: {
          kind: "metric-history-of-project" as const,
          project,
          groupBy: "serviceStackId" as const,
          window: { timeGroupBy: "1m" as const, limit: 10, timeZone: "UTC" },
          schemaVersion: 1 as const,
        },
      },
      baselineTicket: ticket({ kind: "services-of-project", project, schemaVersion: 1 }),
    } as RegistrationRequest;

    const currentResult = decodeRegistrationResponse(current, {
      items: [
        { serviceStackId: " ", containerId: "container" },
        { serviceStackId: "service", containerId: "" },
      ],
      limit: 2,
      offset: 0,
      totalHits: 2,
    });
    const historyResult = decodeRegistrationResponse(history, {
      items: [
        {
          serviceStackId: " history-service",
          from: "2026-09-07T00:00:00Z",
          till: "2026-09-07T00:00:59Z",
        },
      ],
      limit: 1,
      offset: 0,
      totalHits: 1,
    });

    expect(currentResult.issues).toHaveLength(2);
    expect(currentResult.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "malformed-row" })]),
    );
    expect(historyResult.issues).toEqual([
      expect.objectContaining({ kind: "malformed-row", rowIndex: 0 }),
    ]);
  });
});
