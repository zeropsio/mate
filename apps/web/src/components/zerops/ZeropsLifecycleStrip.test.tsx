import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type ZeropsLifecycle,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  onOpen: null as (() => void) | null,
  open: vi.fn(),
  useZeropsLifecycle: vi.fn<() => ZeropsLifecycle | undefined>(() => undefined),
}));

vi.mock("~/components/ui/tooltip", async (importOriginal) => {
  const React = await import("react");
  const original = await importOriginal<typeof import("~/components/ui/tooltip")>();

  return {
    ...original,
    TooltipTrigger: ({
      children,
      render,
    }: {
      readonly children: React.ReactNode;
      readonly render: React.ReactElement<{ readonly onClick?: () => void }>;
    }) => {
      testState.onOpen = render.props.onClick ?? null;
      return React.cloneElement(render, undefined, children);
    },
  };
});

vi.mock("../../rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({ open: testState.open }),
  },
}));

vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsLifecycle: testState.useZeropsLifecycle,
}));

import type { ZeropsStripState } from "@t3tools/client-runtime/zerops/strip";
import { ZeropsLifecycleStrip, ZeropsStripLine } from "./ZeropsLifecycleStrip";

const THREAD_REF: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const LIFECYCLE = {
  threadId: THREAD_REF.threadId,
  recentTools: [],
  envelope: {
    phase: "idle",
    environment: "container",
    project: { id: "project-1", name: "z3-eval" },
    services: [],
    generated: "2026-08-30T12:00:00.000Z",
  },
} as unknown as ZeropsLifecycle;

const render = (state: ZeropsStripState | undefined): string =>
  renderToStaticMarkup(<ZeropsStripLine onOpen={() => {}} state={state} />);

describe("ZeropsStripLine", () => {
  it("renders the phrase and marks its tone", () => {
    const html = render({ tone: "active", label: "developing kanbandev" });

    expect(html).toContain("developing kanbandev");
    expect(html).toContain('data-zerops-strip-tone="active"');
    expect(html).toContain("data-zerops-lifecycle-strip");
  });

  it("renders nothing when the thread has no Zerops state", () => {
    expect(render(undefined)).toBe("");
  });

  it("spins only while something is running", () => {
    expect(render({ tone: "active", label: "zerops_deploy running" })).toContain("animate-spin");
    expect(render({ tone: "done", label: "task complete" })).not.toContain("animate-spin");
  });

  it("colours a waiting strip differently from a finished one", () => {
    expect(render({ tone: "waiting", label: "waiting for you" })).toContain(
      "text-warning-foreground",
    );
    expect(render({ tone: "done", label: "task complete" })).toContain("text-success-foreground");
  });

  /** The tooltip popup is portalled and only exists once open, so the label a
   * screen reader gets is what the static markup can prove. */
  it("is a labelled button, so the map is one click away", () => {
    const html = render({ tone: "idle", label: "infrastructure ready · 3 services" });

    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Zerops: infrastructure ready · 3 services"');
  });
});

describe("ZeropsLifecycleStrip", () => {
  beforeEach(() => {
    testState.onOpen = null;
    testState.open.mockReset();
    testState.useZeropsLifecycle.mockClear();
  });

  it.each([
    {
      name: "an absent thread",
      threadRef: null,
      expectedIds: [null, null],
    },
    {
      name: "the scoped thread",
      threadRef: THREAD_REF,
      expectedIds: [THREAD_REF.environmentId, THREAD_REF.threadId],
    },
  ] as const)("subscribes to $name", ({ threadRef, expectedIds }) => {
    renderToStaticMarkup(<ZeropsLifecycleStrip pendingUserInput={false} threadRef={threadRef} />);

    expect(testState.useZeropsLifecycle).toHaveBeenCalledWith(...expectedIds);
  });

  it("opens the panel with the same scoped thread ref object", () => {
    testState.useZeropsLifecycle.mockReturnValueOnce(LIFECYCLE);
    renderToStaticMarkup(<ZeropsLifecycleStrip pendingUserInput={false} threadRef={THREAD_REF} />);

    expect(testState.onOpen).not.toBeNull();
    testState.onOpen?.();

    expect(testState.open).toHaveBeenCalledWith(THREAD_REF, "zerops");
    expect(testState.open.mock.calls[0]?.[0]).toBe(THREAD_REF);
  });
});
