/**
 * An Adobe Express design's address a Mate wrote into its conversation, opened in the panel's
 * Express tab beside it. An `AppLinkResolver`: `null` for every other address, and for every
 * address in a build without Adobe's key or outside a conversation.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { expressClientId } from "./expressSdk";
import { expressDesignId, useExpressOpen } from "./expressOpen";

export function useOpenExpressDesign(
  threadRef: ScopedThreadRef | null | undefined,
): (href: string) => (() => void) | null {
  return useCallback(
    (href) => {
      if (expressClientId === null || !threadRef) return null;
      const documentId = expressDesignId(href);
      if (documentId === null) return null;
      const ref = threadRef;
      return () => {
        useRightPanelStore.getState().open(ref, "express");
        useExpressOpen.getState().request({ kind: "design", documentId });
      };
    },
    [threadRef],
  );
}

/**
 * A picture in the conversation (one a Mate showed, one the person attached), opened in the
 * Express tab to edit; `undefined` where the app cannot take it (no Adobe key, no conversation).
 */
export function useEditPictureInExpress(
  threadRef: ScopedThreadRef | null | undefined,
): ((picture: Blob, name: string) => void) | undefined {
  const edit = useCallback(
    (picture: Blob, name: string) => {
      if (!threadRef) return;
      useRightPanelStore.getState().open(threadRef, "express");
      useExpressOpen.getState().request({ kind: "picture", picture, name });
    },
    [threadRef],
  );
  return expressClientId === null || !threadRef ? undefined : edit;
}
