// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { resolveLocalCheckoutBranchMismatch } from "./BranchToolbar.logic";
import { useBranchAdvice } from "./useBranchAdvice";
import { ComposerBannerStack } from "./chat/ComposerBannerStack";

function Advice({
  threadKey,
  currentBranch,
  draft,
}: {
  threadKey: string;
  currentBranch: string;
  draft: boolean;
}) {
  const mismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: "local",
    activeWorktreePath: null,
    activeThreadBranch: "topic",
    currentGitBranch: currentBranch,
  });
  const advice = useBranchAdvice({ threadKey, mismatch, composerHasContent: draft });
  return (
    <ComposerBannerStack
      items={
        advice.visible && advice.key
          ? [
              {
                id: advice.key,
                variant: "warning",
                icon: null,
                title: `Continue on ${currentBranch}`,
                dismissLabel: "Dismiss branch change notice",
                onDismiss: advice.dismiss,
              },
            ]
          : []
      }
    />
  );
}

describe("Decision: one derivation per state; consumers never recompute it; no new domain concepts; mobile stays out (later).", () => {
  it("keeps A and B dismissed when A returns and after remount, while a new branch pair returns", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.body.appendChild(document.createElement("div"));
    let root = createRoot(host);
    const render = async (branch: string, threadKey = "environment-a:advice-dismissal") => {
      await act(() => root.render(<Advice threadKey={threadKey} currentBranch={branch} draft />));
    };
    const dismiss = async () => {
      const button = host.querySelector<HTMLButtonElement>(
        '[aria-label="Dismiss branch change notice"]',
      );
      expect(button).not.toBeNull();
      await act(() => button!.click());
      expect(host.textContent).toBe("");
    };
    try {
      await render("A");
      await dismiss();
      await render("B");
      await dismiss();
      await render("A");
      expect(host.textContent).toBe("");
      await act(() => root.unmount());
      root = createRoot(host);
      await render("A");
      expect(host.textContent).toBe("");
      await render("C");
      expect(host.textContent).toContain("Continue on C");
      await render("A", "environment-b:advice-dismissal");
      expect(host.textContent).toContain("Continue on A");
    } finally {
      await act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
  it("reveals on draft intent, stays through clearing, and re-gates after the mismatch resolves", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const render = (branch: string, draft: boolean) =>
      act(() =>
        root.render(
          <Advice threadKey="environment-a:advice-intent" currentBranch={branch} draft={draft} />,
        ),
      );
    try {
      await render("A", false);
      expect(host.textContent).toBe("");
      await render("A", true);
      expect(host.textContent).toContain("Continue on A");
      await render("A", false);
      expect(host.textContent).toContain("Continue on A");
      await render("topic", false);
      expect(host.textContent).toBe("");
      await render("A", false);
      expect(host.textContent).toBe("");
    } finally {
      await act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
