/**
 * An Adobe Express design's address a Mate wrote into its conversation, opened in the panel's
 * Express tab beside it. An `AppLinkResolver`: `null` for every other address, and for every
 * address while Express is off (`useExpressGate`) or outside a conversation.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { expressDesignId, useExpressOpen } from "./expressOpen";

export function useOpenExpressDesign(
  threadRef: ScopedThreadRef | null | undefined,
  enabled: boolean,
): (href: string) => (() => void) | null {
  return useCallback(
    (href) => {
      if (!enabled || !threadRef) return null;
      const documentId = expressDesignId(href);
      if (documentId === null) return null;
      const ref = threadRef;
      return () => {
        useRightPanelStore.getState().open(ref, "express");
        useExpressOpen.getState().request({ kind: "design", documentId });
      };
    },
    [enabled, threadRef],
  );
}

/**
 * A picture in the conversation (one a Mate showed, one the person attached), opened in the
 * Express tab to edit; `undefined` while Express is off or outside a conversation.
 */
export function useEditPictureInExpress(
  threadRef: ScopedThreadRef | null | undefined,
  enabled: boolean,
): ((picture: Blob, name: string) => void) | undefined {
  const edit = useCallback(
    (picture: Blob, name: string) => {
      if (!threadRef) return;
      useRightPanelStore.getState().open(threadRef, "express");
      useExpressOpen.getState().request({ kind: "picture", picture, name });
    },
    [threadRef],
  );
  return !enabled || !threadRef ? undefined : edit;
}
