/**
 * *New project*, asked from anywhere — the left menu's header button, its pinned row and its
 * empty state, ⌘K, the projects page's first run — and answered over whatever the person is
 * looking at: the New project dialog opens in place (`ZeropsNewProjectHost`), of the family New
 * Mate belongs to (board D1, 2026-09-30), and nothing navigates to answer it. Create lands the
 * person on the first Mate's own view (`newProjectBirth.ts`).
 *
 * `/zerops/new`, the page this dialog replaced, asks here too and hands the route to the projects
 * page, so a link to it still opens the dialog.
 *
 * The store holds the one ask in the air; a reload forgets it.
 */
import { create } from "zustand";

interface NewProjectAskState {
  /** When New project was asked for: one ask at a time. */
  readonly asked: number | null;
  readonly ask: () => void;
  readonly dismiss: () => void;
}

export const useNewProjectAsk = create<NewProjectAskState>((set) => ({
  asked: null,
  ask: () => {
    set({ asked: Date.now() });
  },
  dismiss: () => {
    set({ asked: null });
  },
}));

/** Asks for a new project: the New project dialog opens over the view on screen. */
export function askNewProject(): void {
  useNewProjectAsk.getState().ask();
}

/** `askNewProject`, for a component's handlers. */
export function useAskNewProject(): () => void {
  return useNewProjectAsk((state) => state.ask);
}
