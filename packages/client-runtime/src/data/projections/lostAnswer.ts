/**
 * What an owner that keeps no request ids shows, after a lost answer, of one operation: the one
 * effect handle that can only be its own — absent when it was sent (`before`), held by no other
 * operation still under way (`claimed`) — to adopt; `"none"`, the request never taken, only where
 * absence is proved (`proving`: the owner's facts read afresh on the person's own ask); else
 * `null`, cannot tell — more than one, no baseline, facts that cannot say (`shown` null), or none
 * shown by facts that do not prove it. A lost answer can still be taken by its owner: absence
 * claimed on anything less invites a second effect.
 */
export function lostAnswerEffect(input: {
  readonly shown: ReadonlyArray<string> | null;
  readonly before: ReadonlyArray<string> | undefined;
  readonly claimed: ReadonlySet<string>;
  readonly proving: boolean;
}): string | "none" | null {
  const { shown, before, claimed } = input;
  if (shown === null || before === undefined) return null;
  const candidates = shown.filter((handle) => !before.includes(handle) && !claimed.has(handle));
  if (candidates.length === 0) return input.proving ? "none" : null;
  return candidates.length === 1 ? candidates[0]! : null;
}
