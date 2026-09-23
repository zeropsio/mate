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
  sameProjectsRead,
  sameServicesRead,
  withZeropsConnection,
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
