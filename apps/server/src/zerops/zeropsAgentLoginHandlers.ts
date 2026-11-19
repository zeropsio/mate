/**
 * Per-agent login-flow patterns — trimmed from the Zerops GUI walker's
 * `AGENT_AUTH_HANDLERS` (`zcp-agent-auth-dialog.handlers.ts`, ours). Only the
 * fields `ZeropsAgentLogin.ts` actually branches on survive the port —
 * `postAuthScreens` / `stallDuringSubmission` existed there for the
 * Antigravity IDE's multi-screen first-run setup; `agy acp --login` prints
 * its link and prompt with no screens before them.
 *
 * Design philosophy, unchanged from the GUI walker:
 * - The stall timer is the PRIMARY mechanism for navigating unknown TUI
 *   screens (send Enter → accept the default) — for the agents whose login
 *   opens on such screens (`pressEnterWhenStalled`). Patterns exist only
 *   for things that need a non-default response.
 * - `confirmPromptPattern` → needs `y\r`, not just Enter.
 * - `authUrlPattern` / `deviceCodePattern` → extraction, completion-gated by
 *   the output parser (anchor + appended token tail) — see
 *   `zeropsAgentLoginOutputParser.ts`.
 * - `pasteCodePattern` → must STOP auto-pressing Enter.
 * - `authSuccessPattern` / `authErrorPattern` → phase transitions.
 * - Presence patterns must use `\s+` (never a literal space) between words —
 *   the parser injects `\v` boundaries at cursor rewrites and `\v` is
 *   inside `\s`.
 */
import type { ZeropsAgentId } from "@t3tools/contracts";

export interface ZeropsAgentLoginHandler {
  /**
   * Direction of the OAuth code exchange:
   * - `paste-code` (Claude): browser → terminal. The user opens the URL,
   *   the browser shows a code, the user pastes it into the dialog's field
   *   (`ZeropsAgentLogin.submitCode` types it into the terminal) or straight
   *   into the terminal pane.
   * - `device-code` (Codex, Grok): terminal → browser. The terminal prints
   *   a device code; the user opens the URL and confirms the code there.
   *   The CLI polls until success.
   * - `browser` (Cursor): the user opens the URL and signs in; the CLI
   *   polls until success. Nothing is typed anywhere.
   */
  readonly flowMode: "paste-code" | "device-code" | "browser";
  /**
   * Whether a second of silence before the URL presses Enter (the stall
   * countdown). Only for a login that opens on menus taking their default:
   * a CLI that is merely slow to print its link reads a stray Enter as an
   * answer (`agy acp --login` quits on an empty code).
   */
  readonly pressEnterWhenStalled: boolean;
  /** Regex to detect Y/N confirmation prompts (auto-confirmed with `y\r`). */
  readonly confirmPromptPattern: RegExp;
  /**
   * A URL-PREFIX ANCHOR (interior wildcards allowed, no trailing wildcard) —
   * the output parser appends the URL token tail itself and gates
   * completion on that same charset.
   */
  readonly authUrlPattern: RegExp;
  /** Device-code extraction (the `device-code` flow only). First capture group preferred. */
  readonly deviceCodePattern?: RegExp;
  readonly authSuccessPattern: RegExp;
  readonly authErrorPattern: RegExp;
  /** "paste code here" prompt — stops the stall timer, moves the phase to `awaiting-code`. */
  readonly pasteCodePattern: RegExp;
}

export const ZEROPS_AGENT_LOGIN_HANDLERS: Readonly<Record<ZeropsAgentId, ZeropsAgentLoginHandler>> =
  {
    "claude-code": {
      flowMode: "paste-code",
      pressEnterWhenStalled: true,
      confirmPromptPattern: /\(y\/n\)/i,
      authUrlPattern: /https:\/\/[^\s]*\/oauth\/authorize/,
      authSuccessPattern:
        /login\s*successful|successfully\s+(authenticated|logged\s*in|authorized)/i,
      authErrorPattern:
        /(?:authentication|oauth)\s*error|invalid.*(?:authorization\s*)?code|login\s*failed|auth(?:entication|orization)?\s*failed/i,
      pasteCodePattern: /paste\s*code\s*here/i,
    },

    // Codex device-auth: UNLIKE Claude, terminal prints a code, the user
    // enters it into the browser, and the CLI polls until success — there is
    // no y/n prompt and no terminal-side paste field, so those patterns never
    // match (`(?!)` is a regex that can never match anything).
    //
    // `codex login` WITHOUT `--device-auth` spins up a `localhost` OAuth
    // callback the CLI's own machine can reach but this container's user
    // cannot — device-auth is the only viable flow here.
    codex: {
      flowMode: "device-code",
      pressEnterWhenStalled: true,
      confirmPromptPattern: /(?!)/,
      authUrlPattern: /https:\/\/auth\.openai\.com\/codex\/device/,
      // `XXXX-XXXXX` — uppercase alphanumeric separated by a single dash. The
      // capture group is the code itself; the word-boundary anchors guard
      // against a false match inside the surrounding URL/text.
      deviceCodePattern: /\b([A-Z0-9]{4}-[A-Z0-9]{5})\b/,
      authSuccessPattern: /successfully\s+logged\s+in/i,
      authErrorPattern:
        /authentication\s+failed|authorization\s+(?:failed|denied|expired)|invalid\s+code|device\s+code\s+expired/i,
      pasteCodePattern: /(?!)/,
    },

    // `agy acp --login` prints a Google sign-in link and a prompt for the
    // code the callback page shows (or that page's whole address), then
    // reads one line: an empty one quits with "login cancelled: no
    // authorization code was entered". "Logged in as …" is in the binary;
    // when the login ends without a recognized line, `ZeropsAgentLogin`
    // asks `agy models` instead.
    antigravity: {
      flowMode: "paste-code",
      pressEnterWhenStalled: false,
      confirmPromptPattern: /(?!)/,
      authUrlPattern: /https:\/\/accounts\.google\.com\/o\/oauth2\/auth/,
      authSuccessPattern: /logged\s+in\s+as/i,
      authErrorPattern: /login\s+cancelled|invalid_grant|authentication\s+failed|login\s+failed/i,
      pasteCodePattern: /paste\s+the\s+authorization\s+code/i,
    },

    // `grok login --device-auth`: the link carries the code
    // (`?user_code=XXXX-XXXX`) and the code is printed again on its own
    // line; "Signed in as …", "Device code expired. …" and "Authorization
    // denied. …" are the binary's own lines.
    grok: {
      flowMode: "device-code",
      pressEnterWhenStalled: false,
      confirmPromptPattern: /(?!)/,
      authUrlPattern: /https:\/\/accounts\.x\.ai\/oauth2\/device/,
      deviceCodePattern: /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/,
      authSuccessPattern: /signed\s+in\s+as/i,
      authErrorPattern: /device\s+code\s+expired|authorization\s+denied|token\s+exchange\s+failed/i,
      pasteCodePattern: /(?!)/,
    },

    // `NO_OPEN_BROWSER=1 cursor-agent login` prints "Open a browser and
    // navigate to this link: https://cursor.com/loginDeepControl?…" and polls.
    // Success is "✓ Logged in as <email>" or "✓ Login successful!"; its
    // failures are "Login failed or timed out. …", "Login error: …" and
    // "Failed to store authentication tokens. …".
    cursor: {
      flowMode: "browser",
      pressEnterWhenStalled: false,
      confirmPromptPattern: /(?!)/,
      authUrlPattern: /https:\/\/cursor\.com\/loginDeepControl/,
      authSuccessPattern: /logged\s+in\s+as|login\s+successful/i,
      authErrorPattern: /login\s+failed|login\s+error|failed\s+to\s+store\s+authentication/i,
      pasteCodePattern: /(?!)/,
    },
  };
