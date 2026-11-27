import type { ZeropsDraftCopy, ZeropsDraftPreview } from "@t3tools/contracts";

export type DraftPaneState =
  | { readonly kind: "idle" | "ended" }
  | { readonly kind: "opening"; readonly copy: ZeropsDraftCopy }
  | { readonly kind: "showing"; readonly copy: ZeropsDraftCopy; readonly url: string }
  | { readonly kind: "failed"; readonly copy: ZeropsDraftCopy; readonly reason: string };
export type DraftPaneEvent =
  | { readonly type: "mount" | "reload" | "retry"; readonly copy: ZeropsDraftCopy }
  | { readonly type: "answer"; readonly answer: ZeropsDraftPreview }
  | { readonly type: "invalidate" }
  | { readonly type: "error"; readonly reason: string };

/** Each opening is one person's act; an act cannot start a second in-flight call. */
export function draftPane(state: DraftPaneState, event: DraftPaneEvent): DraftPaneState {
  if (event.type === "invalidate") return state.kind === "ended" ? state : { kind: "ended" };
  if ("copy" in event)
    return state.kind === "opening" ? state : { kind: "opening", copy: event.copy };
  if (state.kind !== "opening") return state;
  if (event.type === "error") return { kind: "failed", copy: state.copy, reason: event.reason };
  if (event.answer.status === "running")
    return { kind: "showing", copy: state.copy, url: event.answer.url };
  if (event.answer.reason === "draft ended") return { kind: "ended" };
  return { kind: "failed", copy: state.copy, reason: event.answer.reason };
}
