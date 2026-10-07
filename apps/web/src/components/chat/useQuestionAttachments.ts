import { useEffect, useRef, useState } from "react";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type EnvironmentId,
  type UserInputAttachments,
  type ChatImageAttachment,
  type ChatFileAttachment,
} from "@t3tools/contracts";
import { randomUUID } from "../../lib/utils";
import type { ComposerImageAttachment } from "../../composerDraftStore";
import { composerAttachmentRoute, type ComposerFileAttachment } from "../../lib/composerFiles";
import { prepareImageForAttachment } from "../../lib/imageCompression";
import {
  getUploadedAttachments,
  releaseAttachmentUploads,
  retryAttachmentUpload,
  retryFileUpload,
  startAttachmentUpload,
  startFileUpload,
  useAttachmentUploadStore,
} from "../../lib/attachmentUploadQueue";

interface QuestionFile {
  readonly questionId: string;
  readonly attachment: ComposerImageAttachment | ComposerFileAttachment;
}

/** An answer's files belong to its request and question, never the next chat draft. */
export function useQuestionAttachments(input: {
  readonly scope: string | null;
  readonly environmentId: EnvironmentId;
  readonly questionId: string | null;
  readonly supported: boolean;
  readonly onError: (message: string) => void;
}) {
  const [byScope, setByScope] = useState<Record<string, ReadonlyArray<QuestionFile>>>({});
  const [preparing, setPreparing] = useState<Record<string, number>>({});
  const uploads = useAttachmentUploadStore((state) => state.uploadsByImageId);
  const owned = useRef(new Map<string, QuestionFile["attachment"]>());
  const mounted = useRef(true);
  const reserved = useRef(new Map<string, number>());
  const retired = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    const files = owned.current;
    return () => {
      mounted.current = false;
      releaseAttachmentUploads([...files.values()]);
      for (const file of files.values())
        if (file.type === "image") URL.revokeObjectURL(file.previewUrl);
      files.clear();
    };
  }, []);
  const entries = input.scope === null ? [] : (byScope[input.scope] ?? []);
  const pending = input.scope === null ? 0 : (preparing[input.scope] ?? 0);
  const blocked =
    pending > 0 || entries.some((entry) => uploads[entry.attachment.id]?.status !== "ready");
  const current = entries.filter((entry) => entry.questionId === input.questionId);

  const add = async (files: ReadonlyArray<File>) => {
    const { scope, questionId, environmentId } = input;
    if (scope === null || questionId === null) return;
    if (!input.supported) return input.onError("This Mate cannot take question attachments yet.");
    const count = reserved.current.get(scope) ?? 0;
    if (count + files.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS)
      return input.onError(
        `Attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files to a question response.`,
      );
    reserved.current.set(scope, count + files.length);
    let accepted = 0;
    setPreparing((state) => ({ ...state, [scope]: (state[scope] ?? 0) + files.length }));
    try {
      for (const source of files) {
        const route = composerAttachmentRoute(source);
        if (route.kind === "refused") {
          input.onError(route.message);
          continue;
        }
        const id = randomUUID();
        let attachment: QuestionFile["attachment"];
        if (route.kind === "picture") {
          const prepared = await prepareImageForAttachment(
            source,
            PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
          );
          if (!mounted.current || retired.current.has(scope)) return;
          if (!prepared.ok) {
            input.onError(`Could not attach ${source.name}: ${prepared.reason}.`);
            continue;
          }
          const file = prepared.file;
          attachment = {
            type: "image",
            id,
            file,
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            previewUrl: URL.createObjectURL(file),
          };
          startAttachmentUpload({ environmentId, image: attachment });
        } else {
          attachment = {
            type: "file",
            id,
            file: source,
            name: source.name,
            mimeType: source.type,
            sizeBytes: source.size,
            uploaded: null,
          };
          startFileUpload({ environmentId, file: attachment });
        }
        accepted += 1;
        owned.current.set(id, attachment);
        const row = { questionId, attachment };
        setByScope((state) => ({ ...state, [scope]: [...(state[scope] ?? []), row] }));
      }
    } finally {
      reserved.current.set(
        scope,
        Math.max(0, (reserved.current.get(scope) ?? 0) - (files.length - accepted)),
      );
      if (mounted.current)
        setPreparing((state) => ({ ...state, [scope]: (state[scope] ?? 0) - files.length }));
    }
  };
  const remove = (id: string) => {
    const attachment = owned.current.get(id);
    if (!attachment || input.scope === null) return;
    releaseAttachmentUploads([attachment]);
    if (attachment.type === "image") URL.revokeObjectURL(attachment.previewUrl);
    owned.current.delete(id);
    const scope = input.scope;
    reserved.current.set(scope, Math.max(0, (reserved.current.get(scope) ?? 0) - 1));
    setByScope((state) => ({
      ...state,
      [scope]: (state[scope] ?? []).filter((entry) => entry.attachment.id !== id),
    }));
  };
  const retry = (id: string) => {
    const attachment = owned.current.get(id);
    if (!attachment) return;
    if (attachment.type === "image")
      retryAttachmentUpload({ environmentId: input.environmentId, image: attachment });
    else retryFileUpload({ environmentId: input.environmentId, file: attachment });
  };
  const forResponse = (): UserInputAttachments | null => {
    if (blocked) return null;
    const result: Record<string, ReadonlyArray<ChatImageAttachment | ChatFileAttachment>> = {};
    for (const { questionId, attachment } of entries) {
      const ready = getUploadedAttachments({
        environmentId: input.environmentId,
        images: attachment.type === "image" ? [attachment] : [],
        files: attachment.type === "file" ? [attachment] : [],
      });
      if (ready === null) return null;
      result[questionId] = [
        ...(result[questionId] ?? []),
        ...ready.filter(
          (file): file is ChatImageAttachment | ChatFileAttachment =>
            file.type === "image" || file.type === "file",
        ),
      ];
    }
    return result;
  };
  return {
    current,
    entries,
    pending,
    blocked,
    uploads,
    add,
    remove,
    retry,
    forResponse,
    clear: () => {
      if (input.scope !== null) retired.current.add(input.scope);
      for (const entry of entries) remove(entry.attachment.id);
    },
  };
}
