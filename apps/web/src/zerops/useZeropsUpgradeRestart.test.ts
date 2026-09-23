/**
 * The upgrade restart over its container's verdict, run as a plain function against
 * `reactHookHarness`: calling the hook again after each step observes the next state the way a
 * re-render would.
 */
import type { ContainerVerdict } from "@t3tools/client-runtime/zerops/environments";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness } from "../test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness: harness } = await import("../test/reactHookHarness");
  return {
    ...actual,
    useEffect: harness.useEffect,
    useRef: harness.useRef,
    useState: harness.useState,
  };
});

const ORIGIN = "https://zcp-1-8080.prg1.zerops.app";
const KEY = "project-1:service-1";

const mock = vi.hoisted(() => ({
  restart: vi.fn(),
  reconnect: vi.fn(),
  intents: [] as Array<unknown>,
  container: {
    verdict: { level: "ready" } as ContainerVerdict,
    serverVersion: "0.10.0" as string | undefined,
  },
}));

vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({ runtime: { commands: { restartService: mock.restart } } }),
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
  findInventoryProjectRef: () => ({ projectId: "project-1" }),
}));
vi.mock("./accountLifetime", () => ({
  accountActionsAllowed: () => true,
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
  await vi.advanceTimersByTimeAsync(0);
  return render();
}

beforeEach(() => {
  reactHookHarness.reset();
  vi.useFakeTimers();
  mock.restart.mockReset().mockResolvedValue(undefined);
  mock.reconnect.mockReset();
  mock.intents = [];
  mock.container.verdict = { level: "ready" };
  mock.container.serverVersion = "0.10.0";
});

afterEach(() => {
  vi.useRealTimers();
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
});
