/** What the account's one line says and does, Try now's own run included (`accountFootLine`). */
import { useCallback, useMemo } from "react";

import { useAccountTrouble } from "./inventoryContext";
import { accountFootLine } from "./inventoryTrouble.logic";

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

/** The busy label follows the request state; failure offers another explicit attempt. */
export function useAccountVoice(): AccountVoice | null {
  const facts = useAccountTrouble();
  const retry = facts?.retry;
  const tryNow = useCallback(() => retry?.(), [retry]);
  const line =
    facts === null
      ? null
      : accountFootLine({
          lapse: facts.lapse,
          trouble: facts.trouble,
          running: facts.running,
        });
  const sentence = line?.sentence ?? null;
  const actions = line?.actions.join(" ") ?? "";
  const title = facts?.subject ?? null;
  const signOut = facts?.signOut;
  return useMemo(
    (): AccountVoice | null =>
      sentence === null
        ? null
        : {
            sentence,
            title,
            actions: actions.split(" ").map((kind) =>
              kind === "try-now"
                ? { kind, label: "Try now" as const, run: tryNow, busy: false }
                : kind === "trying"
                  ? { kind, label: "Trying…" as const, run: tryNow, busy: true }
                  : {
                      kind: "sign-out" as const,
                      label: "Sign out" as const,
                      run: () => signOut?.(),
                      busy: false,
                    },
            ),
          },
    [actions, sentence, signOut, title, tryNow],
  );
}
