/**
 * "Add a Mate to this project", asked from anywhere — a project's heading in the left menu, its
 * menu, the projects page — and answered over whatever the person is looking at: the New Mate
 * dialog opens in place (`ZeropsNewMateHost`), and once the platform has taken the Mate's project
 * the person lands on the new Mate, where it comes up (`/mate/$projectId`). The owner, 2026-09-29,
 * of a + that took them to the projects screen and left them there: it "leaves the conversation".
 *
 * The store holds the one ask in the air; each creation this tab made since the platform took its
 * project — who it is and, if a step after that failed, why, which its row and its view say with
 * the projects page's *Remove* (`mateComing.ts`); and the conversation a new Mate's own view is
 * handing over to, kept read across the route changing. A reload forgets them all: the birth,
 * which the account keeps (`zeropsBirths.ts`), carries a creation on.
 */
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { MateTintId } from "@t3tools/shared/brand";
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
  /** When the platform took it, wall ms: the store stamps it. */
  readonly at?: number | undefined;
}

/** An Add started over: the name, the environment's name and the tint it was asked with. */
export interface NewMateAgain {
  readonly botName: string;
  readonly name: string;
  readonly tint: MateTintId;
}

interface NewMateState {
  /**
   * The project a Mate was asked for, and when — and, started over, what it was asked with: one
   * ask at a time.
   */
  readonly asked: {
    readonly groupId: string;
    readonly at: number;
    readonly again?: NewMateAgain | undefined;
  } | null;
  readonly creations: Readonly<Record<string, NewMateCreation>>;
  /**
   * The conversation a new Mate's view is handing over to: kept read from above every view while
   * the route changes (`ZeropsNewMateHost`), so the conversation finds it read and paints the
   * frame the view last showed, never a loading pane.
   */
  readonly handOver: ScopedThreadRef | null;
  readonly handingOver: (conversation: ScopedThreadRef | null) => void;
  readonly ask: (groupId: string, again?: NewMateAgain) => void;
  readonly dismiss: () => void;
  /** The platform took the project of a creation this tab made. */
  readonly created: (creation: NewMateCreation) => void;
  /** Its creation ran to its end: through, or stopped on a step with the reason given. */
  readonly settled: (projectId: string, failed: string | undefined) => void;
  /** Its project is gone: nothing more is said of it. */
  readonly forget: (projectId: string) => void;
}

export const useNewMate = create<NewMateState>((set) => ({
  asked: null,
  creations: {},
  handOver: null,
  handingOver: (conversation) => {
    set({ handOver: conversation });
  },
  ask: (groupId, again) => {
    set({ asked: { groupId, at: Date.now(), ...(again === undefined ? {} : { again }) } });
  },
  dismiss: () => {
    set({ asked: null });
  },
  created: (creation) => {
    set((state) => ({
      creations: { ...state.creations, [creation.projectId]: { ...creation, at: Date.now() } },
    }));
  },
  settled: (projectId, failed) => {
    set((state) => {
      const creation = state.creations[projectId];
      if (creation === undefined || creation.failed === failed) return state;
      return { creations: { ...state.creations, [projectId]: { ...creation, failed } } };
    });
  },
  forget: (projectId) => {
    set((state) => {
      if (state.creations[projectId] === undefined) return state;
      const { [projectId]: _gone, ...rest } = state.creations;
      return { creations: rest };
    });
  },
}));

/** Asks for a Mate in a project: the New Mate dialog opens over the view on screen. */
export function useAddMate(): (groupId: string) => void {
  return useNewMate((state) => state.ask);
}

/** Where a new Mate lives until it is up: its own view, by the project the platform made for it. */
export function newMateView(projectId: string): {
  readonly to: "/mate/$projectId";
  readonly params: { readonly projectId: string };
} {
  return { to: "/mate/$projectId", params: { projectId } };
}
