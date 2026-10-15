/**
 * A Chief's way out to its organization, in every header the Chief wears — its conversation's, the
 * Chief page's, its view while it comes up: *Overview*, the overview's cards in the conversation's
 * right panel, or the overview page where there is no conversation to hold a panel.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LayersIcon } from "lucide-react";

import { useRightPanelStore } from "~/rightPanelStore";

import { Button } from "../../ui/button";

export function ChiefOverviewButton({
  threadRef,
}: {
  /** The conversation whose panel holds the overview; null opens the overview page. */
  readonly threadRef: ScopedThreadRef | null;
}) {
  const navigate = useNavigate();
  return (
    <Button
      aria-label="Overview"
      data-chat-header-ghost
      data-zerops-surface="chief-overview"
      onClick={() => {
        if (threadRef === null) void navigate({ to: "/zerops" });
        else useRightPanelStore.getState().open(threadRef, "overview");
      }}
      size="md"
      variant="ghost-muted"
    >
      <LayersIcon className="size-3.5 shrink-0" />
      <span className="hidden text-line @3xl/header-actions:inline">Overview</span>
    </Button>
  );
}
