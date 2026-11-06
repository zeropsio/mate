/**
 * The upgrade restart over its container's verdict, rendered as the account's readings change.
 * The restart is the account's `mate-restart` operation; a refusal is Zerops's.
 */
import { upgradeRecoveryFromEvidence, type OperationProgress } from "@t3tools/client-runtime/data";
import type { ContainerVerdict } from "@t3tools/client-runtime/zerops/environments";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as operations from "./accountOperations";
import * as accountData from "./ZeropsAccountData";
import * as inventory from "./inventoryContext";
import * as lifetime from "./accountLifetime";
import * as containers from "./zeropsContainers";
import { useMateUpgradeRecovery } from "./useMateUpgradeRecovery";

const ORIGIN = "https://zcp-1-8080.prg1.zerops.app";
const KEY = "project-1:service-1";

const mock = {
  data: {},
  progress: { stage: "accepted", operationId: "proc-restart" } as OperationProgress,
  restart: vi.fn(),
  submit: vi.fn(),
  reconnect: vi.fn(),
  /** The container's initAt read before the verb. */
  readInitAt: vi.fn(),
  intents: [] as Array<unknown>,
  container: {
    verdict: { level: "ready" } as ContainerVerdict,
    serverVersion: "0.10.0" as string | undefined,
  },
};

function installTestDoubles() {
  vi.spyOn(operations, "useAccountOperations").mockReturnValue({
    submit: mock.submit,
  } as unknown as ReturnType<typeof operations.useAccountOperations>);
  vi.spyOn(accountData, "useAccountData").mockImplementation(
    () => ({ orgId: "org-1", data: mock.data }) as ReturnType<typeof accountData.useAccountData>,
  );
  vi.spyOn(accountData, "useProjection").mockImplementation(((
    _projection: unknown,
    key: unknown,
  ) =>
    key === null
      ? { state: "waiting" }
      : upgradeRecoveryFromEvidence({
          progress: mock.progress,
          verdict: mock.container.verdict,
          serverVersion: mock.container.serverVersion,
          returned: mock.container.verdict.level === "ready",
        })) as typeof accountData.useProjection);
  vi.spyOn(inventory, "useZeropsInventory").mockReturnValue({ error: null } as ReturnType<
    typeof inventory.useZeropsInventory
  >);
  vi.spyOn(inventory, "useInventoryCandidates").mockReturnValue([
    {
      key: KEY,
      project: { id: "project-1", status: "ACTIVE" },
      service: { id: "service-1", status: "ACTIVE" },
      containerOrigin: ORIGIN,
    },
  ] as unknown as ReturnType<typeof inventory.useInventoryCandidates>);
  vi.spyOn(lifetime, "captureAccountLifetime").mockReturnValue(() => true);
  vi.spyOn(lifetime, "onAccountLifetimeClose").mockReturnValue(() => undefined);
  vi.spyOn(containers, "useTargetContainer").mockImplementation(
    (key) => ({ key, ...mock.container }) as ReturnType<typeof containers.useTargetContainer>,
  );
  vi.spyOn(containers, "readContainerInitAt").mockImplementation((key) => mock.readInitAt(key));
  vi.spyOn(containers, "intendContainer").mockImplementation((key, intent) => {
    mock.intents.push({ key, intent });
    mock.container.verdict = { level: "restarting", by: "you", overdue: false };
    return true;
  });
}

let tree: ReactTestRenderer | undefined;
let shown: ReturnType<typeof useMateUpgradeRecovery> = null;
function Probe() {
  shown = useMateUpgradeRecovery(ORIGIN, mock.reconnect);
  return null;
}
function render() {
  act(() => {
    if (tree === undefined) tree = create(createElement(Probe));
    else tree.update(createElement(Probe));
  });
  if (shown === null) throw new Error("no recovery for an origin");
  const recovery: NonNullable<typeof shown> = shown;
  return {
    ...recovery,
    request: () => act(() => recovery.request()),
    confirm: () => act(() => recovery.confirm()),
  };
}
function unmount() {
  act(() => tree?.unmount());
  tree = undefined;
  shown = null;
}

/** Wait for the init read and the submitted operation the hook is following. */
async function confirmRestart() {
  render().confirm();
  const read = mock.readInitAt.mock.results[0];
  expect(read?.type).toBe("return");
  await read?.value;
  // The hook already awaits this submission before the init-read continuation reaches the test.
  const submission = mock.submit.mock.results[0];
  expect(submission?.type).toBe("return");
  await submission?.value;
}

/** Asks for the restart and lets the platform accept it. */
async function restart() {
  render().request();
  await confirmRestart();
  expect(mock.intents).toHaveLength(1);
  return render();
}

const INIT_AT = "2026-09-23T08:00:00Z";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  installTestDoubles();
  mock.data = {};
  mock.restart.mockReset().mockResolvedValue({
    requestId: "r1",
    evidence: null,
    progress: { stage: "accepted", operationId: "proc-restart" },
  });
  mock.submit.mockReset().mockImplementation(async (...args: unknown[]) => {
    const answer = await mock.restart(...args);
    mock.progress = answer.progress;
    return answer;
  });
  mock.reconnect.mockReset();
  mock.readInitAt.mockReset().mockResolvedValue(INIT_AT);
  mock.progress = { stage: "accepted", operationId: "proc-restart" };
  mock.intents = [];
  mock.container.verdict = { level: "ready" };
  mock.container.serverVersion = "0.10.0";
});
afterEach(() => {
  unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    mock.container.serverVersion = "0.16.0";
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
    mock.container.serverVersion = "0.16.0";
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
    await confirmRestart();
    expect(render().state).toBe("failed");

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
    await confirmRestart();
    expect(render().state).toBe("failed");

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
  await confirmRestart();
  expect(render().state).toBe("failed");
  unmount();
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
  await confirmRestart();
  expect(render().state).toBe("unresolved");
  expect(mock.intents).toEqual([]);
  unmount();
  render();
  expect(render().state).toBe("unresolved");
  expect(mock.restart).toHaveBeenCalledOnce();
});
