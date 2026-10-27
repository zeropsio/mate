/**
 * The composer's files that are not pictures: a file pasted or dropped lands
 * at the caret, uploads at once, and the draft's files follow the text's
 * order as the person types, moves and deletes.
 *
 * The draft store holds each file (its bytes while this tab has them, its
 * finished upload for a reload); this hook adds and removes them, keeps a
 * file taken out of the text a while for an undo, and says what each chip
 * shows.
 */
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

import { collapseExpandedComposerCursor } from "~/composer-logic";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { releaseAttachmentUpload, retryFileUpload } from "~/lib/attachmentUploadQueue";
import type { AttachmentUploadState } from "~/lib/attachmentUploadState";
import {
  type ComposerFileAttachment,
  composerAttachmentCount,
  fileChipName,
  insertInlineFilePlaceholder,
  removeInlineFilePlaceholder,
} from "~/lib/composerFiles";
import { randomUUID } from "~/lib/utils";
import type { ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import type { ComposerFileView } from "./ComposerFile";

/** How many files taken out of the text are kept, the latest last, for an undo. */
const HELD_FILES = 12;

/** The longest name the server takes. */
const MAX_NAME_CHARS = 255;

type DraftTarget = ScopedThreadRef | DraftId;

const draftOf = (target: DraftTarget) => useComposerDraftStore.getState().getComposerDraft(target);

export interface ComposerFilesInput {
  readonly draftTarget: DraftTarget;
  readonly environmentId: EnvironmentId;
  readonly files: ReadonlyArray<ComposerFileAttachment>;
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
  readonly editorRef: RefObject<ComposerPromptEditorHandle | null>;
  readonly promptRef: RefObject<string>;
  /** The prompt was written here (a file's place came or went): the caret goes to `cursor`. */
  readonly onPromptWritten: (prompt: string, cursor: number) => void;
  /** Why no file can be added right now, or null. */
  readonly refusal: () => string | null;
  readonly onError: (message: string) => void;
}

export interface ComposerFiles {
  /** What the text shows of each file, in the order they sit. */
  readonly chips: ReadonlyArray<ComposerFileView>;
  readonly add: (files: ReadonlyArray<File>) => void;
  readonly remove: (id: string) => void;
  readonly retry: (id: string) => void;
  /**
   * The editor's files, in its order: the draft follows. A file taken out of
   * the text is kept a while and comes back with its place (an undo); a place
   * whose file is gone for good leaves the text: the prompt without it is
   * returned, or null when nothing had to go.
   */
  readonly sync: (fileIds: ReadonlyArray<string>, prompt: string) => string | null;
}

export function useComposerFiles(input: ComposerFilesInput): ComposerFiles {
  const insertFile = useComposerDraftStore((store) => store.insertFile);
  const updateFile = useComposerDraftStore((store) => store.updateFile);
  const syncFiles = useComposerDraftStore((store) => store.syncFiles);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);

  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  // Files taken out of the text, the latest last: an undo brings them back
  // with their upload, which waits with them.
  const held = useRef(new Map<string, ComposerFileAttachment>());

  const hold = useCallback((file: ComposerFileAttachment) => {
    held.current.delete(file.id);
    held.current.set(file.id, file);
    for (const id of held.current.keys()) {
      if (held.current.size <= HELD_FILES) break;
      held.current.delete(id);
      releaseAttachmentUpload(id);
    }
  }, []);

  useEffect(
    () => () => {
      for (const id of held.current.keys()) releaseAttachmentUpload(id);
      held.current.clear();
    },
    [],
  );

  const add = useCallback(
    (picked: ReadonlyArray<File>) => {
      if (picked.length === 0) return;
      const { refusal, onError, draftTarget: target, editorRef, promptRef } = latest.current;
      const refused = refusal();
      if (refused) {
        onError(refused);
        return;
      }
      const snapshot = editorRef.current?.readSnapshot();
      let prompt = snapshot?.value ?? promptRef.current;
      let cursor = snapshot?.expandedCursor ?? prompt.length;
      let added = false;
      for (const bytes of picked) {
        const draft = draftOf(target);
        if (
          composerAttachmentCount(draft?.images ?? [], draft?.files ?? []) >=
          PROVIDER_SEND_TURN_MAX_ATTACHMENTS
        ) {
          onError(
            `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} pictures and files per message.`,
          );
          break;
        }
        const insertion = insertInlineFilePlaceholder(prompt, cursor);
        insertFile(
          target,
          insertion.prompt,
          {
            type: "file",
            id: randomUUID(),
            name: fileChipName(bytes.name.trim() || "file", MAX_NAME_CHARS),
            mimeType: bytes.type || "application/octet-stream",
            sizeBytes: bytes.size,
            file: bytes,
            uploaded: null,
          },
          insertion.fileIndex,
        );
        prompt = insertion.prompt;
        cursor = insertion.cursor;
        added = true;
      }
      if (!added) return;
      promptRef.current = prompt;
      latest.current.onPromptWritten(prompt, collapseExpandedComposerCursor(prompt, cursor));
    },
    [insertFile],
  );

  const remove = useCallback(
    (id: string) => {
      const { draftTarget: target, promptRef, onPromptWritten } = latest.current;
      const files = draftOf(target)?.files ?? [];
      const index = files.findIndex((file) => file.id === id);
      if (index < 0) return;
      releaseAttachmentUpload(id);
      const removal = removeInlineFilePlaceholder(promptRef.current, index);
      syncFiles(
        target,
        files.filter((file) => file.id !== id).map((file) => file.id),
      );
      setPrompt(target, removal.prompt);
      promptRef.current = removal.prompt;
      onPromptWritten(
        removal.prompt,
        collapseExpandedComposerCursor(removal.prompt, removal.cursor),
      );
    },
    [setPrompt, syncFiles],
  );

  const retry = useCallback((id: string) => {
    const { draftTarget, environmentId } = latest.current;
    const file = draftOf(draftTarget)?.files.find((entry) => entry.id === id);
    if (file) retryFileUpload({ environmentId, file });
  }, []);

  const sync = useCallback(
    (fileIds: ReadonlyArray<string>, prompt: string): string | null => {
      const target = latest.current.draftTarget;
      const files = draftOf(target)?.files ?? [];
      const inDraft = new Set(files.map((file) => file.id));
      const returning = fileIds.flatMap((id) => {
        const file = inDraft.has(id) ? undefined : held.current.get(id);
        return file ? [file] : [];
      });
      const known = new Set([...inDraft, ...returning.map((file) => file.id)]);
      // A file has one place: a second place for it is a place without one.
      const placed = new Set<string>();
      const keeps = fileIds.map((id) => {
        if (!known.has(id) || placed.has(id)) return false;
        placed.add(id);
        return true;
      });
      for (const file of files) {
        if (!placed.has(file.id)) hold(file);
      }
      for (const file of returning) held.current.delete(file.id);
      syncFiles(
        target,
        fileIds.filter((_id, index) => keeps[index]),
        returning,
      );
      if (keeps.every(Boolean)) return null;
      let healed = prompt;
      for (let index = fileIds.length - 1; index >= 0; index -= 1) {
        if (!keeps[index]) healed = removeInlineFilePlaceholder(healed, index).prompt;
      }
      return healed;
    },
    [hold, syncFiles],
  );

  // A finished upload is kept on its file, so a reload brings the file back.
  useEffect(() => {
    for (const file of input.files) {
      const upload = input.uploadsByImageId[file.id];
      if (upload?.status !== "ready") continue;
      if (
        file.uploaded?.attachmentId === upload.attachmentId &&
        file.uploaded.environmentId === upload.environmentId
      ) {
        continue;
      }
      updateFile(input.draftTarget, {
        ...file,
        uploaded: {
          environmentId: upload.environmentId,
          attachmentId: upload.attachmentId,
          uploadedAt: Date.now(),
        },
      });
    }
  }, [input.draftTarget, input.files, input.uploadsByImageId, updateFile]);

  const chips = useMemo(
    () =>
      input.files.map((file, index): ComposerFileView => {
        const upload = input.uploadsByImageId[file.id];
        const current = upload?.environmentId === input.environmentId ? upload : undefined;
        return {
          id: file.id,
          number: index + 1,
          name: file.name,
          sizeBytes: file.sizeBytes,
          status:
            current?.status === "ready"
              ? "ready"
              : current?.status === "failed"
                ? "failed"
                : "uploading",
          progress: current?.status === "uploading" ? current.progress : 0,
        };
      }),
    [input.environmentId, input.files, input.uploadsByImageId],
  );

  return { chips, add, remove, retry, sync };
}
