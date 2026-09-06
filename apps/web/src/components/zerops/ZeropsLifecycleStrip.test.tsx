import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  onOpen: null as (() => void) | null,
  open: vi.fn(),
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

import type { ZeropsSessionView } from "@t3tools/client-runtime/zerops/model";
import { ZeropsLifecycleStrip, ZeropsStripLine } from "./ZeropsLifecycleStrip";

const THREAD_REF: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

/** A conversation the agent has worked in: it has a lifecycle. */
const UNDERWAY: ZeropsSessionView = { phase: "idle", serviceCount: 2 };

describe("ZeropsStripLine", () => {
  it("is one quiet line in the timeline's column asking for the sign-in: the dot, the sentence, a chevron", () => {
    const html = renderToStaticMarkup(<ZeropsStripLine onOpen={() => {}} />);

    expect(html).toContain("Coding agent sign-in required");
    expect(html).toContain('data-zerops-lifecycle-band="true"');
    expect(html).toContain('data-zerops-strip-tone="waiting"');
    expect(html).toContain('data-zerops-primitive="status-dot"');
    expect(html).toContain("text-warning-foreground");
    // The timeline's width, not the page's; no tint across the page, no label.
    expect(html).toContain("max-w-3xl");
    expect(html).not.toContain("surface)");
    expect(html).not.toContain("micro-label");
    expect(html).not.toContain("animate-status-pulse");
    expect(html).toContain("lucide-chevron-right");
  });

  it("is a labelled button, so the sign-in is one click away", () => {
    const html = renderToStaticMarkup(<ZeropsStripLine onOpen={() => {}} />);
    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Zerops: Coding agent sign-in required"');
  });
});

describe("ZeropsLifecycleStrip", () => {
  beforeEach(() => {
    testState.onOpen = null;
    testState.open.mockReset();
  });

  it("renders nothing for an absent thread", () => {
    expect(
      renderToStaticMarkup(
        <ZeropsLifecycleStrip agentAuthNeedsAttention session={UNDERWAY} threadRef={null} />,
      ),
    ).toBe("");
  });

  it("says nothing about the workflow: a conversation whose agents are signed in gets no line", () => {
    expect(
      renderToStaticMarkup(
        <ZeropsLifecycleStrip
          running={undefined}
          session={{ phase: "develop-active", serviceCount: 2 }}
          threadRef={THREAD_REF}
        />,
      ),
    ).toBe("");
  });

  it("asks for the sign-in only over a conversation the agent has worked in — an empty one asks in its empty state", () => {
    expect(
      renderToStaticMarkup(<ZeropsLifecycleStrip agentAuthNeedsAttention threadRef={THREAD_REF} />),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <ZeropsLifecycleStrip agentAuthNeedsAttention session={UNDERWAY} threadRef={THREAD_REF} />,
      ),
    ).toContain("Coding agent sign-in required");
  });

  it("stays out of the way while the service map is open, where the agents are", () => {
    expect(
      renderToStaticMarkup(
        <ZeropsLifecycleStrip
          agentAuthNeedsAttention
          session={UNDERWAY}
          threadRef={THREAD_REF}
          zeropsPanelOpen
        />,
      ),
    ).toBe("");
  });

  it("starts the sign-in from the line when the caller can, else opens the panel with the same scoped thread ref", () => {
    const onOpenAgentAuth = vi.fn();
    renderToStaticMarkup(
      <ZeropsLifecycleStrip
        agentAuthNeedsAttention
        onOpenAgentAuth={onOpenAgentAuth}
        session={UNDERWAY}
        threadRef={THREAD_REF}
      />,
    );
    testState.onOpen?.();
    expect(onOpenAgentAuth).toHaveBeenCalledTimes(1);
    expect(testState.open).not.toHaveBeenCalled();

    renderToStaticMarkup(
      <ZeropsLifecycleStrip agentAuthNeedsAttention session={UNDERWAY} threadRef={THREAD_REF} />,
    );
    testState.onOpen?.();
    expect(testState.open).toHaveBeenCalledWith(THREAD_REF, "zerops");
  });
});
