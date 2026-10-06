import { act, useLayoutEffect } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useReviveFailedMate } from "./mateRestart";

const mock = vi.hoisted(() => ({
  submit: vi.fn(),
  toasts: [] as Array<{ readonly type: string; readonly title: string }>,
}));
vi.mock("./useZeropsCandidates", () => ({ useZeropsCandidates: () => ({ listing: null }) }));
vi.mock("@t3tools/client-runtime/zerops/projections", () => ({
  heldCandidates: () => ({
    rows: [
      {
        key: "p1:s1",
        project: { id: "p1" },
        service: { id: "s1", status: "SERVICE_FAILED" },
      },
    ],
  }),
}));
vi.mock("./accountOperations", () => ({ useAccountOperations: () => ({ submit: mock.submit }) }));
vi.mock("./ZeropsAccountData", () => ({ useAccountData: () => ({ orgId: "org-1" }) }));
vi.mock("./zeropsContainers", () => ({
  intendContainer: () => true,
  readContainerInitAt: async () => null,
}));
vi.mock("~/components/ui/toast", () => ({
  toastManager: { add: (toast: { type: string; title: string }) => mock.toasts.push(toast) },
}));

let revive: (serviceId: string | undefined) => boolean;
function Probe() {
  const hook = useReviveFailedMate();
  useLayoutEffect(() => {
    revive = hook;
  }, [hook]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.toasts.length = 0;
  mock.submit.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("useReviveFailedMate", () => {
  it("says a stop it could not follow, with starting the Mate as the next step", async () => {
    mock.submit.mockResolvedValue({
      requestId: "r1",
      evidence: null,
      progress: {
        stage: "unresolved",
        operationId: null,
        nextActor: "person",
        nextAction: "Start the Mate",
      },
    });
    await act(async () => {
      create(<Probe />);
    });
    await act(async () => {
      expect(revive("s1")).toBe(true);
    });
    expect(mock.toasts).toEqual([
      {
        type: "error",
        title: "The Mate was stopped, but it was not started again here. Start the Mate.",
      },
    ]);
  });

  it("says why Zerops refused the start after the stop, with starting the Mate next", async () => {
    mock.submit.mockResolvedValue({
      requestId: "r1",
      evidence: null,
      progress: {
        stage: "unresolved",
        operationId: null,
        nextActor: "person",
        nextAction: "Start the Mate",
        reason: "Service is busy.",
      },
    });
    await act(async () => {
      create(<Probe />);
    });
    await act(async () => {
      expect(revive("s1")).toBe(true);
    });
    expect(mock.toasts).toEqual([
      {
        type: "error",
        title:
          "The Mate was stopped, but it was not started again here: Service is busy. Start the Mate.",
      },
    ]);
  });

  it("says nothing once Zerops took the restart", async () => {
    mock.submit.mockResolvedValue({
      requestId: "r1",
      evidence: null,
      progress: { stage: "accepted", operationId: "proc-start" },
    });
    await act(async () => {
      create(<Probe />);
    });
    await act(async () => {
      revive("s1");
    });
    expect(mock.toasts).toEqual([]);
  });
});
