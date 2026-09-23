/**
 * The upgrade restart over its container's verdict, run as a plain function against
 * `reactHookHarness`: calling the hook again after each step observes the next state the way a
 * re-render would. The restart is a write on the Mate's project, asked of that project's
 * capability before anything is sent.
 */
import {
  DEFAULT_ZEROPS_GRANT_POLICY,
  grantRoundInFlight,
  initialGrant,
  transitionGrant,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  type AccessGrantView,
  type GrantEvent,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import type { ContainerVerdict } from "@t3tools/client-runtime/zerops/environments";
import * as Stream from "effect/Stream";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness } from "../test/reactHookHarness";
import { tabClock } from "./tabClock";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness: harness } = await import("../test/reactHookHarness");
  return {
    ...actual,
    useEffect: harness.useEffect,
    useMemo: harness.useMemo,
    useRef: harness.useRef,
    useState: harness.useState,
  };
});

const ORIGIN = "https://zcp-1-8080.prg1.zerops.app";
const KEY = "project-1:service-1";

const project: ProjectRef = {
  kind: "project",
  organization: {
    kind: "organization",
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-1"),
    },
    organizationId: ZeropsOrganizationId.make("org-1"),
  },
  projectId: ZeropsProjectId.make("project-1"),
};

/** The grant after its first round verified `project` with this role, on the hook's clock. */
const grantedAs = (role: "ADMIN" | "READ_ONLY"): AccessGrantView => {
  const ctx = () => ({
    now: {
      wall: tabClock.currentTimeMillisUnsafe(),
      mono: Number(tabClock.monotonicTimeNanosUnsafe()) / 1_000_000,
    },
    policy: DEFAULT_ZEROPS_GRANT_POLICY,
  });
  let machine = initialGrant({ hidden: false, online: true }, ctx().now);
  machine = transitionGrant(machine, { type: "START" }, ctx()).state;
  const round = grantRoundInFlight(machine)!.id;
  for (const event of [
    {
      type: "ROUND_ACCOUNT",
      round,
      organizations: [{ organization: project.organization, mutationsAllowed: true }],
      projects: [project],
    },
    {
      type: "ROUND_PROJECT",
      round,
      project,
      outcome: {
        kind: "verified",
        access: { project, role, mutationsAllowed: role === "ADMIN" },
      },
    },
  ] satisfies ReadonlyArray<GrantEvent>) {
    machine = transitionGrant(machine, event, ctx()).state;
  }
  return { machine, failure: null, overdue: false };
};

const mock = vi.hoisted(() => ({
  view: undefined as unknown,
  restart: vi.fn(),
  reconnect: vi.fn(),
  intents: [] as Array<unknown>,
  container: {
    verdict: { level: "ready" } as ContainerVerdict,
    serverVersion: "0.10.0" as string | undefined,
  },
}));

vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({
    runtime: {
      access: { changes: Stream.suspend(() => Stream.make(mock.view)), clock: tabClock },
      commands: { restartService: mock.restart },
    },
  }),
  runZeropsCommand: (command: Promise<unknown>) => command,
}));
vi.mock("./inventoryContext", () => ({
  useZeropsInventory: () => ({ error: null }),
  inventoryCandidates: () => [
    {
      key: KEY,
      project: { id: "project-1", status: "ACTIVE" },
      service: { id: "service-1", status: "ACTIVE" },
      containerOrigin: ORIGIN,
    },
  ],
  findInventoryProjectRef: () => project,
}));
vi.mock("./accountLifetime", () => ({
  captureAccountLifetime: () => () => true,
  onAccountLifetimeClose: () => () => undefined,
}));
vi.mock("./zeropsContainers", () => ({
  useTargetContainer: (key: string | null) => ({ key, ...mock.container }),
  intendContainer: (key: string, intent: unknown) => {
    mock.intents.push({ key, intent });
    mock.container.verdict = { level: "restarting", by: "you", overdue: false };
    return true;
  },
}));

const { useZeropsUpgradeRestart } = await import("./useZeropsUpgradeRestart");

function render() {
  reactHookHarness.beginRender();
  const recovery = useZeropsUpgradeRestart(ORIGIN, mock.reconnect);
  if (recovery === null) throw new Error("no recovery for an origin");
  return recovery;
}

/** Asks for the restart and lets the platform accept it. */
async function restart() {
  let recovery = render();
  recovery.request();
  recovery = render();
  recovery.confirm();
  await vi.waitFor(() => expect(mock.intents).toHaveLength(1));
  return render();
}

beforeEach(() => {
  reactHookHarness.reset();
  mock.view = grantedAs("ADMIN");
  mock.restart.mockReset().mockResolvedValue(undefined);
  mock.reconnect.mockReset();
  mock.intents = [];
  mock.container.verdict = { level: "ready" };
  mock.container.serverVersion = "0.10.0";
});

describe("useZeropsUpgradeRestart", () => {
  it("our restart holds the container until it is back, then reconnects on a compatible version", async () => {
    let recovery = await restart();
    expect(mock.intents).toEqual([{ key: KEY, intent: { kind: "upgrade-restart" } }]);
    expect(recovery.state).toBe("waiting");

    // The old server answering is not the restart being over; the container says when it is.
    recovery = render();
    expect(recovery.state).toBe("waiting");
    expect(mock.reconnect).not.toHaveBeenCalled();

    mock.container.verdict = { level: "ready" };
    mock.container.serverVersion = "0.12.0";
    render();
    recovery = render();
    expect(mock.reconnect).toHaveBeenCalledTimes(1);
    expect(recovery.state).toBe("idle");
  });

  it("a container back on a version still too old is not success", async () => {
    await restart();
    mock.container.verdict = { level: "ready" };
    render();
    const recovery = render();
    expect(recovery.state).toBe("failed");
    expect(recovery.error).toMatch(/incompatible Mate version/);
    expect(mock.reconnect).not.toHaveBeenCalled();
  });

  it("a restart past its budget says the container has not come back", async () => {
    await restart();
    mock.container.verdict = { level: "restarting", by: "you", overdue: true };
    render();
    const recovery = render();
    expect(recovery.state).toBe("failed");
    expect(recovery.error).toMatch(/has not come back yet/);
  });

  it("refuses a restart its project's role does not allow, in the refusal's words, and sends nothing", async () => {
    mock.view = grantedAs("READ_ONLY");

    render().request();
    render().confirm();
    await vi.waitFor(() => expect(render().state).toBe("failed"));

    expect(render().error).toBe("Your role in this project doesn't allow this.");
    expect(mock.restart).not.toHaveBeenCalled();
    expect(mock.intents).toEqual([]);
  });
});
