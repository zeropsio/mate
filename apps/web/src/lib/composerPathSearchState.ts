import {
  type ComposerPathSearchEntry,
  type ComposerPathSearchState,
  type ComposerPathSearchTarget,
} from "@t3tools/client-runtime/state/threads";
import { useMemo } from "react";

import { useComposerPathSearch as useComposerPathSearchQuery } from "../state/queries";

const NO_ENTRIES: ReadonlyArray<ComposerPathSearchEntry> = [];

/** `entries` keeps its identity while the search result does, so the composer's menu items can. */
export function useComposerPathSearch(target: ComposerPathSearchTarget): ComposerPathSearchState {
  const state = useComposerPathSearchQuery(target);
  const entries = useMemo(
    () =>
      state.entries.length === 0
        ? NO_ENTRIES
        : state.entries.map((entry) => ({
            path: entry.path,
            kind: entry.kind,
          })),
    [state.entries],
  );
  return {
    entries,
    error: state.error,
    isPending: state.isPending,
  };
}
