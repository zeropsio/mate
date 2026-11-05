// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Progress, type ProgressView } from "./progress";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Progress — its clock", () => {
  it("Every elapsed clock ticks on the shared second; no component holds its own 1 s interval, and none ticks with nothing to show", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers({ now: Date.parse("2026-11-05T10:00:00.400Z") });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const startedAtMs = Date.now() - 4_400;
    const rows = (view: ProgressView) => (
      <>
        <Progress
          at={0}
          label="Deploying"
          startedAtMs={startedAtMs}
          steps={["Deploying"]}
          view={view}
        />
        <Progress
          at={0}
          label="Building"
          startedAtMs={startedAtMs}
          steps={["Building"]}
          view={view}
        />
      </>
    );
    const times = () =>
      [...container.querySelectorAll('[data-slot="progress-time"]')].map(
        (node) => node.textContent,
      );

    await act(async () => root!.render(rows({ state: "running" })));
    const before = times();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(600));
    const onTheSecond = times();
    expect(onTheSecond).toHaveLength(2);
    expect(onTheSecond[0]).toBe(onTheSecond[1]);
    expect(onTheSecond).not.toEqual(before);

    await act(async () => root!.render(rows({ state: "done", result: "Done" })));
    expect(vi.getTimerCount()).toBe(0);
  });
});
