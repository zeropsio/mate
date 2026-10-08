import { mateArrivalNotice } from "./mateNoticeVoice";
import { MateRestartError } from "./mateRestartRefusal";
import { act, useLayoutEffect } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useRestartMate, useReviveFailedMate } from "./mateRestart";

const mock = vi.hoisted(() => ({
  submit: vi.fn(),
  toasts: [] as Array<{ readonly type: string; readonly title: string }>,
}));
vi.mock("./useZeropsCandidates", () => ({
  useHeldZeropsCandidates: () => [
    {
      key: "p1:s1",
      project: { id: "p1" },
      service: { id: "s1", status: "SERVICE_FAILED" },
    },
  ],
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

let restart: ReturnType<typeof useRestartMate>;
function RestartProbe() {
  restart = useRestartMate();
  return null;
}

it.each([
  {
    progress: { stage: "uncertain", next: "asking-owner" },
    text: "Zerops did not answer whether it took the restart. Check the Mate before trying again.",
  },
  {
    progress: {
      stage: "unresolved",
      operationId: null,
      nextActor: "person",
      nextAction: "Start the Mate",
      reason: "500: Internal Server Error",
    },
    text: "The Mate was stopped, but it was not started again here. Start the Mate.",
  },
])(
  "keeps receipt guidance through a rejected restart: $progress.stage",
  async ({ progress, text }) => {
    mock.submit.mockResolvedValue({ progress });
    let rendered: ReturnType<typeof create>;
    await act(async () => {
      rendered = create(<RestartProbe />);
    });
    const error = await restart({
      key: "p1:s1",
      projectId: "p1",
      serviceId: "s1",
      status: "SERVICE_FAILED",
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(MateRestartError);
    if (!(error instanceof MateRestartError)) throw error;
    expect(
      mateArrivalNotice({
        coming: { kind: "failed", line: "Setup stopped.", verb: "try-again" },
        progress: undefined,
        nowMs: 0,
        attemptId: "failed",
        refusal: {
          kind: "retry",
          attemptId: "failed",
          details: error.message,
          receipt: error.receipt,
        },
      }).secondary,
    ).toBe(text);
    await act(async () => {
      rendered!.unmount();
    });
  },
);
