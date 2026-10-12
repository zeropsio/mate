/**
 * The menu's one quiet way to a Chief, under the Overview row of a person who has none: an offer
 * to set one up, the setup while it runs, or that it stopped. Each opens the setup's dialog.
 */
import { ChevronRightIcon } from "lucide-react";

export type ChiefSetupLineState = "offer" | "running" | "stopped";

const WORDS: Readonly<Record<ChiefSetupLineState, string>> = {
  offer: "Set up your Chief",
  running: "Setting up your Chief…",
  stopped: "Your Chief's setup stopped",
};

export function SidebarChiefSetupLine({
  state,
  onOpen,
}: {
  readonly state: ChiefSetupLineState;
  readonly onOpen: () => void;
}) {
  return (
    <button
      className="flex min-w-0 items-center gap-1 ps-2 pt-1 text-start text-xs text-muted-foreground hover:text-foreground"
      data-chief-setup={state}
      data-zerops-surface="sidebar-chief-setup"
      onClick={onOpen}
      type="button"
    >
      <span className={state === "stopped" ? "truncate text-destructive-foreground" : "truncate"}>
        {WORDS[state]}
      </span>
      <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0" />
    </button>
  );
}
