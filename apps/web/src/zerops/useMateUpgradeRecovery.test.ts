/**
 * The upgrade restart over its container's verdict, run as a plain function against
 * `reactHookHarness`: calling the hook again after each step observes the next state the way a
 * re-render would. The restart is the account's `mate-restart` operation; a refusal is Zerops's.
 */
import { upgradeRecoveryFromEvidence, type OperationProgress } from "@t3tools/client-runtime/data";
import type { ContainerVerdict } from "@t3tools/client-runtime/zerops/environments";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness } from "../test/reactHookHarness";

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

const mock = vi.hoisted(() => ({
  data: {},
  progress: { stage: "accepted", operationId: "proc-restart" } as OperationProgress,
  restart: vi.fn(),
  reconnect: vi.fn(),
  /** The container's initAt read before the verb. */
  readInitAt: vi.fn(),
  intents: [] as Array<unknown>,
  container: {
    verdict: { level: "ready" } as ContainerVerdict,
    serverVersion: "0.10.0" as string | undefined,
  },
}));

vi.mock("./accountOperations", () => ({
  useAccountOperations: () => ({
    submit: async (...args: unknown[]) => {
      const answer = await mock.restart(...args);
      mock.progress = answer.progress;
      return answer;
    },
  }),
}));
vi.mock("./ZeropsAccountData", () => ({
  useAccountData: () => ({ orgId: "org-1", data: mock.data }),
  useProjection: (_projection: unknown, key: unknown) =>
    key === null
      ? { state: "waiting" }
      : upgradeRecoveryFromEvidence({
          progress: mock.progress,
          verdict: mock.container.verdict,
          serverVersion: mock.container.serverVersion,
          returned: mock.container.verdict.level === "ready",
        }),
}));
vi.mock("./inventoryContext", () => ({
  useZeropsInventory: () => ({ error: null }),
  useInventoryCandidates: () => [
    {
      key: KEY,
      project: { id: "project-1", status: "ACTIVE" },
      service: { id: "service-1", status: "ACTIVE" },
      containerOrigin: ORIGIN,
    },
  ],
}));
vi.mock("./accountLifetime", () => ({
  captureAccountLifetime: () => () => true,
  onAccountLifetimeClose: () => () => undefined,
}));
vi.mock("./zeropsContainers", () => ({
  useTargetContainer: (key: string | null) => ({ key, ...mock.container }),
  readContainerInitAt: (key: string) => mock.readInitAt(key),
  intendContainer: (key: string, intent: unknown) => {
    mock.intents.push({ key, intent });
    mock.container.verdict = { level: "restarting", by: "you", overdue: false };
    return true;
  },
}));

const { useMateUpgradeRecovery } = await import("./useMateUpgradeRecovery");

function render() {
  reactHookHarness.beginRender();
  const recovery = useMateUpgradeRecovery(ORIGIN, mock.reconnect);
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

const INIT_AT = "2026-09-23T08:00:00Z";

beforeEach(() => {
  reactHookHarness.reset();
  mock.data = {};
  mock.restart.mockReset().mockResolvedValue({
    requestId: "r1",
    evidence: null,
    progress: { stage: "accepted", operationId: "proc-restart" },
  });
  mock.reconnect.mockReset();
  mock.readInitAt.mockReset().mockResolvedValue(INIT_AT);
  mock.progress = { stage: "accepted", operationId: "proc-restart" };
  mock.intents = [];
  mock.container.verdict = { level: "ready" };
  mock.container.serverVersion = "0.10.0";
});

describe("useMateUpgradeRecovery", () => {
  it("our restart holds the container until it is back, then reconnects on a compatible version", async () => {
    let recovery = await restart();
    // The initAt is read before the verb is sent, and the restart is judged by it.
    expect(mock.readInitAt.mock.invocationCallOrder[0]).toBeLessThan(
      mock.restart.mock.invocationCallOrder[0]!,
    );
    expect(mock.restart).toHaveBeenCalledWith({
      kind: "mate-restart",
      orgId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      way: "restart",
    });
    expect(mock.intents).toEqual([
      { key: KEY, intent: { kind: "upgrade-restart", initAt: INIT_AT } },
    ]);
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
    expect(recovery.state).toBe("unresolved");
    expect(recovery.error).toMatch(/has not come back yet/);
    mock.container.verdict = { level: "ready" };
    mock.container.serverVersion = "0.12.0";
    render();
    expect(render().state).toBe("idle");
    expect(mock.reconnect).toHaveBeenCalledOnce();
  });

  it("refuses a restart its project's access does not admit, in the refusal's words, and holds no container", async () => {
    mock.restart.mockResolvedValue({
      requestId: "r1",
      evidence: null,
      progress: {
        stage: "unsent",
        next: "send-again",
        reason: "Your role in this project doesn't allow this.",
      },
    });

    render().request();
    render().confirm();
    await vi.waitFor(() => expect(render().state).toBe("failed"));

    expect(render().error).toBe("Your role in this project doesn't allow this.");
    expect(mock.intents).toEqual([]);
  });

  it("says a restart Zerops refuses in its words, and holds no container for it", async () => {
    mock.restart.mockResolvedValue({
      requestId: "r1",
      evidence: null,
      progress: { stage: "refused", reason: "Service stack is failed." },
    });

    render().request();
    render().confirm();
    await vi.waitFor(() => expect(render().state).toBe("failed"));

    expect(render().error).toBe("Service stack is failed.");
    expect(mock.intents).toEqual([]);
  });
});

it("a refused restart survives surface remount through its operation identity", async () => {
  mock.restart.mockResolvedValue({
    requestId: "r1",
    evidence: null,
    progress: { stage: "refused", reason: "No restart" },
  });
  render().request();
  render().confirm();
  await vi.waitFor(() => expect(render().state).toBe("failed"));
  reactHookHarness.reset();
  render();
  expect(render()).toMatchObject({ state: "failed", error: "No restart" });
  expect(mock.restart).toHaveBeenCalledOnce();
});

it("a lost acceptance answer is unresolved and never installs a guessed restart intent", async () => {
  mock.restart.mockResolvedValue({
    requestId: "r1",
    evidence: null,
    progress: { stage: "uncertain", next: "ask-owner-again" },
  });
  render().request();
  render().confirm();
  await vi.waitFor(() => expect(render().state).toBe("unresolved"));
  expect(mock.intents).toEqual([]);
  reactHookHarness.reset();
  render();
  expect(render().state).toBe("unresolved");
  expect(mock.restart).toHaveBeenCalledOnce();
});
