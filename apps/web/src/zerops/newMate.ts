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
import { useCallback } from "react";
import { useAddMateOffer } from "./useHqOffers";
import { onAccountLifetimeClose } from "./accountLifetime";
import { randomUUID } from "../lib/utils";

/**
 * What an Add is asked with: started over, the Mate's own name and the face it was asked with;
 * and whether it is asked for automated — started over, or from a project's pool of automated
 * Mates.
 */
export type NewMateAgain =
  | {
      readonly botName: string;
      readonly tint: MateTintId;
      readonly shape: MateShapeId;
      readonly automated?: true;
    }
  | { readonly botName?: undefined; readonly automated: true };

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
  readonly handOverId: string | null;
  readonly handingOver: (conversation: ScopedThreadRef | null) => string;
  readonly acquired: (id: string, conversation: ScopedThreadRef) => void;
  readonly cancel: (id: string) => void;
}

export const useMateHandOver = create<MateHandOverState>((set, get) => ({
  handOver: null,
  handOverId: null,
  handingOver: (conversation) => {
    // Navigation state survives reloads; a fresh handover must never reuse its token.
    const handOverId = randomUUID();
    set({ handOver: conversation, handOverId });
    return handOverId;
  },
  acquired: (id, conversation) => {
    const pending = get();
    if (
      pending.handOverId === id &&
      pending.handOver?.environmentId === conversation.environmentId &&
      pending.handOver.threadId === conversation.threadId
    )
      set({ handOver: null });
  },
  cancel: (id) => {
    if (get().handOverId === id) set({ handOver: null });
  },
}));

onAccountLifetimeClose(() => {
  useMateHandOver.getState().handingOver(null);
});

/** Asks for a Mate in a project: the New Mate dialog opens over the view on screen. */
export function useAddMate(): (groupId: string) => void {
  const ask = useNewMateDialog((state) => state.ask);
  const offer = useAddMateOffer();
  return useCallback(
    (groupId) => {
      if (offer(groupId).kind === "allowed") ask(groupId);
    },
    [ask, offer],
  );
}

/**
 * Asks for automated Mates in a project: *Add automated Mates* opens over the view on screen — from
 * the menu's Add, or a project's Automation section.
 */
export function useAddAutomatedMates(): (groupId: string) => void {
  const ask = useNewMateDialog((state) => state.ask);
  const offer = useAddMateOffer();
  return useCallback(
    (groupId) => {
      if (offer(groupId).kind === "allowed") ask(groupId, { automated: true });
    },
    [ask, offer],
  );
}

/** Where a new Mate lives until it is up: its own view, by the project the platform made for it. */
export function newMateView(projectId: string): {
  readonly to: "/mate/$projectId";
  readonly params: { readonly projectId: string };
} {
  return { to: "/mate/$projectId", params: { projectId } };
}
