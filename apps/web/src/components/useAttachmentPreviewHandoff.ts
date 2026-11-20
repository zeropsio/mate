import {
  createContext,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
} from "react";
import { type MessageId } from "@t3tools/contracts";
import { type ChatMessage } from "../types";
import { revokeBlobPreviewUrl, revokeUserMessagePreviewUrls } from "./ChatView.logic";

/** The picture that draws the Mate's copy of a sent picture releases its local preview once that copy is fully shown. */
export const LocalPreviewRelease = createContext<(url: string) => void>(() => {});

/** A sent picture's local preview stays under the server message's picture until the Mate's copy is shown (`releaseLocalPreview`), then is revoked; every one left is revoked when the page closes. */
export function useAttachmentPreviewHandoff({
  setAttachmentPreviewHandoffByMessageId,
  attachmentPreviewHandoffByMessageIdRef,
  optimisticUserMessagesRef,
}: {
  setAttachmentPreviewHandoffByMessageId: Dispatch<SetStateAction<Record<string, string[]>>>;
  attachmentPreviewHandoffByMessageIdRef: RefObject<Record<string, string[]>>;
  optimisticUserMessagesRef: RefObject<ChatMessage[]>;
}) {
  // The ref is the held set, written with every change so a release in the same commit reads it;
  // the state only renders it.
  const hold = useCallback((next: Record<string, string[]>) => {
    attachmentPreviewHandoffByMessageIdRef.current = next;
    setAttachmentPreviewHandoffByMessageId(next);
  }, []);
  const clearAttachmentPreviewHandoffs = useCallback(() => {
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    hold({});
  }, [hold]);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs]);
  const handoffAttachmentPreviews = useCallback(
    (messageId: MessageId, previewUrls: string[]) => {
      if (previewUrls.length === 0) return;

      const held = attachmentPreviewHandoffByMessageIdRef.current;
      const nextPreviewUrlSet = new Set(previewUrls);
      for (const previewUrl of held[messageId] ?? []) {
        if (!nextPreviewUrlSet.has(previewUrl)) {
          revokeBlobPreviewUrl(previewUrl);
        }
      }
      hold({ ...held, [messageId]: previewUrls });
    },
    [hold],
  );
  // A URL no longer held is not revoked again. A released URL leaves an empty slot, because the
  // timeline pairs an entry's URLs with the message's images by position; the entry goes once
  // every slot is empty.
  const releaseLocalPreview = useCallback(
    (url: string) => {
      const held = attachmentPreviewHandoffByMessageIdRef.current;
      const messageId = Object.keys(held).find((id) => held[id]?.includes(url));
      if (messageId === undefined) return;
      const remaining = held[messageId]!.map((previewUrl) =>
        previewUrl === url ? "" : previewUrl,
      );
      const next = { ...held };
      if (remaining.every((previewUrl) => !previewUrl)) delete next[messageId];
      else next[messageId] = remaining;
      hold(next);
      revokeBlobPreviewUrl(url);
    },
    [hold],
  );
  return { handoffAttachmentPreviews, releaseLocalPreview };
}
