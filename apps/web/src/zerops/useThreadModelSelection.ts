import type { ModelCapabilities, ModelSelection, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useRef } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { modelSelectionKey, selectionToWrite } from "./threadModelSelection.logic.ts";

/**
 * One model selection per thread. The thread's stored selection wins: on
 * opening and whenever it changes, the tab drops its own pick, so every tab
 * shows and sends the thread's selection. A pick made here goes to the thread
 * at once. Draft text stays per tab.
 */
export function useThreadModelSelection(input: {
  /** A thread the server holds; null for a local draft, which keeps its own pick. */
  readonly threadRef: ScopedThreadRef | null;
  readonly threadSelection: ModelSelection | null;
  readonly write: (selection: ModelSelection) => void;
  /** What a model takes, so a model switch keeps the thread's options it can. */
  readonly capabilitiesFor?: (selection: ModelSelection) => ModelCapabilities | null;
}): void {
  const { threadRef, threadSelection, write, capabilitiesFor } = input;
  const clearModelSelection = useComposerDraftStore((store) => store.clearModelSelection);
  const draft = useComposerDraftStore((store) =>
    threadRef ? store.getComposerDraft(threadRef) : null,
  );
  const threadKey = modelSelectionKey(threadSelection);

  useEffect(() => {
    if (threadRef && threadKey !== null) clearModelSelection(threadRef);
  }, [clearModelSelection, threadRef, threadKey]);

  const seen = useRef<{
    readonly refKey: string | null;
    readonly threadKey: string | null;
    readonly written: string | null;
  }>({ refKey: null, threadKey: null, written: null });
  useEffect(() => {
    const refKey = threadRef ? scopedThreadKey(threadRef) : null;
    const threadChanged = seen.current.refKey !== refKey || seen.current.threadKey !== threadKey;
    const written = threadChanged ? null : seen.current.written;
    seen.current = { refKey, threadKey, written };
    if (!threadRef || !threadSelection) return;
    const next = selectionToWrite({ threadChanged, draft, threadSelection, capabilitiesFor });
    const nextKey = modelSelectionKey(next);
    if (next === null || nextKey === written) return;
    seen.current = { refKey, threadKey, written: nextKey };
    write(next);
  }, [capabilitiesFor, draft, threadKey, threadRef, threadSelection, write]);
}
