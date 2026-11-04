/**
 * A conversation's Adobe Express history (`expressHistoryOf`) for what draws it: the panel's list
 * and a design card's picture. Its value changes when the history does, never on each word a Mate
 * writes; while Express is off (`useExpressGate`) nothing is read.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { createContext, useMemo } from "react";

import type { ChatMessage } from "~/types";
import { type ExpressHistoryEntry, expressHistoryOf } from "./expressHistory.logic";

export interface ExpressHistoryScope {
  readonly environmentId: EnvironmentId | null;
  readonly history: ReadonlyArray<ExpressHistoryEntry>;
}

export const ExpressHistoryContext = createContext<ExpressHistoryScope>({
  environmentId: null,
  history: [],
});

export function useExpressHistoryScope(
  environmentId: EnvironmentId | null,
  messages: ReadonlyArray<ChatMessage> | undefined,
  enabled: boolean,
): ExpressHistoryScope {
  const written = useMemo(
    () => (enabled ? JSON.stringify(expressHistoryOf(messages ?? [])) : "[]"),
    [enabled, messages],
  );
  return useMemo(
    () => ({
      environmentId,
      history: JSON.parse(written) as ReadonlyArray<ExpressHistoryEntry>,
    }),
    [environmentId, written],
  );
}
