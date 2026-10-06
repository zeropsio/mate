/**
 * "Add a Mate to this project", asked from anywhere — a project's heading in the left menu, its
 * menu, the projects page — and answered over whatever the person is looking at: the New Mate
 * dialog opens in place (`ZeropsNewMateHost`), and once the platform has taken the Mate's project
 * the person lands on the new Mate, where it comes up (`/mate/$projectId`). The owner, 2026-09-29,
 * of a + that took them to the projects screen and left them there: it "leaves the conversation".
 *
 * Two things of the screen, never of the account's data: the one ask in the air — which project
 * the dialog is open over, and, started over, what it was asked with — and the conversation a new
 * Mate's own view is handing over to, kept read across the route changing. A reload forgets both.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { create } from "zustand";

/**
 * An Add started over: the Mate's own name and the face it was asked with.
 */
export interface NewMateAgain {
  readonly botName: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
}

interface NewMateDialogState {
  /**
   * The project a Mate was asked for, and when — and, started over, what it was asked with: one
   * ask at a time.
   */
  readonly asked: {
    readonly groupId: string;
    readonly at: number;
    readonly again?: NewMateAgain | undefined;
  } | null;
  readonly ask: (groupId: string, again?: NewMateAgain) => void;
  readonly dismiss: () => void;
}

/** The New Mate dialog: open over the project asked for, or closed. */
export const useNewMateDialog = create<NewMateDialogState>((set) => ({
  asked: null,
  ask: (groupId, again) => {
    set({ asked: { groupId, at: Date.now(), ...(again === undefined ? {} : { again }) } });
  },
  dismiss: () => {
    set({ asked: null });
  },
}));

interface MateHandOverState {
  /**
   * The conversation a new Mate's view is handing over to: kept read from above every view while
   * the route changes (`ZeropsNewMateHost`), so the conversation finds it read and paints the
   * frame the view last showed, never a loading pane.
   */
  readonly handOver: ScopedThreadRef | null;
  readonly handingOver: (conversation: ScopedThreadRef | null) => void;
}

export const useMateHandOver = create<MateHandOverState>((set) => ({
  handOver: null,
  handingOver: (conversation) => {
    set({ handOver: conversation });
  },
}));

/** Asks for a Mate in a project: the New Mate dialog opens over the view on screen. */
export function useAddMate(): (groupId: string) => void {
  return useNewMateDialog((state) => state.ask);
}

/** Where a new Mate lives until it is up: its own view, by the project the platform made for it. */
export function newMateView(projectId: string): {
  readonly to: "/mate/$projectId";
  readonly params: { readonly projectId: string };
} {
  return { to: "/mate/$projectId", params: { projectId } };
}
