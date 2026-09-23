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
import { MATES_UNREAD, zeropsMateAt, type ZeropsMateIdentity } from "./mateIdentities";
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
  const CONNECTED_NOBODY: ZeropsCandidatePresentation = {
    ...READY,
    project: {
      ...PROJECT,
      id: "project-3",
      name: "api",
      tagList: ["mate:g:aaa", "mate:role:stage"],
    },
    group: "connected",
    environmentId: otherEnvironmentId,
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
  const FEN: ZeropsMateIdentity = {
    name: "Fen",
    tint: "slate",
    project: undefined,
    projectUrl: "https://app.zerops.io/project/project-9",
    connected: false,
  };
  const publication = (input: Partial<Parameters<typeof candidatesPublication>[0]>) =>
    candidatesPublication({
      status: "signed-in",
      listing: unread,
      registeredOrigins: new Map(),
      published: { names: null, mates: MATES_UNREAD },
      ...input,
    });
  const whoLivesAt = (
    published: ReturnType<typeof candidatesPublication>,
    at: EnvironmentId,
  ): string => (published.kind === "publish" ? zeropsMateAt(published.mates, at).kind : "held");

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
      mates: { complete: true },
    });
    expect(whoLivesAt(published, environmentId)).toBe("mate");
  });

  it("a known, complete listing of no Mate publishes that nobody lives anywhere", () => {
    const published = publication({
      listing: known([]),
      published: {
        names: new Map([[otherEnvironmentId, "docs"]]),
        mates: { decided: new Map([[otherEnvironmentId, FEN]]), complete: true },
      },
    });

    expect(published).toMatchObject({ kind: "publish", names: new Map() });
    expect(whoLivesAt(published, otherEnvironmentId)).toBe("nobody");
  });

  it("a listing not read in full adds who it has read to what was published, and drops nobody it has not read", () => {
    const published = publication({
      listing: known([CONNECTED_MATE, PRESENCE_UNKNOWN]),
      published: {
        names: new Map([[otherEnvironmentId, "docs"]]),
        mates: { decided: new Map([[otherEnvironmentId, FEN]]), complete: true },
      },
    });

    expect(published).toMatchObject({
      kind: "publish",
      names: new Map([
        [otherEnvironmentId, "docs"],
        [environmentId, "kanban"],
      ]),
      mates: { complete: true },
    });
    expect(whoLivesAt(published, otherEnvironmentId)).toBe("mate");
    expect(whoLivesAt(published, environmentId)).toBe("mate");
  });

  it("a listing not read in full, over a Mate list never read, leaves every environment it has not read unknown", () => {
    const published = publication({ listing: known([CONNECTED_NOBODY, PRESENCE_UNKNOWN]) });

    expect(published).toMatchObject({ kind: "publish", mates: { complete: false } });
    expect(whoLivesAt(published, otherEnvironmentId)).toBe("nobody");
    expect(whoLivesAt(published, environmentId)).toBe("unknown");
  });

  it("a listing not read in full drops a Mate whose read row no longer holds one", () => {
    const published = publication({
      listing: known([CONNECTED_NOBODY, PRESENCE_UNKNOWN]),
      published: {
        names: null,
        mates: { decided: new Map([[otherEnvironmentId, FEN]]), complete: false },
      },
    });

    expect(whoLivesAt(published, otherEnvironmentId)).toBe("nobody");
  });

  it.each(["loading", "totp-required", "unavailable"] as const)(
    "a session that is %s publishes nothing, whatever the listing holds",
    (status) => {
      expect(publication({ status })).toEqual({ kind: "hold" });
      expect(publication({ status, listing: known([]) })).toEqual({ kind: "hold" });
    },
  );

  it("a signed-out session forgets every name and Mate rather than saying nobody lives anywhere", () => {
    expect(publication({ status: "signed-out", listing: known([]) })).toEqual({ kind: "forget" });
  });
});
