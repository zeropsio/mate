import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { deriveZeropsCandidates } from "@t3tools/client-runtime/zerops/candidates";
import {
  interestKeyOf,
  makeInitialZeropsDataState,
  selectProjectsOf,
  ReceiptOrdinal,
  selectServicesOf,
  type InterestState,
} from "@t3tools/client-runtime/zerops/data";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";

import { identity, organization, project, scope } from "./__fixtures__/platformData";
import {
  authenticatedZeropsOrigins,
  candidatesPublication,
  sameProjectsRead,
  sameServicesRead,
  withZeropsConnection,
  type ZeropsCandidatePresentation,
} from "./useZeropsCandidates";

const PROJECT: ZeropsProject = {
  id: "project-1",
  name: "kanban",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

const SERVICE: ZeropsService = {
  id: "service-1",
  name: "zcp",
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080, httpSupport: true }],
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
};

const READY = {
  ...deriveZeropsCandidates(PROJECT, [SERVICE], new Map())[0]!,
  presence: "known" as const,
};

describe("authenticatedZeropsOrigins", () => {
  it("does not group a registered same-origin environment as connected until it authenticates", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const registeredButRejected = authenticatedZeropsOrigins([
      {
        environmentId,
        displayUrl: "https://zcp-24cb-8080.prg1.zerops.app/mate",
        connection: { phase: "error" },
      },
    ]);

    expect(withZeropsConnection(READY, registeredButRejected)).toMatchObject({
      group: "ready",
      containerOrigin: "https://zcp-24cb-8080.prg1.zerops.app",
    });

    const authenticated = authenticatedZeropsOrigins([
      {
        environmentId,
        displayUrl: "https://zcp-24cb-8080.prg1.zerops.app/mate",
        connection: { phase: "connected" },
      },
    ]);

    expect(withZeropsConnection(READY, authenticated)).toMatchObject({
      group: "connected",
      environmentId,
    });
  });
});

describe("a held read", () => {
  const establishing = (key: InterestState["identity"]["key"]): InterestState => ({
    status: "establishing",
    identity: { ...identity(), key },
    startedAtMs: 0,
    deadlineMs: 60_000,
    progress: {
      requiredRegistrations: 1,
      completedRegistrations: 0,
      requiredReads: 1,
      completedReads: 0,
      crossedReceiptOrdinal: ReceiptOrdinal.make(0),
    },
  });
  const failed = (from: InterestState): InterestState => ({
    status: "failed",
    identity: from.identity,
    reason: "gateway",
    retryable: true,
    attempts: 1,
    retryAtMs: 90_000,
  });

  it("changes when its projects' interest fails, though the query did not", () => {
    const read = selectProjectsOf(makeInitialZeropsDataState(scope()), organization);
    const feeder = establishing(interestKeyOf({ kind: "organization-inventory", organization }));
    const before = { ...read, observation: { ...read.observation, required: [feeder] } };
    const after = { ...read, observation: { ...read.observation, required: [failed(feeder)] } };

    expect(sameProjectsRead(before, after)).toBe(false);
  });

  it("holds when only an interest that does not feed it changes", () => {
    const read = selectProjectsOf(makeInitialZeropsDataState(scope()), organization);
    const other = establishing(
      interestKeyOf({ kind: "project-topology", project: project(), includeCurrentMetrics: false }),
    );
    const before = { ...read, observation: { ...read.observation, required: [other] } };
    const after = { ...read, observation: { ...read.observation, required: [failed(other)] } };

    expect(sameProjectsRead(before, after)).toBe(true);
  });

  it("changes when its services' interest fails, though the query did not", () => {
    const read = selectServicesOf(makeInitialZeropsDataState(scope()), project());
    const feeder = establishing(interestKeyOf({ kind: "project-inventory", project: project() }));
    const before = { ...read, observation: { ...read.observation, required: [feeder] } };
    const after = { ...read, observation: { ...read.observation, required: [failed(feeder)] } };

    expect(sameServicesRead(before, after)).toBe(false);
  });
});

describe("candidatesPublication", () => {
  const environmentId = EnvironmentId.make("environment-1");
  const otherEnvironmentId = EnvironmentId.make("environment-2");
  const CONNECTED_MATE: ZeropsCandidatePresentation = {
    ...READY,
    project: { ...PROJECT, tagList: ["mate:bot:fen"] },
    group: "connected",
    environmentId,
  };
  const PRESENCE_UNKNOWN: ZeropsCandidatePresentation = {
    key: "project-2",
    project: { ...PROJECT, id: "project-2", name: "docs" },
    group: "unavailable",
    presence: "unknown",
  };
  const known = (
    value: ReadonlyArray<ZeropsCandidatePresentation>,
    coverage: "complete" | "partial" = "complete",
  ): Known<ReadonlyArray<ZeropsCandidatePresentation>> => ({
    state: "known",
    value,
    asOf: { ordinal: 2, atMs: 20 },
    coverage,
    freshness: { kind: "live" },
  });
  const unread: Known<ReadonlyArray<ZeropsCandidatePresentation>> = {
    state: "unread",
    waitingFor: null,
  };
  const FEN = {
    name: "Fen",
    tint: "slate",
    project: undefined,
    projectUrl: "https://app.zerops.io/project/project-9",
    connected: false,
  } as const;
  const publication = (input: Partial<Parameters<typeof candidatesPublication>[0]>) =>
    candidatesPublication({
      status: "signed-in",
      listing: unread,
      registeredOrigins: new Map(),
      published: { names: new Map(), mates: null },
      ...input,
    });

  it.each<{
    readonly name: string;
    readonly listing: Known<ReadonlyArray<ZeropsCandidatePresentation>>;
  }>([
    { name: "unread", listing: unread },
    { name: "being read", listing: { state: "reading", sinceMs: 10, attempt: 1 } },
    {
      name: "failed",
      listing: {
        state: "failed",
        failure: { kind: "transport", detail: "gateway" },
        atMs: 10,
        attempt: 1,
        retryAtMs: 90,
      },
    },
    { name: "known, but a row's presence is not read", listing: known([PRESENCE_UNKNOWN]) },
    { name: "known in part", listing: known([], "partial") },
  ])("a candidate listing that is $name never publishes empty environment names", ({ listing }) => {
    expect(publication({ listing })).toEqual({ kind: "hold" });
  });

  it("a known listing publishes each environment's name and who lives in it", () => {
    const published = publication({ listing: known([CONNECTED_MATE]) });

    expect(published).toMatchObject({
      kind: "publish",
      names: new Map([[environmentId, "kanban"]]),
    });
    expect(published.kind === "publish" && [...published.mates.keys()]).toEqual([environmentId]);
  });

  it("a known, complete listing of no Mate publishes that nobody lives anywhere", () => {
    expect(
      publication({
        listing: known([]),
        published: {
          names: new Map([[otherEnvironmentId, "docs"]]),
          mates: new Map([[otherEnvironmentId, FEN]]),
        },
      }),
    ).toEqual({ kind: "publish", names: new Map(), mates: new Map() });
  });

  it("a listing not read in full adds who it has read to what was published, and drops nobody", () => {
    const published = publication({
      listing: known([CONNECTED_MATE, PRESENCE_UNKNOWN]),
      published: {
        names: new Map([[otherEnvironmentId, "docs"]]),
        mates: new Map([[otherEnvironmentId, FEN]]),
      },
    });

    expect(published).toMatchObject({
      kind: "publish",
      names: new Map([
        [otherEnvironmentId, "docs"],
        [environmentId, "kanban"],
      ]),
    });
    expect(published.kind === "publish" && [...published.mates.keys()]).toEqual([
      otherEnvironmentId,
      environmentId,
    ]);
  });

  it.each(["loading", "totp-required"] as const)(
    "a session that is %s publishes nothing",
    (status) => {
      expect(publication({ status })).toEqual({ kind: "hold" });
    },
  );

  it.each(["signed-out", "unavailable"] as const)(
    "a session that is %s holds no environment and no Mate",
    (status) => {
      expect(publication({ status })).toEqual({
        kind: "publish",
        names: new Map(),
        mates: new Map(),
      });
    },
  );
});
