/** What the account's one line says and does, Try now's own run included (`accountFootLine`). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccountTrouble } from "./inventoryContext";
import { TRY_NOW_SETTLE_MS, accountFootLine, type TryNowAttempt } from "./inventoryTrouble.logic";

export interface AccountVoice {
  readonly sentence: string;
  /** What isn't answering, named under the sentence; null when nothing is named. */
  readonly title: string | null;
  readonly actions: ReadonlyArray<{
    readonly kind: "try-now" | "trying" | "sign-out";
    readonly label: "Try now" | "Trying…" | "Sign out";
    readonly run: () => void;
    /** Running: shown, not pressable again. */
    readonly busy: boolean;
  }>;
}

/**
 * The account's line from its trouble (`useAccountTrouble`). Try now is never a silent no-op: it
 * says "Trying…" while it runs and keeps the line it was pressed on up while the organization
 * has not answered, and after `TRY_NOW_SETTLE_MS` says whether that helped.
 */
export function useAccountVoice(): AccountVoice | null {
  const facts = useAccountTrouble();
  const [attempt, setAttempt] = useState<TryNowAttempt>("idle");
  const [tried, setTried] = useState(0);
  const retry = facts?.retry;
  const tryNow = useCallback(() => {
    retry?.();
    setAttempt("trying");
    setTried((count) => count + 1);
  }, [retry]);
  const unanswered = facts?.unanswered ?? false;
  const unansweredRef = useRef(unanswered);
  const lastTroubleRef = useRef(facts?.trouble ?? null);
  const lastSubjectRef = useRef(facts?.subject ?? null);
  useEffect(() => {
    unansweredRef.current = unanswered;
    if (facts?.trouble != null) lastTroubleRef.current = facts.trouble;
    if (facts?.subject != null) lastSubjectRef.current = facts.subject;
  });
  useEffect(() => {
    if (tried === 0) return;
    const timer = setTimeout(
      () => setAttempt(unansweredRef.current ? "still" : "idle"),
      TRY_NOW_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [tried]);
  // A trouble that ended takes its attempt with it: the next one starts untried.
  useEffect(() => {
    if (!unanswered) return;
    return () => setAttempt("idle");
  }, [unanswered]);
  const tryingOn = attempt !== "idle" && unanswered ? lastTroubleRef.current : null;
  const line =
    facts === null
      ? null
      : accountFootLine({
          trouble: facts.trouble ?? tryingOn,
          attempt: unanswered ? attempt : "idle",
        });
  const sentence = line?.sentence ?? null;
  const actions = line?.actions.join(" ") ?? "";
  const title = facts?.subject ?? (tryingOn === null ? null : lastSubjectRef.current);
  return useMemo(
    (): AccountVoice | null =>
      sentence === null
        ? null
        : {
            sentence,
            title,
            actions: actions
              .split(" ")
              .map((kind) =>
                kind === "try-now"
                  ? { kind, label: "Try now" as const, run: tryNow, busy: false }
                  : { kind: "trying" as const, label: "Trying…" as const, run: tryNow, busy: true },
              ),
          },
    [actions, sentence, title, tryNow],
  );
}
