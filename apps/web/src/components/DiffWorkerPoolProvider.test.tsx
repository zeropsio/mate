import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const { pool } = vi.hoisted(() => ({
  pool: {
    isInitialized: vi.fn(() => false),
    isWorkingPool: vi.fn(() => true),
    initialize: vi.fn<() => Promise<void>>(),
    getDiffRenderOptions: () => ({ theme: "pierre-light" }),
  },
}));
vi.mock("@pierre/diffs/react", () => ({
  WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => children,
  useWorkerPool: () => pool,
}));
vi.mock("@pierre/diffs/worker/worker.js?worker", () => ({ default: vi.fn() }));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { ReviewCommentDiffLoading } from "./chat/ReviewCommentDiffLoading";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pool.initialize.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it.each(["ready", "failed"] as const)(
  "retains the review patch until worker initialization is %s",
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const initialized = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    pool.initialize.mockReturnValue(initialized);
    const renderDiff = vi.fn();
    function Diff() {
      renderDiff();
      return <div data-testid="diff">Diff content</div>;
    }
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <DiffWorkerPoolProvider loadingFallback={<ReviewCommentDiffLoading patch={"-old\n+new"} />}>
          <Diff />
        </DiffWorkerPoolProvider>,
      );
    });
    expect(pool.initialize).toHaveBeenCalledTimes(1);
    expect(renderDiff).toHaveBeenCalledTimes(0);
    expect(view.root.findByType("pre").children.join("")).toBe("-old\n+new");
    expect(view.root.findByProps({ role: "status" }).children.join("")).toBe("Loading diff...");
    await act(async () => {
      if (outcome === "ready") resolve();
      else reject(new Error("worker unavailable"));
      await initialized.catch(() => {});
    });
    expect(renderDiff).toHaveBeenCalledTimes(1);
    expect(view.root.findByProps({ "data-testid": "diff" })).toBeDefined();
    expect(view.root.findAllByType("pre")).toHaveLength(0);
    await act(async () => {
      view.unmount();
    });
  },
);
