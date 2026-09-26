import { userAskOf } from "@t3tools/shared/userAsk";

export const DEFAULT_THREAD_TITLE = "New thread";

/**
 * Whether a generated title may replace the current one: the default, the
 * seed the client put there from this very message, or text that names no
 * subject — a slash command or a placeholder a client seeded before it knew
 * better.
 */
export function canReplaceThreadTitle(currentTitle: string, titleSeed?: string): boolean {
  const trimmedCurrentTitle = currentTitle.trim();
  if (trimmedCurrentTitle === DEFAULT_THREAD_TITLE || !namesASubject(trimmedCurrentTitle)) {
    return true;
  }

  const trimmedTitleSeed = titleSeed?.trim();
  return trimmedTitleSeed !== undefined && trimmedTitleSeed.length > 0
    ? trimmedCurrentTitle === trimmedTitleSeed
    : false;
}

// A title has no attachments, so the image-only placeholder asks nothing here.
function namesASubject(title: string): boolean {
  return userAskOf({ text: title }) !== null;
}
