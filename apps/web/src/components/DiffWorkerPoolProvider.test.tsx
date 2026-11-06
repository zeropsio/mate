import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { WorkerPoolManager } from "@pierre/diffs/worker";

import * as theme from "../hooks/useTheme";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { ReviewCommentDiffLoading } from "./chat/ReviewCommentDiffLoading";

vi.mock("@pierre/diffs/worker/worker.js?worker", () => import("./diffs/diffWorker.test-fixture"));

const initialize = vi.fn<() => Promise<void>>();
let view: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {});
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setImmediate(() => callback(0)),
  );
  vi.stubGlobal("cancelAnimationFrame", clearImmediate);
  initialize.mockReset();
  vi.spyOn(
    WorkerPoolManager.prototype as unknown as { queueInitialization: () => void },
    "queueInitialization",
  ).mockImplementation(() => undefined);
  vi.spyOn(WorkerPoolManager.prototype, "initialize").mockImplementation(initialize);
  vi.spyOn(WorkerPoolManager.prototype, "isInitialized").mockReturnValue(false);
  vi.spyOn(WorkerPoolManager.prototype, "isWorkingPool").mockReturnValue(true);
  vi.spyOn(theme, "useTheme").mockReturnValue({ resolvedTheme: "light" } as ReturnType<
    typeof theme.useTheme
  >);
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["ready", "failed"] as const)(
  "retains the review patch until worker initialization is %s",
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const initialized = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    initialize.mockReturnValue(initialized);
    const renderDiff = vi.fn();
    function Diff() {
      renderDiff();
      return <div data-testid="diff">Diff content</div>;
    }
    await act(async () => {
      view = create(
        <DiffWorkerPoolProvider loadingFallback={<ReviewCommentDiffLoading patch={"-old\n+new"} />}>
          <Diff />
        </DiffWorkerPoolProvider>,
      );
    });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(renderDiff).toHaveBeenCalledTimes(0);
    expect(view!.root.findByType("pre").children.join("")).toBe("-old\n+new");
    expect(view!.root.findByProps({ role: "status" }).children.join("")).toBe("Loading diff...");
    await act(async () => {
      if (outcome === "ready") resolve();
      else reject(new Error("worker unavailable"));
      await initialized.catch(() => {});
    });
    expect(renderDiff).toHaveBeenCalledTimes(1);
    expect(view!.root.findByProps({ "data-testid": "diff" })).toBeDefined();
    expect(view!.root.findAllByType("pre")).toHaveLength(0);
    await act(async () => {
      view!.unmount();
    });
    view = undefined;
  },
);
