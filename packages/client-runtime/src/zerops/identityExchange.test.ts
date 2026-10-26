import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { ConnectionBlockedError, ConnectionTransientError } from "../connection/model.ts";
import { exchangeAtMate, exchangeFailureOf } from "./identityExchange.ts";

const ORIGIN = "https://zcp-ada-8080.prg1.zerops.app";
const ENV = EnvironmentId.make("env-ada");

const descriptor = (
  change: Partial<ExecutionEnvironmentDescriptor> = {},
): ExecutionEnvironmentDescriptor => ({
  environmentId: ENV,
  label: "zcp",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.16.0",
  capabilities: { repositoryIdentity: true },
  basePath: "/mate",
  zerops: { projectId: "P1", identity: "ok", identityCheckedAt: "2026-10-24T09:00:00.000Z" },
  ...change,
});

const exchange = (read: () => Promise<ExecutionEnvironmentDescriptor>) => {
  const reads: string[] = [];
  return {
    reads,
    answer: exchangeAtMate(
      {
        readDescriptor: (httpBaseUrl) => {
          reads.push(httpBaseUrl);
          return read();
        },
      },
      ORIGIN,
      { reason: "restore", orgId: "O1", projectId: "P1" },
    ),
  };
};

describe("exchangeAtMate", () => {
  it("A Mate HQ lists is registered to open through HQ, its descriptor read once and nothing minted", async () => {
    const { reads, answer } = exchange(async () => descriptor());

    expect(await answer).toMatchObject({
      ok: true,
      environmentId: ENV,
      descriptor: { environmentId: ENV, serverVersion: "0.16.0", identity: "ok" },
      credential: {
        _tag: "ZeropsMateConnectionRegistration",
        target: {
          _tag: "ZeropsMateConnectionTarget",
          environmentId: ENV,
          label: "zcp",
          orgId: "O1",
          projectId: "P1",
          httpBaseUrl: `${ORIGIN}/mate`,
        },
      },
    });
    expect(reads).toEqual([`${ORIGIN}/mate`]);
  });

  it.each([
    {
      case: "is unreachable: retryable",
      read: () => Promise.reject(new Error("offline")),
      failure: { class: "retryable", cause: { kind: "descriptor-unreachable" } },
    },
    {
      case: "names a server below the client floor: a version refusal",
      read: async () => descriptor({ serverVersion: "0.10.4" }),
      failure: { class: "refusal", reason: { kind: "version" } },
    },
    {
      case: "names another project: a mismatch refusal",
      read: async () => descriptor({ zerops: { projectId: "P2", identity: "ok" } }),
      failure: { class: "refusal", reason: { kind: "project-mismatch" } },
    },
    {
      case: "says the Mate's own key failed: retryable",
      read: async () => descriptor({ zerops: { projectId: "P1", identity: "failed" } }),
      failure: { class: "retryable", cause: { kind: "identity-failed" } },
    },
  ])("A Mate whose descriptor $case is not registered", async ({ read, failure }) => {
    expect(await exchange(read).answer).toMatchObject({ ok: false, failure });
  });
});

describe("exchangeFailureOf — transient or definitive", () => {
  it.each([
    {
      case: "a read-only refusal",
      cause: new ConnectionBlockedError({ reason: "read-only", detail: "x" }),
      failure: { class: "refusal", reason: { kind: "role" } },
    },
    {
      case: "a server below the floor",
      cause: new ConnectionBlockedError({ reason: "unsupported", detail: "x" }),
      failure: { class: "refusal", reason: { kind: "version" } },
    },
    {
      case: "a timeout",
      cause: new ConnectionTransientError({ reason: "timeout", detail: "x" }),
      failure: { class: "retryable", cause: { kind: "timeout" } },
    },
    {
      case: "an unknown throw",
      cause: new Error("x"),
      failure: { class: "retryable", cause: { kind: "network" } },
    },
  ])("reads $case", ({ cause, failure }) => {
    expect(exchangeFailureOf(cause)).toEqual(failure);
  });
});
