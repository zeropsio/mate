import { useCallback, useState } from "react";
import { acknowledgeBranchAdvice, deriveBranchAdvice } from "./BranchToolbar.logic";

/** Local intent/reveal state and session acknowledgement stay with the branch owner. */
export function useBranchAdvice(
  input: Omit<Parameters<typeof deriveBranchAdvice>[0], "revealedKey">,
) {
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const advice = deriveBranchAdvice({ ...input, revealedKey });
  if (revealedKey !== advice.revealedKey) setRevealedKey(advice.revealedKey);
  const { threadKey, mismatch, composerHasContent } = input;
  const dismiss = useCallback(() => {
    acknowledgeBranchAdvice({ threadKey, mismatch, composerHasContent, revealedKey });
    redraw((tick) => tick + 1);
  }, [threadKey, mismatch, composerHasContent, revealedKey]);
  return { key: advice.key, visible: advice.visible, dismiss };
}
