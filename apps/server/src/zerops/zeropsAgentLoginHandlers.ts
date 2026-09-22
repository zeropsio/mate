/**
 * Per-agent login-flow patterns — trimmed from the Zerops GUI walker's
 * `AGENT_AUTH_HANDLERS` (`zcp-agent-auth-dialog.handlers.ts`, ours) to the
 * two agents {@link ZeropsAgentId} covers. Only the fields
 * `ZeropsAgentLogin.ts` actually branches on survive the port —
 * `postAuthScreens` / `stallDuringSubmission` existed there for
 * Antigravity's multi-screen first-run setup, which neither Claude nor
 * Codex needs.
 *
 * Design philosophy, unchanged from the GUI walker:
 * - The stall timer is the PRIMARY mechanism for navigating unknown TUI
 *   screens (send Enter → accept the default). Patterns exist only for
 *   things that need a non-default response.
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
   * - `device-code` (Codex): terminal → browser. The terminal prints a
   *   device code; the user opens the URL and types the code there. The
   *   CLI polls until success.
   */
  readonly flowMode: "paste-code" | "device-code";
  /** Regex to detect Y/N confirmation prompts (auto-confirmed with `y\r`). */
  readonly confirmPromptPattern: RegExp;
  /**
   * A URL-PREFIX ANCHOR (interior wildcards allowed, no trailing wildcard) —
   * the output parser appends the URL token tail itself and gates
   * completion on that same charset.
   */
  readonly authUrlPattern: RegExp;
  /** Device-code extraction (Codex's `device-code` flow only). First capture group preferred. */
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
  };
