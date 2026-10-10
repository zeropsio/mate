import type { PageTheme } from "@t3tools/client-runtime/zerops/publishedPage";
import type { MobileThemeVariables } from "@t3tools/shared/mobileThemeVariables";

/**
 * The only loads a published page's web view makes: its own document (`about:blank`, the HTML the
 * app hands it) and the page's frame inside it (`about:srcdoc`). Every other navigation — of the
 * view or of a frame, http(s), `data:`, `blob:`, `file:`, `javascript:` or an app's scheme — is
 * refused before it leaves: the native twin of the wrapper's `frame-src 'none'`. A link the person
 * taps reaches the system browser through the app (`linkToOpen`), never through a navigation.
 */
export function pageRequestAllowed(request: { readonly url: string }): boolean {
  return request.url === "about:blank" || request.url === "about:srcdoc";
}

/** Where and when a finger touched the page or left it. */
export interface PageTouchPoint {
  readonly at: number;
  readonly x: number;
  readonly y: number;
}

/** The longest a tap lasts: a finger held longer is a press, not a tap. */
export const PAGE_TAP_MAX_MS = 300;
/** The farthest a tapping finger moves: one that moved farther scrolled the conversation. */
export const PAGE_TAP_SLOP_PX = 10;
/** How long after a tap a link the page asks to open is still the person's. */
export const PAGE_TAP_WINDOW_MS = 500;

/**
 * When the person tapped the page, if the finger that just left it tapped: it lifted soon after it
 * landed and near where it landed. A finger that scrolled the conversation past the page, or held
 * it, never tapped — the page sees its own touches and could time a link to any of them.
 */
export function tapEnded(start: PageTouchPoint | null, end: PageTouchPoint): number | null {
  if (start === null) return null;
  const lasted = end.at - start.at;
  const moved = Math.hypot(end.x - start.x, end.y - start.y);
  return lasted >= 0 && lasted <= PAGE_TAP_MAX_MS && moved <= PAGE_TAP_SLOP_PX ? end.at : null;
}

/**
 * Whether a link the page asks to open now is the person's: they tapped just before. A tap opens
 * one link at most — the caller clears it on every ask.
 */
export function openFromTap(tappedAt: number | null, now: number): boolean {
  return tappedAt !== null && now - tappedAt >= 0 && now - tappedAt <= PAGE_TAP_WINDOW_MS;
}

/** The app's colours, as a page reads them: the web's variable names, filled from the phone's. */
export function mobilePageTheme(
  vars: Pick<
    MobileThemeVariables,
    | "--color-screen"
    | "--color-foreground"
    | "--color-card"
    | "--color-subtle"
    | "--color-foreground-muted"
    | "--color-border"
    | "--color-primary"
    | "--color-primary-foreground"
    | "--color-subtle-strong"
    | "--color-danger-foreground"
  >,
  scheme: PageTheme["scheme"],
): PageTheme {
  return {
    scheme,
    vars: {
      "--background": vars["--color-screen"],
      "--foreground": vars["--color-foreground"],
      "--card": vars["--color-card"],
      "--card-foreground": vars["--color-foreground"],
      "--muted": vars["--color-subtle"],
      "--muted-foreground": vars["--color-foreground-muted"],
      "--border": vars["--color-border"],
      "--primary": vars["--color-primary"],
      "--primary-foreground": vars["--color-primary-foreground"],
      "--accent": vars["--color-subtle-strong"],
      "--accent-foreground": vars["--color-foreground"],
      "--destructive": vars["--color-danger-foreground"],
      "--font-sans": "-apple-system, system-ui, sans-serif",
      "--font-mono": "ui-monospace, Menlo, monospace",
    },
  };
}
