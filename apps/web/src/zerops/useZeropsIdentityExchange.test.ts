import { describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  makeZeropsApiOrigin,
  type OrganizationRef,
} from "@t3tools/client-runtime/zerops/data";
import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";

import { bindTestInvalidationBus } from "./__fixtures__/invalidationBus";
import { onZeropsInvalidation } from "./accountInvalidations";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { connectResult, webExchangePorts, type ExchangeInputs } from "./useZeropsIdentityExchange";

const mock = vi.hoisted(() => ({
  command: { _tag: "Success", value: undefined } as unknown,
  remembered: [] as Array<unknown>,
}));

vi.mock("@t3tools/client-runtime/state/runtime", async (original) => ({
  ...(await original<typeof import("@t3tools/client-runtime/state/runtime")>()),
  runAtomCommand: async () => mock.command,
}));
vi.mock("./registrationRecords", () => ({
  beginEnvironmentIdentityExchange: () => () => undefined,
  rememberRegistration: (record: unknown) => {
    mock.remembered.push(record);
  },
}));

const ENV = "env-1" as EnvironmentId;
const KEY = "project-1:service-1";

// The exchange driver's install port (`webExchangePorts`) is the one writer of the record for
// every environment it installs — and every path that can land an environment is demand on that
// one driver: the projects page's Connect, auto-connect, restore and repair. Proving this port
// writes the record correctly proves every one of those paths does.
describe("the install port writes the target's record (H12: connect, restore and repair share one write)", () => {
  it.each([
    {
      name: "a restored or repaired environment remembers its project and its organization",
      candidates: [{ key: KEY, project: { id: "project-1", clientId: "org-2", name: "shop" } }],
      activeOrganizationId: "org-1",
      record: { projectRef: { projectId: "project-1", orgId: "org-2" }, name: "shop" },
    },
    {
      name: "a project read that named no organization: the active one",
      candidates: [{ key: KEY, project: { id: "project-1", name: "shop" } }],
      activeOrganizationId: "org-1",
      record: { projectRef: { projectId: "project-1", orgId: "org-1" }, name: "shop" },
    },
    {
      name: "no organization known yet: no project ref",
      candidates: [{ key: KEY, project: { id: "project-1", name: "shop" } }],
      activeOrganizationId: undefined,
      record: { projectRef: null, name: "shop" },
    },
    {
      name: "a target the inventory no longer names is still remembered",
      candidates: [],
      activeOrganizationId: "org-1",
      record: { projectRef: null, name: null },
    },
  ])("$name", async ({ candidates, activeOrganizationId, record }) => {
    openAccountLifetime("account");
    mock.command = { _tag: "Success", value: undefined };
    mock.remembered = [];
    const inputs = { candidates, activeOrganizationId } as unknown as ExchangeInputs;
    try {
      await webExchangePorts(() => inputs).install({
        key: KEY,
        environmentId: ENV,
        credential: {
          profile: { httpBaseUrl: "https://ZCP-1-8080.prg1.zerops.app/mate" },
        } as never,
      });
      expect(mock.remembered).toEqual([
        {
          targetKey: KEY,
          environmentId: ENV,
          origin: "https://zcp-1-8080.prg1.zerops.app",
          ...record,
        },
      ]);
    } finally {
      closeAccountLifetime();
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

describe("the install port answers whether the registry took the credential", () => {
  const inputs = { candidates: [] } as unknown as ExchangeInputs;
  const install = () =>
    webExchangePorts(() => inputs).install({
      key: "project-1:service-1",
      environmentId: ENV,
      credential: { profile: { httpBaseUrl: "https://zcp-1-8080.prg1.zerops.app/mate" } } as never,
    });

  it.each([
    { name: "registered", command: { _tag: "Success", value: undefined }, ok: true },
    { name: "refused by the registry", command: { _tag: "Failure" }, ok: false },
  ])("$name", async ({ command, ok }) => {
    openAccountLifetime("account");
    mock.command = command;
    mock.remembered = [];
    try {
      await expect(install()).resolves.toEqual({ ok });
      expect(mock.remembered).toHaveLength(ok ? 1 : 0);
    } finally {
      closeAccountLifetime();
    }
  });
});

describe("the presence port asks for the target's organization's inventory (DESIGN §6.2)", () => {
  const organizationRef = (organizationId: string): OrganizationRef => ({
    kind: "organization",
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account"),
    },
    organizationId: ZeropsOrganizationId.make(organizationId),
  });

  it.each([
    {
      name: "a listed target: its project's organization",
      candidates: [{ key: "project-1:service-1", project: { id: "project-1", clientId: "org-2" } }],
      activeOrganizationId: "org-1",
      heard: [{ topic: "inventory", organization: organizationRef("org-2") }],
    },
    {
      name: "a target the inventory no longer names: the active organization",
      candidates: [],
      activeOrganizationId: "org-1",
      heard: [{ topic: "inventory", organization: organizationRef("org-1") }],
    },
    {
      name: "no organization to ask",
      candidates: [],
      activeOrganizationId: undefined,
      heard: [],
    },
  ])("$name", async ({ candidates, activeOrganizationId, heard: expected }) => {
    vi.useFakeTimers();
    openAccountLifetime("account");
    const bus = bindTestInvalidationBus();
    const heard: Array<Invalidation> = [];
    const stop = onZeropsInvalidation((invalidation) => heard.push(invalidation));
    const inputs = {
      candidates,
      activeOrganizationId,
      organizationRef,
    } as unknown as ExchangeInputs;
    try {
      webExchangePorts(() => inputs).refreshPresence("project-1:service-1");
      await vi.advanceTimersByTimeAsync(250);
      expect(heard).toEqual(expected);
    } finally {
      stop();
      bus.close();
      closeAccountLifetime();
      vi.useRealTimers();
    }
  });
});
