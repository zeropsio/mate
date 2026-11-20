import { useEffect, useMemo, useState } from "react";
import type { deriveTimelineEntries } from "../../session-logic";
import { LAST_WORDS_GRACE_MS, latestFinishedWordsAt } from "./conversation.logic";

/** The clock that derives the conversation's rows again once a finished turn's last words have waited. */
export function useLastWordsClock(
  timelineEntries: ReturnType<typeof deriveTimelineEntries>,
  isWorking: boolean,
) {
  // A running turn's last words wait a moment once finished: the rows are
  // derived again when the newest wait runs out.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const finishedWordsAt = useMemo(
    () => latestFinishedWordsAt(timelineEntries, isWorking),
    [timelineEntries, isWorking],
  );
  useEffect(() => {
    if (finishedWordsAt === null) return;
    // At most one wait from now, and past it when it fires: a client clock
    // behind the server's never stretches the wait.
    const timer = setTimeout(
      () => setNowMs(Math.max(Date.now(), finishedWordsAt + LAST_WORDS_GRACE_MS + 1)),
      Math.min(
        LAST_WORDS_GRACE_MS,
        Math.max(0, finishedWordsAt + LAST_WORDS_GRACE_MS - Date.now()),
      ) + 20,
    );
    return () => clearTimeout(timer);
  }, [finishedWordsAt]);
  return nowMs;
}
