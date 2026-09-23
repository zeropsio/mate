import { describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  connectResult,
  rememberExchangedProjectRef,
  webExchangePorts,
  type ExchangeInputs,
} from "./useZeropsIdentityExchange";

const mock = vi.hoisted(() => ({
  command: { _tag: "Success", value: undefined } as unknown,
  remembered: [] as Array<unknown>,
}));

vi.mock("@t3tools/client-runtime/state/runtime", async (original) => ({
  ...(await original<typeof import("@t3tools/client-runtime/state/runtime")>()),
  runAtomCommand: async () => mock.command,
}));
vi.mock("./rememberedEnvironments", () => ({
  beginEnvironmentIdentityExchange: () => () => undefined,
  rememberEnvironment: (record: unknown) => {
    mock.remembered.push(record);
  },
}));
vi.mock("./firstPromptStorage", () => ({ rememberZeropsEnvironment: () => undefined }));

function fakeStorage(): ZeropsStorageAdapter & { readonly raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    get: (key) => Promise.resolve(raw.get(key) ?? null),
    set: (key, value) => {
      raw.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      raw.delete(key);
      return Promise.resolve();
    },
  };
}

const ENV = "env-1" as EnvironmentId;
const CANDIDATE = { project: { id: "project-1" } };

// `rememberExchangedProjectRef` is the one call the exchange driver's install
// port makes (`webExchangePorts`) for every environment it installs — and every
// path that can land an environment is demand on that one driver: the projects
// page's Connect, auto-connect, restore and repair. Proving this function
// writes the ref correctly proves every one of those paths does.
describe("rememberExchangedProjectRef (H12: connect, restore and repair share one write)", () => {
  it("a restored or repaired environment remembers its project", async () => {
    const storage = fakeStorage();

    await rememberExchangedProjectRef(storage, ENV, CANDIDATE, "org-1");

    expect(await lookupEnvironmentProjectRef(storage, ENV)).toMatchObject({
      projectId: "project-1",
      orgId: "org-1",
      source: "connect",
    });
  });

  it("writes nothing when the organization is not yet known", async () => {
    const storage = fakeStorage();

    await rememberExchangedProjectRef(storage, ENV, CANDIDATE, undefined);

    expect(await lookupEnvironmentProjectRef(storage, ENV)).toBeUndefined();
    expect(storage.raw.size).toBe(0);
  });

  it("a failed write is swallowed — the environment is connected either way", async () => {
    const storage: ZeropsStorageAdapter = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error("storage blocked")),
      remove: () => Promise.resolve(),
    };
    const onRejection = vi.fn();

    await expect(
      rememberExchangedProjectRef(storage, ENV, CANDIDATE, "org-1").catch(onRejection),
    ).resolves.toBeUndefined();
    expect(onRejection).not.toHaveBeenCalled();
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
