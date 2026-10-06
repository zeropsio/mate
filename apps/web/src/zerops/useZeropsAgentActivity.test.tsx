import type { EnvironmentId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsAgentActivity } from "./agentActivity";
import { LIVE_STEP_HOLD_MS, type LiveStepWords } from "./liveStep";
import { usePacedLiveSteps } from "./useZeropsAgentActivity";

const NOVA = "env-nova" as EnvironmentId;

function activityWith(
  liveStep: LiveStepWords | undefined,
): ReadonlyMap<EnvironmentId, ZeropsAgentActivity> {
  const entry = { kind: liveStep === undefined ? "idle" : "working" } as ZeropsAgentActivity;
  return new Map([[NOVA, liveStep === undefined ? entry : { ...entry, liveStep }]]);
}

function Row({
  activity,
}: {
  readonly activity: ReadonlyMap<EnvironmentId, ZeropsAgentActivity>;
}): ReactNode {
  const step = usePacedLiveSteps(activity).get(NOVA)?.liveStep;
  return step === undefined ? "…" : step.words;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("usePacedLiveSteps", () => {
  it("shows a new step at most once per hold, and the latest when the hold ends", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ now: Date.parse("2026-09-29T08:00:00.000Z") });
    let row: ReactTestRenderer | undefined;
    const show = (liveStep: LiveStepWords | undefined) =>
      act(() => row!.update(<Row activity={activityWith(liveStep)} />));

    act(() => {
      row = create(<Row activity={activityWith({ words: "Thinking" })} />);
    });
    expect(row!.toJSON()).toBe("Thinking");

    // A quick read, and the command after it, within the hold: the line stays still.
    act(() => vi.advanceTimersByTime(100));
    show({ words: "Reading index.ts" });
    expect(row!.toJSON()).toBe("Thinking");
    act(() => vi.advanceTimersByTime(100));
    show({ words: "Build the app" });
    expect(row!.toJSON()).toBe("Thinking");

    // The hold ends: the latest step, never the one it skipped.
    act(() => vi.advanceTimersByTime(LIVE_STEP_HOLD_MS - 200));
    expect(row!.toJSON()).toBe("Build the app");

    // A step that comes after the shown one has stood its hold shows at once.
    act(() => vi.advanceTimersByTime(LIVE_STEP_HOLD_MS));
    show({ words: "Thinking" });
    expect(row!.toJSON()).toBe("Thinking");

    // Stopping is never held.
    act(() => vi.advanceTimersByTime(50));
    show(undefined);
    expect(row!.toJSON()).toBe("…");
    act(() => row!.unmount());
  });
});
