/**
 * Which Mate the left menu is peeking at, and a surface's ask to show one.
 *
 * One peek at a time. A peek opened by hovering a row is the pointer's: it
 * closes when the pointer leaves the row and the peek both, and a hover never
 * takes over a peek somebody pinned. A pinned one — opened with Space, from
 * the header's waiting faces, or a hover peek somebody worked in — stays
 * until it is closed.
 *
 * `reveal` is how a surface outside the tree (the header's waiting faces)
 * asks it to show a Mate: open its project, take its row into view and focus,
 * and pin its peek. Each ask is its own, so asking for the same Mate twice
 * shows it twice.
 */
import { create } from "zustand";

export type SidebarPeekMode = "hover" | "pinned";

export interface SidebarPeekState {
  readonly peek: { readonly projectId: string; readonly mode: SidebarPeekMode } | null;
  readonly revealing: { readonly projectId: string; readonly seq: number } | null;
  /** A Mate whose menu somebody asked for from its peek — a phone has no hover and no right-click. */
  readonly menuFor: string | null;
  /**
   * Every Mate the menu holds, in the order it draws them — collapsed
   * projects included — so "the next one" means the one under it.
   */
  readonly mateOrder: ReadonlyArray<string>;
  /** The Mate the eye is on: the row with the focus, or the one last peeked. */
  readonly cursor: string | null;
  readonly open: (projectId: string, mode: SidebarPeekMode) => void;
  /** The pointer left `projectId`'s row and its peek. */
  readonly leave: (projectId: string) => void;
  readonly pin: () => void;
  readonly close: () => void;
  readonly reveal: (projectId: string) => void;
  readonly askForMenu: (projectId: string | null) => void;
  readonly setMateOrder: (order: ReadonlyArray<string>) => void;
  readonly setCursor: (projectId: string | null) => void;
}

export const useSidebarPeek = create<SidebarPeekState>((set, get) => ({
  peek: null,
  revealing: null,
  menuFor: null,
  mateOrder: [],
  cursor: null,
  open: (projectId, mode) => {
    const { peek } = get();
    if (mode === "hover" && peek?.mode === "pinned") return;
    if (peek?.projectId === projectId && peek.mode === mode) return;
    set({ peek: { projectId, mode }, cursor: projectId });
  },
  leave: (projectId) => {
    const { peek } = get();
    if (peek?.projectId === projectId && peek.mode === "hover") set({ peek: null });
  },
  pin: () => {
    const { peek } = get();
    if (peek !== null && peek.mode !== "pinned") set({ peek: { ...peek, mode: "pinned" } });
  },
  close: () => {
    if (get().peek !== null) set({ peek: null });
  },
  reveal: (projectId) => {
    set({ revealing: { projectId, seq: (get().revealing?.seq ?? 0) + 1 } });
  },
  askForMenu: (projectId) => {
    if (get().menuFor !== projectId) set({ menuFor: projectId });
  },
  setMateOrder: (order) => {
    const current = get().mateOrder;
    if (current.length === order.length && current.every((id, index) => id === order[index]))
      return;
    set({ mateOrder: order });
  },
  setCursor: (projectId) => {
    if (get().cursor !== projectId) set({ cursor: projectId });
  },
}));

/**
 * The first Mate after `cursor` in `order` that waits on somebody, round from
 * the top; from the top where nothing is in view. The one Mate that waits is
 * its own next.
 */
export function nextWaitingMate(
  order: ReadonlyArray<string>,
  waiting: ReadonlySet<string>,
  cursor: string | null,
): string | undefined {
  const start = cursor === null ? -1 : order.indexOf(cursor);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(start + step + order.length) % order.length];
    if (candidate !== undefined && waiting.has(candidate)) return candidate;
  }
  return undefined;
}
