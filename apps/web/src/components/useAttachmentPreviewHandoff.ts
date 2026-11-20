import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect } from "react";
import { type MessageId } from "@t3tools/contracts";
import { type ChatMessage } from "../types";
import { revokeBlobPreviewUrl, revokeUserMessagePreviewUrls } from "./ChatView.logic";

/** A sent picture's local preview stays until the server's message shows its own, then is revoked (`ConversationView`); every one left is revoked when the page closes. */
export function useAttachmentPreviewHandoff({
  attachmentPreviewHandoffByMessageId,
  setAttachmentPreviewHandoffByMessageId,
  attachmentPreviewHandoffByMessageIdRef,
  optimisticUserMessagesRef,
}: {
  attachmentPreviewHandoffByMessageId: Record<string, string[]>;
  setAttachmentPreviewHandoffByMessageId: Dispatch<SetStateAction<Record<string, string[]>>>;
  attachmentPreviewHandoffByMessageIdRef: RefObject<Record<string, string[]>>;
  optimisticUserMessagesRef: RefObject<ChatMessage[]>;
}) {
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoff = useCallback(
    (messageId: MessageId, previewUrls?: ReadonlyArray<string>) => {
      const currentPreviewUrls =
        previewUrls ?? attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) {
          return existing;
        }
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      for (const previewUrl of currentPreviewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    },
    [],
  );
  const clearAttachmentPreviewHandoffs = useCallback(() => {
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs]);
  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    const nextPreviewUrlSet = new Set(previewUrls);
    for (const previewUrl of previousPreviewUrls) {
      if (!nextPreviewUrlSet.has(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
  }, []);
  return { clearAttachmentPreviewHandoff, handoffAttachmentPreviews };
}
