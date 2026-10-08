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
import {
  initialEnvironment,
  initialContainer,
  type EnvironmentMachine,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import { RegistryContext } from "@effect/atom-react";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { zeropsSessionAtom } from "../state/zerops";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { bindTestInvalidationBus } from "./__fixtures__/invalidationBus";
import {
  bindAccountEnvironments,
  connectMate,
  connectResult,
  tryAgainTarget,
  useMateCommand,
  MATE_HOLD_WAIT_MS,
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

/** A stage whose holds and releases go into `log`, naming no Mate. */
const holder = (log: Array<string> = []) => ({
  log,
  environments: {
    hold: (environmentId: EnvironmentId) => {
      log.push(`hold ${environmentId}`);
      return () => {
        log.push(`release ${environmentId}`);
      };
    },
    machines: () => new Map<TargetKey, EnvironmentMachine>(),
    subscribe: () => () => undefined,
  },
});

/** A stage whose Mate for `ENV` connects when the test says. */
const connecting = (log: Array<string> = []) => {
  const { environments } = holder(log);
  let machines = new Map<TargetKey, EnvironmentMachine>();
  const listeners = new Set<() => void>();
  return {
    log,
    environments: {
      ...environments,
      machines: () => machines,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    connect: () => {
      machines = new Map([
        [
          "project-1:service-1",
          {
            ...initialEnvironment({ record: null }),
            credential: {
              kind: "held",
              environmentId: ENV,
              installed: true,
              staleBlock: false,
              rereading: null,
            },
            link: { phase: "connected", since: { wall: 0, mono: 0 } },
          },
        ],
      ]);
      for (const listener of listeners) listener();
    },
  };
};

// A9: a command sent from outside a Mate's own view holds it connected — an action's lease — for
// as long as the command takes, and lets it go however it ends.
describe("whileMateHeld: an action's lease around its command", () => {
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

  it("sends a Stop to a Mate this browser never registered once its hold connects it", async () => {
    const { log, environments, connect } = connecting();
    const sent = whileMateHeld(
      environments,
      ENV,
      async () => {
        log.push("command");
        return "stopped";
      },
      { named: true },
    );
    await Promise.resolve();
    expect(log).toEqual(["hold env-1"]);

    connect();

    expect(await sent).toBe("stopped");
    expect(log).toEqual(["hold env-1", "command", "release env-1"]);
  });

  it("sends it anyway once its Mate has not connected in MATE_HOLD_WAIT_MS", async () => {
    vi.useFakeTimers();
    const { log, environments } = connecting();
    const sent = whileMateHeld(
      environments,
      ENV,
      async () => {
        log.push("command");
        return "not connected";
      },
      { named: true },
    );
    await vi.advanceTimersByTimeAsync(MATE_HOLD_WAIT_MS - 1);
    expect(log).toEqual(["hold env-1"]);

    await vi.advanceTimersByTimeAsync(1);

    expect(await sent).toBe("not connected");
    expect(log).toEqual(["hold env-1", "command", "release env-1"]);
  });
});

/** An account bound whose holds and releases go into `sent.log`; the answer unbinds it. */
const bindHolder = () =>
  bindAccountEnvironments(holder(sent.log).environments as unknown as AccountEnvironments);

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

  it("sends to a Mate HQ names once its hold has connected it", async () => {
    const stage = connecting(sent.log);
    const unbind = bindAccountEnvironments(stage.environments as unknown as AccountEnvironments);
    const atoms = AtomRegistry.make();
    atoms.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-acme" },
    } as never);
    const { store } = mountHqNavigation(atoms, "org-acme", {
      structure: {
        apps: [],
        ungrouped: [{ projectId: "project-1", name: "Mate", mate: { face: "" } }],
      },
      mates: {
        ["project-1"]: {
          presence: { online: true, since: "2026-10-06T00:00:00Z", overview: "live" },
          identity: { environmentId: ENV },
        } as unknown as MateLiveView,
      },
    });
    type Stop = { readonly environmentId: EnvironmentId; readonly input: string };
    const command = {} as AtomCommand<Stop, string, never>;
    const senders: Array<(value: Stop) => Promise<unknown>> = [];
    function Probe() {
      senders.push(useMateCommand(command));
      return null;
    }
    act(() => {
      create(h(RegistryContext, { value: atoms }, h(Probe)));
    });
    const answered = senders.at(-1)!({ environmentId: ENV, input: "stop" });
    await Promise.resolve();
    expect(sent.log).toEqual(["hold env-1"]);

    stage.connect();
    // The Mate adapter publishes connection evidence to the account store.
    const [key, environment] = [...stage.environments.machines()][0]!;
    store.dispatch({
      kind: "rows",
      scope: "mate:project-1:link",
      generation: 0,
      method: "read",
      via: "mate-direct",
      rows: [
        {
          family: "mateLink",
          id: key,
          revision: { kind: "mate-link", sequence: 1 },
          value: {
            key,
            projectId: "project-1",
            orgId: "org-acme",
            origin: null,
            shown: true,
            watched: true,
            environment,
            container: initialContainer(),
          },
        },
      ],
    });

    expect(await answered).toBe("answered");
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
// A Mate link's Try now asks the exchange machine itself, not only the socket: it reaches the target
// its verdict speaks for, however the route gate found it — by a machine or a descriptor, or by the
// project HQ names when neither does.
describe("tryAgainTarget — the target a Mate link's Try again asks", () => {
  const ENV = "env-wren" as EnvironmentId;
  const HELD = {
    ...initialEnvironment({ record: ENV }),
    credential: {
      kind: "held",
      environmentId: ENV,
      installed: true,
      staleBlock: false,
      rereading: null,
    },
  } as EnvironmentMachine;
  const BACKING_OFF = {
    ...initialEnvironment({ record: null }),
    credential: {
      kind: "backoff",
      retryAt: { wall: 5_000, mono: 5_000 },
      last: { kind: "network" },
      reconnect: false,
    },
  } as EnvironmentMachine;
  const NO_INDEX = { serving: new Map(), reported: new Map() };
  it.each<{
    readonly case: string;
    readonly machines: ReadonlyMap<TargetKey, EnvironmentMachine>;
    readonly hqProject: string | null;
    readonly key: TargetKey | undefined;
  }>([
    {
      case: "a machine that names the environment",
      machines: new Map([["project-wren:zcp", HELD]]),
      hqProject: null,
      key: "project-wren:zcp",
    },
    {
      case: "a backing-off Mate only HQ's index names",
      machines: new Map([
        ["project-other:zcp", BACKING_OFF],
        ["project-wren:zcp", BACKING_OFF],
      ]),
      hqProject: "project-wren",
      key: "project-wren:zcp",
    },
    {
      case: "nothing that names it",
      machines: new Map([["project-other:zcp", BACKING_OFF]]),
      hqProject: null,
      key: undefined,
    },
  ])("$case", ({ machines, hqProject, key }) => {
    expect(tryAgainTarget({ machines, index: NO_INDEX, environmentId: ENV, hqProject })).toBe(key);
  });
});
