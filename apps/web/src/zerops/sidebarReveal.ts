/**
 * A surface's ask to show something in the left menu, and where the menu's
 * eye is.
 *
 * `reveal` is how a surface outside the tree asks it to show something: the
 * header's waiting faces a Mate, and the jump box a Mate, a project, a stop or
 * a change. Its project opens — and the quiet Mates or the list of changes it
 * is folded into — then its row takes the focus and flashes once where it
 * stands. Each ask is its own, so asking for the same thing twice shows it
 * twice, and the tree answers each once (`answerReveal`): an ask never
 * outlives the menu that answered it, so a menu drawn again later does not
 * show it again.
 *
 * The tree also writes down the order it drew its Mates in and the Mate the
 * eye is on, so "the next one that waits" means the one under it.
 */
import { create } from "zustand";

/** What a surface outside the tree asks it to show. */
export type SidebarRevealTarget =
  | { readonly kind: "mate"; readonly projectId: string }
  | { readonly kind: "project"; readonly groupId: string }
  | { readonly kind: "stop"; readonly groupId: string; readonly projectId: string }
  | {
      readonly kind: "change";
      readonly groupId: string;
      /** `repository#number`, the change's row's key. */
      readonly key: string;
      /** The Mate it hangs under, whose list may be folded. */
      readonly mateProjectId: string | undefined;
    };

export interface SidebarRevealState {
  readonly revealing: { readonly target: SidebarRevealTarget; readonly seq: number } | null;
  /**
   * Every Mate the menu holds, in the order it draws them — collapsed
   * projects included — so "the next one" means the one under it.
   */
  readonly mateOrder: ReadonlyArray<string>;
  /** The Mate the eye is on: the row that last took the focus. */
  readonly cursor: string | null;
  readonly reveal: (target: SidebarRevealTarget) => void;
  /** The tree showed ask `seq`; nothing is left to show. */
  readonly answerReveal: (seq: number) => void;
  readonly setMateOrder: (order: ReadonlyArray<string>) => void;
  readonly setCursor: (projectId: string | null) => void;
}

/** Every ask its own number, answered or not. */
let revealSeq = 0;

export const useSidebarReveal = create<SidebarRevealState>((set, get) => ({
  revealing: null,
  mateOrder: [],
  cursor: null,
  reveal: (target) => {
    revealSeq += 1;
    set({ revealing: { target, seq: revealSeq } });
  },
  answerReveal: (seq) => {
    if (get().revealing?.seq === seq) set({ revealing: null });
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
