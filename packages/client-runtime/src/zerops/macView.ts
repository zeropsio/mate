/**
 * Pure client-side reads of the Mac's live view (the Mac tab): the fold of its
 * event stream into what the panel shows. UI-free and platform-free.
 */
import type {
  ZeropsMacFrame,
  ZeropsMacStreamEvent,
  ZeropsMacStreamStatus,
} from "@t3tools/contracts";

/** What the view shows: its state, and the window while it is live. */
export interface ZeropsMacViewState {
  readonly status: ZeropsMacStreamStatus;
  /** The paired Mac's name, once known. */
  readonly macName?: string;
  /** The app the view follows, once an agent opened one. */
  readonly app?: string;
  /** Someone is working on the Mac: input from the view would take over their screen. */
  readonly inUse: boolean;
  /** While the view waits on the person (not paired, not answering, an old pairing): what they run on the Mac. */
  readonly pairCommands?: ReadonlyArray<string>;
  /** The latest window while `live`; absent otherwise, so an old window never passes for current. */
  readonly frame?: ZeropsMacFrame;
}

export const INITIAL_MAC_VIEW_STATE: ZeropsMacViewState = { status: "connecting", inUse: false };

/** Pure fold: each state event says the whole state; a frame replaces the last one. */
export function foldMacViewEvent(
  state: ZeropsMacViewState,
  event: ZeropsMacStreamEvent,
): ZeropsMacViewState {
  if (event.type === "frame") return { ...state, frame: event };
  return {
    status: event.status,
    ...(event.macName === undefined ? {} : { macName: event.macName }),
    ...(event.app === undefined ? {} : { app: event.app }),
    inUse: event.inUse,
    ...(event.pairCommands === undefined ? {} : { pairCommands: event.pairCommands }),
    ...(event.status === "live" && state.frame !== undefined && state.app === event.app
      ? { frame: state.frame }
      : {}),
  };
}
