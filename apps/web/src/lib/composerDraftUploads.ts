import type { ScopedThreadRef } from "@t3tools/contracts";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { releaseAttachmentUploads } from "./attachmentUploadQueue";

export function releaseComposerDraftUploads(target: ScopedThreadRef | DraftId): void {
  const draft = useComposerDraftStore.getState().getComposerDraft(target);
  if (draft) {
    releaseAttachmentUploads(draft.images);
    releaseAttachmentUploads(draft.files);
  }
}
