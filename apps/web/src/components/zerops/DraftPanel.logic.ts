import { draftAbsentLine, draftStateLine } from "@t3tools/client-runtime/zerops/partLook";
import type { DraftLook } from "@t3tools/client-runtime/zerops/draftLook";
import { isBrowsableUrl } from "@t3tools/client-runtime/zerops/mateParts";
import type { ZeropsDraftCopy, ZeropsDraftPreview } from "@t3tools/contracts";
import type { LinkedChangeState } from "~/zerops/useLinkedChange";

/** `ended` carries the copy zcp answered `draft ended` for; none when the pane let it go itself. */
export type DraftPaneState =
  | { readonly kind: "idle" }
  | { readonly kind: "ended"; readonly copy?: ZeropsDraftCopy }
  | { readonly kind: "opening"; readonly copy: ZeropsDraftCopy; readonly invalidated?: true }
  | { readonly kind: "showing"; readonly copy: ZeropsDraftCopy; readonly url: string }
  | { readonly kind: "failed"; readonly copy: ZeropsDraftCopy; readonly reason: string };
export type DraftPaneEvent =
  | { readonly type: "mount" | "reload" | "retry"; readonly copy: ZeropsDraftCopy }
  | { readonly type: "answer"; readonly answer: ZeropsDraftPreview }
  | { readonly type: "invalidate"; readonly inFlight: boolean }
  | { readonly type: "error"; readonly reason: string };

export const sameCopy = (a: ZeropsDraftCopy, b: ZeropsDraftCopy) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Each opening is one person's act; an act cannot start a second in-flight call. */
export function draftPane(state: DraftPaneState, event: DraftPaneEvent): DraftPaneState {
  if (event.type === "invalidate") {
    if (state.kind === "opening" && (state.invalidated === true || event.inFlight))
      return state.invalidated === true ? state : { ...state, invalidated: true };
    return state.kind === "ended" ? state : { kind: "ended" };
  }
  if ("copy" in event)
    return state.kind === "opening" ? state : { kind: "opening", copy: event.copy };
  if (state.kind !== "opening") return state;
  if (state.invalidated === true) return { kind: "ended" };
  if (event.type === "error") return { kind: "failed", copy: state.copy, reason: event.reason };
  if (event.answer.status === "running")
    return { kind: "showing", copy: state.copy, url: event.answer.url };
  if (event.answer.reason === "draft ended") return { kind: "ended", copy: state.copy };
  return { kind: "failed", copy: state.copy, reason: event.answer.reason };
}

/**
 * What the pane draws: the Draft's frame, or the line said in its place, never neither; whether
 * the draft is still not in the app, zcp's state line, and the presses it offers.
 */
export interface DraftPaneFace {
  readonly notInApp: boolean;
  readonly stateLine: string | undefined;
  readonly frame: string | undefined;
  readonly line: string | undefined;
  readonly reload: boolean;
  readonly retry: boolean;
}

const OPENING = "Opening the draft…";

/** The pane over a change it holds: `draftLook`'s answer and the pane's own opening. */
export function draftPaneFace(
  look: DraftLook,
  state: DraftPaneState,
  mateName: string,
): DraftPaneFace {
  if (look.kind !== "openable")
    return {
      notInApp: look.kind === "unavailable",
      stateLine: undefined,
      frame: undefined,
      line: draftAbsentLine(look, mateName),
      reload: false,
      retry: false,
    };
  const face = (line: string | undefined, frame?: string) => ({
    notInApp: true,
    stateLine: draftStateLine(look.state),
    frame,
    line,
    reload: state.kind !== "opening",
    retry: state.kind === "failed",
  });
  switch (state.kind) {
    case "idle":
    case "opening":
      return face(OPENING);
    case "failed":
      return face(state.reason);
    case "showing":
      if (!sameCopy(state.copy, look.copy)) return face(OPENING);
      return isBrowsableUrl(state.url)
        ? face(undefined, state.url)
        : face("The draft could not be shown here.");
    case "ended":
      // zcp's word that this copy is no longer the draft's outranks a feed still listing it.
      return state.copy !== undefined && sameCopy(state.copy, look.copy)
        ? face(draftAbsentLine({ kind: "unavailable", why: "none" }, mateName))
        : face("Reload to open the draft.");
  }
}

/** The pane over a change neither of HQ's lists holds: HQ's own read of it. */
export function unheldDraftFace(read: LinkedChangeState): DraftPaneFace {
  return {
    notInApp: false,
    stateLine: undefined,
    frame: undefined,
    line:
      read.kind === "gone"
        ? "This draft no longer exists."
        : read.kind === "refused" || read.kind === "unavailable"
          ? read.reason
          : "Reading this draft…",
    reload: false,
    retry: false,
  };
}
