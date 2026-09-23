import type { EnvironmentId } from "@t3tools/contracts";
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  makeZeropsApiOrigin,
  type OrganizationRef,
} from "@t3tools/client-runtime/zerops/data";
import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import { INVALIDATION_COALESCE_MS } from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bindTestInvalidationBus } from "./__fixtures__/invalidationBus";
import { connectMate, connectResult, type MateConnectTarget } from "./accountEnvironments";
import { onZeropsInvalidation } from "./accountInvalidations";

const ENV = "env-1" as EnvironmentId;

const organizationRef = (organizationId: string): OrganizationRef => ({
  kind: "organization",
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make(organizationId),
});

afterEach(() => {
  vi.useRealTimers();
});

describe("connectMate: the user's Connect by a Mate's target key or by the origin it was seen at", () => {
  const LISTED = { key: "project-1:service-1", containerOrigin: "https://zcp-1-8080.zerops.app" };

  it.each<{
    readonly name: string;
    readonly target: MateConnectTarget;
    readonly connected: ReadonlyArray<string>;
    readonly result: object;
    readonly heard: ReadonlyArray<Invalidation>;
  }>([
    {
      name: "an origin the inventory does not list yet: retryable, and its organization is read again",
      target: { origin: "https://zcp-new-8080.zerops.app", organization: organizationRef("org-2") },
      connected: [],
      result: { _tag: "Failure", retryable: true },
      heard: [{ topic: "inventory", organization: organizationRef("org-2") }],
    },
    {
      name: "an unlisted origin with no organization named: retryable, nothing read again",
      target: { origin: "https://zcp-new-8080.zerops.app", organization: null },
      connected: [],
      result: { _tag: "Failure", retryable: true },
      heard: [],
    },
    {
      name: "a key the inventory does not list: the environments connect it",
      target: { key: "project-new:service-new" },
      connected: ["project-new:service-new"],
      result: { _tag: "Success", environmentId: ENV },
      heard: [],
    },
    {
      name: "a listed origin: the environments connect its candidate's key",
      target: { origin: "https://zcp-1-8080.zerops.app/", organization: organizationRef("org-1") },
      connected: [LISTED.key],
      result: { _tag: "Success", environmentId: ENV },
      heard: [],
    },
  ])("$name", async ({ target, connected, result, heard }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const bus = bindTestInvalidationBus();
    const invalidations: Array<Invalidation> = [];
    const stop = onZeropsInvalidation((invalidation) => invalidations.push(invalidation));
    const keys: Array<string> = [];
    const environments = {
      connect: async (key: string) => {
        keys.push(key);
        return { _tag: "Connected", environmentId: ENV } as const;
      },
    } as unknown as AccountEnvironments;
    try {
      const answer = await connectMate({
        environments,
        candidates: [LISTED],
        target,
        reason: "user",
      });
      await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS);

      expect(answer).toMatchObject(result);
      if (answer._tag === "Failure") expect(answer.error).not.toMatch(/not in your verified/);
      expect(keys).toEqual(connected);
      expect(invalidations).toEqual(heard);
    } finally {
      stop();
      bus.close();
    }
  });
});

describe("connectResult: the user's Connect as the projects page reads it", () => {
  const descriptor = {
    environmentId: ENV,
    serverVersion: "0.10.4",
    update: null,
    identity: "ok" as const,
    identityCheckedAt: null,
  };

  it.each([
    {
      name: "installed",
      outcome: { _tag: "Connected", environmentId: ENV } as const,
      result: { _tag: "Success", environmentId: ENV },
    },
    {
      name: "the role is refused: not worth trying again",
      outcome: {
        _tag: "NotConnected",
        reachability: { kind: "refused-role" },
        descriptor: null,
      } as const,
      result: {
        _tag: "Failure",
        error:
          "Could not connect to this container. You can see this project in Zerops but can't operate its Mate.",
        retryable: false,
      },
    },
    {
      name: "below the floor: the upgrade path, with the server's version",
      outcome: {
        _tag: "NotConnected",
        reachability: { kind: "update-unavailable" },
        descriptor,
      } as const,
      result: {
        _tag: "Failure",
        retryable: false,
        upgradeRequired: true,
        serverVersion: "0.10.4",
      },
    },
    {
      name: "backing off: the machine retries, and so may the page",
      outcome: {
        _tag: "NotConnected",
        reachability: {
          kind: "retrying",
          retryAtMs: Date.now() + 4_000,
          last: { kind: "server", status: 500 },
          restart: false,
        },
        descriptor: null,
      } as const,
      result: { _tag: "Failure", retryable: true },
    },
    {
      name: "the account closed",
      outcome: { _tag: "Closed" } as const,
      result: { _tag: "Failure", retryable: false },
    },
  ])("$name", ({ outcome, result }) => {
    expect(connectResult(outcome)).toMatchObject(result);
  });
});
