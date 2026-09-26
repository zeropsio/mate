/**
 * The last live frame of each browser check the person watched, as that
 * check's picture where the Mate took none. The Mate screenshots only when
 * it asks to — a picture costs its own context — so a check that read the
 * page's errors or console ended as a blank "Screenshot not kept" (the owner,
 * 2026-09-26: "what is it good for then?"). Kept in memory for the session,
 * for the most recent checks: after a reload, only the Mate's screenshots.
 */
export const KEPT_FRAME_LIMIT = 40;

const kept = new Map<string, string>();

export function keepFrame(checkKey: string, src: string): void {
  kept.delete(checkKey);
  kept.set(checkKey, src);
  while (kept.size > KEPT_FRAME_LIMIT) {
    const oldest = kept.keys().next();
    if (oldest.done === true) break;
    kept.delete(oldest.value);
  }
}

/** What a check shows: the Mate's own screenshot, else the last frame the person watched. */
export function checkPicture(check: {
  readonly key: string;
  readonly screenshot?: { readonly src: string } | undefined;
}): string | undefined {
  return check.screenshot?.src ?? kept.get(check.key);
}
