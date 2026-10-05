import type { ModelCapabilities, ModelSelection, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useRef } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import {
  draftPicksKey,
  modelSelectionKey,
  selectionToWrite,
} from "./threadModelSelection.logic.ts";

/**
 * One model selection per thread. The thread's stored selection wins: on
 * opening and whenever it changes, the tab drops its own pick, so every tab
 * shows and sends the thread's selection. A pick made here goes to the thread
 * at once. Draft text stays per tab.
 */
export function useThreadModelSelection(input: {
  /** A thread the server holds; null for a local draft, which keeps its own pick. */
  readonly threadRef: ScopedThreadRef | null;
  /** The thread's stored selection; null while the thread loads. */
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

  const seen = useRef<{
    readonly refKey: string | null;
    readonly threadKey: string | null;
    readonly written: string | null;
    /** The draft's picks when this thread opened, before it loaded. */
    readonly picksAtOpen: string | null;
  }>({ refKey: null, threadKey: null, written: null, picksAtOpen: null });
  useEffect(() => {
    const refKey = threadRef ? scopedThreadKey(threadRef) : null;
    const previous = seen.current;
    const sameRef = previous.refKey === refKey;
    const picks = draftPicksKey(draft);
    const picksAtOpen = sameRef ? previous.picksAtOpen : picks;
    const moved = !sameRef || previous.threadKey !== threadKey;
    // The echo of this tab's own pick is no change from elsewhere, and neither
    // is the thread arriving after the person picked while it loaded: such a
    // pick stays and goes to the thread.
    const echo = moved && sameRef && threadKey === previous.written;
    const loadedAfterPick =
      moved && sameRef && previous.threadKey === null && picks !== picksAtOpen;
    const foreign = moved && !echo && !loadedAfterPick;
    seen.current = {
      refKey,
      threadKey,
      written: foreign ? null : previous.written,
      picksAtOpen,
    };
    if (!threadRef || !threadSelection) return;
    if (foreign) {
      // The thread's selection wins over this tab's pick.
      clearModelSelection(threadRef);
      return;
    }
    const next = selectionToWrite({
      threadChanged: false,
      draft,
      threadSelection,
      capabilitiesFor,
    });
    const nextKey = modelSelectionKey(next);
    if (next === null || nextKey === seen.current.written) return;
    seen.current = { ...seen.current, written: nextKey };
    write(next);
  }, [capabilitiesFor, clearModelSelection, draft, threadKey, threadRef, threadSelection, write]);
}
