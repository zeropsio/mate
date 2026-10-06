import { describe, expect, it } from "@effect/vitest";

import {
  decodeEntityDirectResponse,
  decodeEntityQueryResponse,
  decodeNativeFrame,
  decodeProjectCommandResponse,
  decodeRegistrationResponse,
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
  ZeropsProjectId,
  ZeropsReceiverId,
  ZeropsRequestId,
  ZeropsServiceId,
  ZeropsWireSubscriptionName,
  makeZeropsApiOrigin,
  type AccountRef,
  type MembershipQueryDescriptor,
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
function ticket(descriptor: MembershipQueryDescriptor): ReadTicket {
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

function registration(
  descriptor: MembershipQueryDescriptor,
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

  it("drops one malformed row alone, keeping the good rows and the read whole", () => {
    const descriptor = {
      kind: "services-of-project" as const,
      project: project,
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
      members: [expect.objectContaining({ serviceId: "service-1" })],
      coverage: { kind: "exhausted-traversal" },
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
          project: project,
          schemaVersion: 1 as const,
        },
        row: { id: "", projectId: "project", name: "app", status: "ACTIVE" },
      },
      {
        descriptor: {
          kind: "services-of-project" as const,
          project: project,
          schemaVersion: 1 as const,
        },
        row: { id: "service", projectId: "project", name: "app", status: "ACTIVE", rootId: "" },
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
      // The bad row is dropped alone; the read still covers what it was handed.
      expect(decode().observations.at(-1)).toMatchObject({
        kind: "query-baseline-observed",
        members: [],
        coverage: { kind: "exhausted-traversal" },
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
      kind: "services-of-project" as const,
      project: project,
      schemaVersion: 1 as const,
    };
    const request = registration(descriptor, "name/that-is-not-parsed");
    const decoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: request.subscriptionName,
        data: { add: ["service-a"], delete: ["service-b"] },
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

  it("places bare IDs from a services-of-project frame in its requested project", () => {
    const descriptor = { kind: "services-of-project" as const, project, schemaVersion: 1 as const };
    const request = registration(descriptor);
    const decoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: request.subscriptionName,
        data: { add: ["known", "unnamed"], delete: ["gone-unnamed"] },
      }),
      new Map([[request.subscriptionName, request]]),
    );

    expect(decoded.kind).toBe("observations");
    if (decoded.kind !== "observations") return;
    expect(decoded.issues).toEqual([]);
    expect(decoded.observations).toHaveLength(3);
    for (const observation of decoded.observations)
      expect(observation).toMatchObject({
        kind: "query-membership-observed",
        member: { kind: "service", project },
      });
  });

  it("rejects blank native membership ids as a malformed frame", () => {
    const descriptor = {
      kind: "services-of-project" as const,
      project: project,
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

  it("turns a validated Project creation response into command-linked facets", () => {
    const command: PlatformCommand = {
      kind: "create-project",
      organization: project.organization,
      name: "application",
      tagList: ["mate"],
      attemptId: ZeropsCommandAttemptId.make("declare-attempt"),
      accountEpoch: AccountEpoch.make(1),
      startedAtReceiptOrdinal: ReceiptOrdinal.make(2),
      dispatchOrdinal: DispatchOrdinal.make(3),
    };
    const result = decodeProjectCommandResponse(command, {
      id: "project",
      name: "application",
      status: "ACTIVE",
      tagList: ["mate"],
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
        project: project,
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
        project: project,
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
      project: project,
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
      baselineTicket: ticket({
        kind: "services-of-project",
        project: project,
        schemaVersion: 1,
      }),
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
      baselineTicket: ticket({
        kind: "services-of-project",
        project: project,
        schemaVersion: 1,
      }),
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

describe("the datastream's deploy frames", () => {
  const updates = (entity: "service"): RegistrationRequest => ({
    identity: interest,
    subscriptionName: ZeropsWireSubscriptionName.make(`${entity}-update`),
    descriptor: { kind: "entity-updates", entity, organization, project },
    baselineTicket: null,
  });
  const decodeUpdate = (entity: "service", row: Record<string, unknown>) => {
    const request = updates(entity);
    const decoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: request.subscriptionName,
        data: { update: [row] },
      }),
      new Map([[request.subscriptionName, request]]),
    );
    if (decoded.kind !== "observations") throw new Error("expected observations");
    return decoded.observations;
  };

  it("a pushed service frame without source keeps the active deploy known", () => {
    // The measured shape: a native service frame's activeAppVersion is
    // {base, created, id, lastUpdate, os, status} — no source, no name.
    const observations = decodeUpdate("service", {
      id: "service",
      projectId: "project",
      name: "app",
      status: "ACTIVE",
      activeAppVersion: {
        base: "alpine/nodejs@22",
        created: "2026-09-23T13:59:24Z",
        id: "app-version",
        lastUpdate: "2026-09-23T14:01:27Z",
        os: null,
        status: "ACTIVE",
      },
    });

    expect(observations).toContainEqual(
      expect.objectContaining({
        kind: "service-deployment-observed",
        observation: expect.objectContaining({
          fields: {
            activeDeploy: {
              id: "app-version",
              status: "ACTIVE",
              source: null,
              activatedAt: "2026-09-23T14:01:27Z",
              name: null,
              branch: null,
              commit: null,
              tag: null,
              repository: null,
            },
          },
        }),
      }),
    );
  });
});

describe("a service read's active version name (A14)", () => {
  const SHA = "ec3d2cb9ea02144b23300dd8cd16ae02bbcb321c";
  const directService: ReadTicket = {
    kind: "direct",
    requestId: ZeropsRequestId.make("service-read"),
    owner: { kind: "interest", identity: interest },
    target: {
      kind: "service",
      ref: { kind: "service", project, serviceId: ZeropsServiceId.make("service") },
    },
    receiptOrdinalAtStart: ReceiptOrdinal.make(0),
    readStartOrdinal: ReadStartOrdinal.make(1),
    dispatchOrdinal: DispatchOrdinal.make(1),
    startedAtMs: 0,
  };
  const userData = (appVersionId: string) => [
    { key: "appVersionId", content: appVersionId },
    { key: "appVersionName", content: `${SHA} v1.4.0 ada` },
    { key: "hostname", content: "app" },
  ];

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly userData: ReadonlyArray<{ readonly key: string; readonly content: string }> | null;
    readonly expected: string | null;
  }> = [
    {
      name: "names it from userData while userData's version is the active one",
      userData: userData("app-version"),
      expected: `${SHA} v1.4.0 ada`,
    },
    {
      // A build that started names the version it builds, ~63 s before it is active.
      name: "leaves it unstated while userData names a version still building",
      userData: userData("app-version-building"),
      expected: null,
    },
    { name: "leaves it unstated without userData", userData: null, expected: null },
  ];

  it.each(cases)("$name", ({ userData, expected }) => {
    const decoded = decodeEntityDirectResponse(directService, {
      id: "service",
      projectId: "project",
      name: "app",
      status: "ACTIVE",
      activeAppVersion: {
        id: "app-version",
        status: "ACTIVE",
        source: "CLI",
        created: "2026-09-23T13:59:24Z",
        lastUpdate: "2026-09-23T14:01:27Z",
      },
      ...(userData === null ? {} : { userData }),
    });

    expect(decoded.issues).toEqual([]);
    expect(decoded.observations).toContainEqual(
      expect.objectContaining({
        kind: "service-deployment-observed",
        observation: expect.objectContaining({
          fields: { activeDeploy: expect.objectContaining({ id: "app-version", name: expected }) },
        }),
      }),
    );
  });
});

it.each(["READ_ONLY", "NO_ACCESS"])(
  "preserves %s project grants in the direct answer used by admission",
  (roleCode) => {
    const ticket: ReadTicket = {
      requestId: ZeropsRequestId.make("project-grants"),
      owner: { kind: "interest", identity: interest },
      receiptOrdinalAtStart: ReceiptOrdinal.make(0),
      readStartOrdinal: ReadStartOrdinal.make(1),
      dispatchOrdinal: DispatchOrdinal.make(1),
      startedAtMs: 0,
      kind: "direct",
      target: { kind: "project", ref: project },
    };
    const userRoles = [{ clientUserId: "member", roleCode }];
    expect(
      decodeEntityDirectResponse(ticket, {
        id: project.projectId,
        name: "Mate",
        status: "ACTIVE",
        userRoles,
      }).project?.userRoles,
    ).toEqual(userRoles);
  },
);
