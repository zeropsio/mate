/**
 * When a person's connection to a Mate asks for its next ticket (spec-mate §3.8): a reconnect is a
 * new ticket, 2, 4, 8, 15 and 30 s apart, then steady at 60 s for the Mate on screen and 5 min for
 * one in the background. Pure: every step takes the instant it happens at, so no clock is read here.
 */

/** The waits after the first five failures, in order. */
const LADDER_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;
const STEADY_ON_SCREEN_MS = 60_000;
const STEADY_BACKGROUND_MS = 300_000;

export interface ReconnectState {
  readonly failures: number;
  readonly onScreen: boolean;
  /** When the last failure happened; the wait counts from it. */
  readonly failedAtMs: number;
  readonly hidden: boolean;
  /** When a wake released the wait; the next try is due then at the latest. */
  readonly releasedAtMs: number | null;
  readonly phase: "waiting" | "trying" | "connected" | "ended";
  readonly endedBy: "not_mate_opener" | "below_floor" | null;
}

export type ReconnectEvent =
  | { readonly tag: "attempt-started" }
  | {
      readonly tag: "attempt-failed";
      readonly failure: "network" | "not_mate_opener" | "below_floor";
    }
  | { readonly tag: "connected" }
  /** A connection that was open closed. */
  | { readonly tag: "lost" }
  /** The person pressed _Try again_ after a definitive end. */
  | { readonly tag: "try-again" }
  | { readonly tag: "screen"; readonly onScreen: boolean }
  | { readonly tag: "visibility"; readonly visible: boolean }
  /** A wake, the network's return or a change of the Mate's state: try now. */
  | { readonly tag: "release"; readonly cause: "wake" | "network" | "mate-state" };

export type ReconnectView =
  | { readonly kind: "waiting"; readonly dueAtMs: number; readonly inMs: number }
  | { readonly kind: "trying" }
  | { readonly kind: "connected" }
  | { readonly kind: "ended"; readonly reason: "not_mate_opener" | "below_floor" }
  /** The tab is hidden: no wait runs, and the next try comes when it is seen again. */
  | { readonly kind: "paused" };

export const initialReconnect = (): ReconnectState => ({
  failures: 0,
  onScreen: true,
  failedAtMs: 0,
  hidden: false,
  releasedAtMs: null,
  phase: "waiting",
  endedBy: null,
});

export function reconnectStep(
  state: ReconnectState,
  event: ReconnectEvent,
  atMs: number,
): ReconnectState {
  switch (event.tag) {
    case "attempt-started":
      return state.phase === "ended" ? state : { ...state, phase: "trying" };
    case "attempt-failed":
      return event.failure === "network"
        ? {
            ...state,
            phase: "waiting",
            failures: state.failures + 1,
            failedAtMs: atMs,
            releasedAtMs: null,
          }
        : { ...state, phase: "ended", endedBy: event.failure };
    case "connected":
      return { ...state, phase: "connected", failures: 0, releasedAtMs: null };
    case "lost":
      return {
        ...state,
        phase: "waiting",
        failures: 1,
        failedAtMs: atMs,
        releasedAtMs: null,
      };
    case "try-again":
      return state.phase === "ended"
        ? { ...state, phase: "waiting", failures: 0, endedBy: null, releasedAtMs: atMs }
        : state;
    case "screen":
      return { ...state, onScreen: event.onScreen };
    case "release":
      return state.phase === "waiting" ? { ...state, releasedAtMs: atMs } : state;
    case "visibility":
      return event.visible
        ? {
            ...state,
            hidden: false,
            releasedAtMs: state.phase === "waiting" ? atMs : state.releasedAtMs,
          }
        : { ...state, hidden: true };
  }
}

const waitAfter = (failures: number, onScreen: boolean): number =>
  failures === 0
    ? 0
    : failures <= LADDER_MS.length
      ? LADDER_MS[failures - 1]!
      : onScreen
        ? STEADY_ON_SCREEN_MS
        : STEADY_BACKGROUND_MS;

export function reconnectView(state: ReconnectState, nowMs: number): ReconnectView {
  if (state.phase === "ended" && state.endedBy !== null)
    return { kind: "ended", reason: state.endedBy };
  if (state.phase === "connected") return { kind: "connected" };
  if (state.phase === "trying") return { kind: "trying" };
  if (state.hidden) return { kind: "paused" };
  const dueAtMs =
    state.releasedAtMs ?? state.failedAtMs + waitAfter(state.failures, state.onScreen);
  return { kind: "waiting", dueAtMs, inMs: Math.max(0, dueAtMs - nowMs) };
}
