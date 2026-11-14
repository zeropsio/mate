/**
 * The code of a chat account link HQ said (`<Mate web>/chat-link#<code>`), carried across sign-in:
 * the fragment leaves the address for this tab's session storage as the page boots (`main.tsx`),
 * signed in or not: signed out no route runs, and a sign-in returns to a path but never to its
 * fragment (`navigationStorage.ts`).
 * The page reads it once and removes it, and drops it once HQ took it or may have: the code is a
 * one-time credential, and neither a reload nor the page opened again sends it again.
 */
const KEPT = "mate:chat-link-code:v1";

/** `undefined` until the page read it; then what it read, `null` for none. */
let read: string | null | undefined;

/** Moves the address's fragment to session storage and out of the address and its history entry. */
export function keepChatLinkCode(): void {
  const code = window.location.hash.replace(/^#/u, "");
  if (code === "") return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  read = undefined;
  try {
    window.sessionStorage.setItem(KEPT, code);
  } catch {
    // Storage blocked: the code lives in this document only, still taken once.
    read = code;
  }
}

/** The kept code, read once and removed; `null` where none was kept. */
export function takeChatLinkCode(): string | null {
  if (read !== undefined) return read;
  try {
    read = window.sessionStorage.getItem(KEPT);
    window.sessionStorage.removeItem(KEPT);
  } catch {
    read = null;
  }
  return read;
}

/** Drops the code once HQ took it, or may have: nothing sends it again. */
export function spendChatLinkCode(): void {
  read = null;
}
