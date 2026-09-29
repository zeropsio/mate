/**
 * A new Mate's first minutes, as this tab holds them: each creation this tab made since the
 * platform took its project — who it is and, if a step after that failed, why, which its row and
 * its view say with the projects page's *Remove* (`mateComing.ts`) — and the conversation its own
 * view is handing over to, kept read across the route changing (`ZeropsNewMateHost`). A reload
 * forgets both: the birth, which the account keeps (`zeropsBirths.ts`), carries it on.
 */
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

/** A creation this tab made, from the moment the platform took its project. */
export interface NewMateCreation {
  readonly projectId: string;
  readonly groupId: string;
  /** Its project's name, as the dialog said it. */
  readonly groupName: string;
  /** What the Mate is called. */
  readonly botName: string;
  readonly face: ZeropsMateFace;
  /** Why a step after the platform took the project failed; absent while it runs or once through. */
  readonly failed?: string | undefined;
}

interface NewMateState {
  readonly creations: Readonly<Record<string, NewMateCreation>>;
  /**
   * The conversation a new Mate's view is handing over to: kept read from above every view while
   * the route changes (`ZeropsNewMateHost`), so the conversation finds it read and paints the
   * frame the view last showed, never a loading pane.
   */
  readonly handOver: ScopedThreadRef | null;
  readonly handingOver: (conversation: ScopedThreadRef | null) => void;
  /** Its project is gone: nothing more is said of it. */
  readonly forget: (projectId: string) => void;
}

export const useNewMate = create<NewMateState>((set) => ({
  creations: {},
  handOver: null,
  handingOver: (conversation) => {
    set({ handOver: conversation });
  },
  forget: (projectId) => {
    set((state) => {
      if (state.creations[projectId] === undefined) return state;
      const { [projectId]: _gone, ...rest } = state.creations;
      return { creations: rest };
    });
  },
}));

/** Where a new Mate lives until it is up: its own view, by the project the platform made for it. */
export function newMateView(projectId: string): {
  readonly to: "/mate/$projectId";
  readonly params: { readonly projectId: string };
} {
  return { to: "/mate/$projectId", params: { projectId } };
}
