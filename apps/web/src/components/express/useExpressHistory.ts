/**
 * A conversation's Adobe Express history (`expressHistoryOf`) for what draws it: the panel's list
 * and a design card's picture. Its value changes when the history does, never on each word a Mate
 * writes; while Express is off (`useExpressGate`) nothing is read.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { createContext, useMemo, useState } from "react";

import type { ChatMessage } from "~/types";
import { type ExpressHistoryEntry, expressHistoryOf } from "./expressHistory.logic";

export interface ExpressHistoryScope {
  readonly environmentId: EnvironmentId | null;
  readonly history: ReadonlyArray<ExpressHistoryEntry>;
}

const NONE: ReadonlyArray<ExpressHistoryEntry> = [];

export const ExpressHistoryContext = createContext<ExpressHistoryScope>({
  environmentId: null,
  history: [],
});

export function useExpressHistoryScope(
  environmentId: EnvironmentId | null,
  messages: ReadonlyArray<ChatMessage> | undefined,
  enabled: boolean,
): ExpressHistoryScope {
  // Each message is read once (`expressHistoryOf` keeps what it read of it); a history like the one
  // held is that one, so the scope changes only when the history does.
  const [held, hold] = useState(NONE);
  const history = useMemo(
    () => (enabled ? expressHistoryOf(messages ?? [], held) : NONE),
    [enabled, held, messages],
  );
  if (history !== held) hold(history);
  return useMemo(() => ({ environmentId, history }), [environmentId, history]);
}
