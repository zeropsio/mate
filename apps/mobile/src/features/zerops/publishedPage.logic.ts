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

/** How long after the person touched the page a link it asks to open is still their tap. */
export const PAGE_TAP_WINDOW_MS = 1000;

/** Whether the person touched the page just now: a link it asks to open is then theirs. */
export function tappedJustNow(lastTouchAt: number | null, now: number): boolean {
  return lastTouchAt !== null && now - lastTouchAt >= 0 && now - lastTouchAt <= PAGE_TAP_WINDOW_MS;
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
