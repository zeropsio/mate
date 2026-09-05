import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsSessionView } from "@t3tools/client-runtime/zerops/model";
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

import type { ZeropsStripState } from "@t3tools/client-runtime/zerops/strip";
import { ZeropsLifecycleStrip, ZeropsStripLine } from "./ZeropsLifecycleStrip";

const THREAD_REF: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const SESSION: ZeropsSessionView = { phase: "idle", serviceCount: 0 };

const render = (state: ZeropsStripState | undefined): string =>
  renderToStaticMarkup(<ZeropsStripLine onOpen={() => {}} state={state} />);

describe("ZeropsStripLine", () => {
  it("renders a full-width lifecycle band with the canonical label", () => {
    const html = render({ tone: "active", label: "developing kanbandev" });

    expect(html).toContain("developing kanbandev");
    expect(html).toContain('data-zerops-strip-tone="active"');
    expect(html).toContain('data-zerops-lifecycle-band="true"');
    expect(html).toContain('data-zerops-primitive="status-dot"');
    expect(html).toContain("h-7");
    expect(html).toContain("w-full");
  });

  it("renders nothing when the thread has no Zerops state", () => {
    expect(render(undefined)).toBe("");
  });

  it("uses a stepped reduced-motion-safe pulse only while something is running", () => {
    const active = render({ tone: "active", label: "zerops_deploy running" });

    expect(active).toContain("animate-status-pulse");
    expect(active).toContain("motion-reduce:animate-none");
    expect(active).not.toContain("animate-spin");
    expect(render({ tone: "done", label: "task complete" })).not.toContain("animate-status-pulse");
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
  });

  it("renders nothing for an absent thread, even with a session", () => {
    const html = renderToStaticMarkup(
      <ZeropsLifecycleStrip
        pendingUserInput={false}
        running={undefined}
        session={SESSION}
        threadRef={null}
      />,
    );

    expect(html).toBe("");
  });

  it.each([
    {
      name: "with the panel closed and attention present",
      agentAuthNeedsAttention: true,
      zeropsPanelOpen: false,
      showsEntry: true,
    },
    {
      name: "with the panel open and attention present",
      agentAuthNeedsAttention: true,
      zeropsPanelOpen: true,
      showsEntry: false,
    },
    {
      name: "with the panel closed after attention clears",
      agentAuthNeedsAttention: false,
      zeropsPanelOpen: false,
      showsEntry: false,
    },
    {
      name: "with the panel open after attention clears",
      agentAuthNeedsAttention: false,
      zeropsPanelOpen: true,
      showsEntry: false,
    },
  ] as const)(
    "keeps panel entry visible when authorization needs attention: $name",
    ({ agentAuthNeedsAttention, zeropsPanelOpen, showsEntry }) => {
      const html = renderToStaticMarkup(
        <ZeropsLifecycleStrip
          agentAuthNeedsAttention={agentAuthNeedsAttention}
          pendingUserInput={false}
          running={undefined}
          session={undefined}
          threadRef={THREAD_REF}
          zeropsPanelOpen={zeropsPanelOpen}
        />,
      );

      expect(html.includes('data-zerops-agent-auth-attention="true"')).toBe(showsEntry);
      expect(testState.onOpen !== null).toBe(showsEntry);

      testState.onOpen?.();
      expect(testState.open).toHaveBeenCalledTimes(showsEntry ? 1 : 0);
      if (showsEntry) {
        expect(testState.open).toHaveBeenCalledWith(THREAD_REF, "zerops");
      }
    },
  );

  it("opens the panel with the same scoped thread ref object", () => {
    renderToStaticMarkup(
      <ZeropsLifecycleStrip
        pendingUserInput={false}
        running={undefined}
        session={SESSION}
        threadRef={THREAD_REF}
      />,
    );

    expect(testState.onOpen).not.toBeNull();
    testState.onOpen?.();

    expect(testState.open).toHaveBeenCalledWith(THREAD_REF, "zerops");
    expect(testState.open.mock.calls[0]?.[0]).toBe(THREAD_REF);
  });
});
