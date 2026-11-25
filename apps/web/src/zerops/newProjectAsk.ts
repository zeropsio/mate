/**
 * *New project*, asked from anywhere — the left menu's header button, its pinned row and its
 * empty state, ⌘K. The host (`ZeropsNewProjectHost`) answers by taking the person to the New
 * project page, `/zerops/new`, in the main column beside the menu. Create lands the person on the
 * first Mate's own view (`newProjectBirth.ts`).
 *
 * The store holds the one ask in the air until the host answers it; a reload forgets it.
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

/** Asks for a new project: the person is taken to the New project page. */
export function askNewProject(): void {
  useNewProjectAsk.getState().ask();
}

/** `askNewProject`, for a component's handlers. */
export function useAskNewProject(): () => void {
  return useNewProjectAsk((state) => state.ask);
}
