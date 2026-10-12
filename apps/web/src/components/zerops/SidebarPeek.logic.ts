/**
 * When the closed menu peeks (`SidebarPeek.tsx`): a pointer resting on the rail slides the open
 * menu out over the page, and leaving it for a moment puts it back (the owner, 2026-10-12: "imo
 * I'd go for peek, but it needs to be smooth and fully smoothly connected to the open state").
 *
 * Rest is intent: the pointer has stood still for a beat, so a pointer crossing the rail to the
 * page never peeks. Only a mouse peeks — a touch has no hover, and a tap opens the menu as before.
 * And a click lands on what the person aimed at: only a rest on the rail's own surface — a pod,
 * its name, the air between — peeks. A face, Overview and the foot's buttons keep their own hover
 * and their click, and a press anywhere on the rail cancels a peek on its way.
 */

/** How long a pointer stands on the rail before the menu peeks. */
export const PEEK_REST_MS = 120;
/** How long the peek stays after the pointer leaves it. */
export const PEEK_GRACE_MS = 200;
/** A pointer moving less than this has not left its rest: a hand's tremble. */
const PEEK_REST_RADIUS = 4;

export type PeekPhase = "rest" | "arming" | "peek" | "leaving";

export interface PeekState {
  readonly phase: PeekPhase;
  /** Where the pointer began its rest, while arming. */
  readonly anchor?: { readonly x: number; readonly y: number } | undefined;
  /** At rest after the menu closed under the pointer: no peek until the pointer comes again. */
  readonly quiet?: boolean | undefined;
}

export type PeekInput =
  | {
      readonly kind: "enter" | "move";
      readonly pointer: string;
      readonly x: number;
      readonly y: number;
      /** Over the rail's own surface, or one of its controls. */
      readonly on: "surface" | "control";
    }
  | { readonly kind: "leave" }
  /** A pointer pressed down on the rail or the peek. */
  | { readonly kind: "press" }
  /**
   * The wait the last step asked for is over; `held` while something inside the peek needs it — a
   * menu opened from it, a field being typed in.
   */
  | { readonly kind: "due"; readonly held: boolean }
  /** The menu docked: it stands open where the peek stood. */
  | { readonly kind: "dock" }
  /** Escape, or the docked menu closed: back to the rail until the pointer comes again. */
  | { readonly kind: "close" };

export interface PeekStep {
  readonly state: PeekState;
  /** Start the one timer anew (ms), stop it (null), or let it run ("keep"). */
  readonly wait: number | null | "keep";
}

export const PEEK_AT_REST: PeekState = { phase: "rest" };

const stay = (state: PeekState): PeekStep => ({ state, wait: "keep" });
const arm = (x: number, y: number): PeekStep => ({
  state: { phase: "arming", anchor: { x, y } },
  wait: PEEK_REST_MS,
});

export function peekStep(state: PeekState, input: PeekInput): PeekStep {
  switch (input.kind) {
    case "dock":
    case "close":
      return { state: { phase: "rest", quiet: true }, wait: null };
    case "press":
      return state.phase === "arming" ? { state: PEEK_AT_REST, wait: null } : stay(state);
    case "enter":
    case "move": {
      if (state.phase === "leaving") {
        return input.kind === "enter" ? { state: { phase: "peek" }, wait: null } : stay(state);
      }
      if (state.phase === "peek" || input.pointer !== "mouse") return stay(state);
      if (input.on === "control") {
        // Coming onto a face is still coming back: the rail is no longer quiet.
        return state.phase === "arming" || input.kind === "enter"
          ? { state: PEEK_AT_REST, wait: null }
          : stay(state);
      }
      if (state.phase === "rest") {
        return state.quiet === true && input.kind === "move" ? stay(state) : arm(input.x, input.y);
      }
      const anchor = state.anchor ?? input;
      if (Math.hypot(input.x - anchor.x, input.y - anchor.y) < PEEK_REST_RADIUS) return stay(state);
      return arm(input.x, input.y);
    }
    case "leave":
      if (state.phase === "peek") return { state: { phase: "leaving" }, wait: PEEK_GRACE_MS };
      if (state.phase === "leaving") return stay(state);
      return { state: PEEK_AT_REST, wait: null };
    case "due":
      if (state.phase === "arming") return { state: { phase: "peek" }, wait: null };
      if (state.phase === "leaving") {
        return input.held ? { state, wait: PEEK_GRACE_MS } : { state: PEEK_AT_REST, wait: null };
      }
      return stay(state);
  }
}

/** Whether the open menu stands out over the page. */
export const peekShown = (state: PeekState): boolean =>
  state.phase === "peek" || state.phase === "leaving";
