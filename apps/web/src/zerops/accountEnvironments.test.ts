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
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bindTestInvalidationBus } from "./__fixtures__/invalidationBus";
import {
  bindAccountEnvironments,
  connectMate,
  connectResult,
  useMateCommand,
  useMateHeld,
  whileMateHeld,
  type MateConnectTarget,
} from "./accountEnvironments";
import { onZeropsInvalidation } from "./accountInvalidations";

const ENV = "env-1" as EnvironmentId;

/** What happened, in order: the Mate held and let go, the command sent. */
const sent = vi.hoisted(() => ({ log: [] as Array<string> }));

vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: () => async (value: { readonly input: string }) => {
    sent.log.push(`command ${value.input}`);
    return "answered";
  },
}));

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
  sent.log.length = 0;
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

// A9: a command sent from outside a Mate's own view holds it connected — an action's lease — for
// as long as the command takes, and lets it go however it ends.
describe("whileMateHeld: an action's lease around its command", () => {
  const holder = () => {
    const log: Array<string> = [];
    return {
      log,
      environments: {
        hold: (environmentId: EnvironmentId) => {
          log.push(`hold ${environmentId}`);
          return () => {
            log.push(`release ${environmentId}`);
          };
        },
      },
    };
  };

  it("holds the Mate before its command and lets it go once the command answers", async () => {
    const { log, environments } = holder();
    expect(
      await whileMateHeld(environments, ENV, async () => {
        log.push("command");
        return "answered";
      }),
    ).toBe("answered");
    expect(log).toEqual(["hold env-1", "command", "release env-1"]);
  });

  it("lets it go when the command fails, and says why", async () => {
    const { log, environments } = holder();
    await expect(
      whileMateHeld(environments, ENV, async () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(log).toEqual(["hold env-1", "release env-1"]);
  });

  it("runs the command as it is where no account is bound", async () => {
    expect(await whileMateHeld(null, ENV, async () => "answered")).toBe("answered");
  });
});

/** An account bound whose holds and releases go into `sent.log`; the answer unbinds it. */
const bindHolder = () =>
  bindAccountEnvironments({
    hold: (environmentId: EnvironmentId) => {
      sent.log.push(`hold ${environmentId}`);
      return () => {
        sent.log.push(`release ${environmentId}`);
      };
    },
  } as unknown as AccountEnvironments);

describe("useMateCommand: a Mate's command, sent with its action lease", () => {
  it("holds the Mate the command names until the command answers", async () => {
    const unbind = bindHolder();
    type Stop = { readonly environmentId: EnvironmentId; readonly input: string };
    const command = {} as AtomCommand<Stop, string, never>;
    const senders: Array<(value: Stop) => Promise<unknown>> = [];
    function Probe() {
      senders.push(useMateCommand(command));
      return null;
    }
    act(() => {
      create(h(Probe));
    });
    const send = senders.at(-1)!;

    expect(await send({ environmentId: ENV, input: "stop" })).toBe("answered");
    expect(sent.log).toEqual(["hold env-1", "command stop", "release env-1"]);
    unbind();
  });
});

describe("useMateHeld: an action's lease for as long as a surface names its Mate", () => {
  it("holds the Mate while it is named and lets it go once it is not", () => {
    const unbind = bindHolder();
    const Probe = ({ environmentId }: { readonly environmentId: EnvironmentId | null }) => {
      useMateHeld(environmentId);
      return null;
    };
    const OTHER = "env-2" as EnvironmentId;
    const renderer = create(h(Probe, { environmentId: null }));
    act(() => {
      renderer.update(h(Probe, { environmentId: ENV }));
    });
    act(() => {
      renderer.update(h(Probe, { environmentId: OTHER }));
    });
    act(() => {
      renderer.unmount();
    });

    expect(sent.log).toEqual(["hold env-1", "release env-1", "hold env-2", "release env-2"]);
    unbind();
  });
});
