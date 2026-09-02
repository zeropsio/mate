/**
 * The pure decision core of a server-driven login session (S7 follow-up
 * F8) — given the current phase, one agent's {@link ZeropsAgentLoginHandler},
 * and the accumulated raw terminal buffer, decides the next phase and
 * whatever the session should do about it (write bytes back, clear the
 * buffer, arm the stall countdown). No I/O, no timers, no state of its own —
 * `ZeropsAgentLogin.ts` is the thin Effect wrapper that actually owns the
 * buffer, the stall timer, and the terminal writes this describes.
 *
 * Ported from the Zerops GUI walker's `#handleOutputChunk`
 * (`zcp-agent-auth-dialog.feature.ts`, ours) — same match ORDER (success
 * checked in every phase first; error only in the post-URL phases, to avoid
 * a false positive during TUI navigation; confirm/URL/paste-code only while
 * still navigating; a stall countdown as the last resort) — collapsed onto
 * this server's phase vocabulary:
 *
 * upstream `idle`/`starting`/`confirming` → here `starting`/`menu` (this
 * server starts the terminal itself rather than waiting on a client
 * websocket, so `starting` promotes to `menu` synchronously once the login
 * command is written — see `ZeropsAgentLogin.start` — and the two phases
 * are treated identically by the matchers below purely for defensiveness);
 * upstream `url_received`/`waiting_for_code` (browser-side auto-open,
 * unavailable server-side) → here one phase, `awaiting-browser`; upstream
 * `submitting_code` (a dialog-form code submission this design does not
 * have — the user pastes directly into the terminal pane) → here
 * `awaiting-code`; upstream `complete`/`error` → here `succeeded`/`failed`.
 */
import type { ZeropsAgentLoginPhase } from "@t3tools/contracts";

import {
  DEVICE_CODE_CONTINUATION,
  matchAuthUrl,
  matchCompletedToken,
  parseTerminalOutput,
} from "./zeropsAgentLoginOutputParser.ts";
import type { ZeropsAgentLoginHandler } from "./zeropsAgentLoginHandlers.ts";

/** `\r` — mate's own terminal-write convention (matches `terminalEnvironment`'s `runProjectScript`), not upstream's `\n`. */
const ENTER = "\r";

export interface LoginWalkerInput {
  readonly phase: ZeropsAgentLoginPhase;
  readonly handler: ZeropsAgentLoginHandler;
  /** The FULL accumulated buffer for this session, chunk already appended by the caller. */
  readonly buffer: string;
}

export interface LoginWalkerOutput {
  readonly nextPhase: ZeropsAgentLoginPhase;
  readonly url?: string;
  readonly code?: string;
  readonly message?: string;
  /** Bytes to write back into the terminal, if any. */
  readonly write?: string;
  /** Whether the caller should reset its buffer to empty after this step. */
  readonly clearBuffer: boolean;
  /**
   * Whether the caller should (re)start its stall countdown after this
   * step — meaningful only while `nextPhase` is `starting`/`menu`; the
   * caller re-checks the LIVE phase when the countdown actually fires (see
   * {@link stallLoginAction}), the same defense against a stale timer
   * upstream's own re-check performs.
   */
  readonly armStall: boolean;
}

/** Phases with no further transition — a session in one of these has ended. */
const TERMINAL_PHASES: ReadonlySet<ZeropsAgentLoginPhase> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

/** Phases where the walker is still auto-navigating unrecognized screens. */
const NAVIGATING_PHASES: ReadonlySet<ZeropsAgentLoginPhase> = new Set(["starting", "menu"]);

export const stepLoginOutput = (input: LoginWalkerInput): LoginWalkerOutput => {
  const { phase, handler, buffer } = input;

  if (TERMINAL_PHASES.has(phase)) {
    // Defensive: the session stops feeding output once a terminal phase is
    // reached, so this should never actually run.
    return { nextPhase: phase, clearBuffer: false, armStall: false };
  }

  const parsed = parseTerminalOutput(buffer);
  const clean = parsed.clean;

  // Success — checked in every active phase (handles a user typing the code
  // directly in the terminal, a browser auto-callback the CLI itself
  // detects, etc.).
  if (handler.authSuccessPattern.test(clean)) {
    return { nextPhase: "succeeded", clearBuffer: true, armStall: false };
  }

  // Error — only in the post-URL phases, to avoid a false positive while
  // still navigating an unrelated TUI screen.
  if (
    (phase === "awaiting-browser" || phase === "awaiting-code") &&
    handler.authErrorPattern.test(clean)
  ) {
    return {
      nextPhase: "failed",
      message: "Authentication failed. The code may be invalid or expired.",
      clearBuffer: true,
      armStall: false,
    };
  }

  if (NAVIGATING_PHASES.has(phase)) {
    // Y/N confirmation.
    if (handler.confirmPromptPattern.test(clean)) {
      return { nextPhase: "menu", write: `y${ENTER}`, clearBuffer: true, armStall: false };
    }

    // Auth URL (and, for device-code flow, its code).
    const urlResult = matchAuthUrl(parsed, handler.authUrlPattern);

    if (urlResult.status === "pending") {
      // A URL candidate ends exactly at the buffer edge — acting now risks
      // truncation. Hold; do not restart the stall (more bytes are clearly
      // still arriving).
      return { nextPhase: "menu", clearBuffer: false, armStall: false };
    }

    if (urlResult.status === "complete") {
      const url = urlResult.value;

      if (handler.flowMode === "device-code" && handler.deviceCodePattern) {
        const codeResult = matchCompletedToken(
          clean,
          handler.deviceCodePattern,
          DEVICE_CODE_CONTINUATION,
        );
        if (codeResult.status !== "complete") {
          // URL and code arrive in separate chunks — hold in `menu`,
          // buffer NOT cleared, until both are known. Suppress the stall
          // (pressing Enter mid-device-auth could submit garbage).
          return { nextPhase: "menu", clearBuffer: false, armStall: false };
        }
        return {
          nextPhase: "awaiting-browser",
          url,
          code: codeResult.value,
          clearBuffer: true,
          armStall: false,
        };
      }

      return { nextPhase: "awaiting-browser", url, clearBuffer: true, armStall: false };
    }

    // Fallback: a "paste code here" prompt with no URL match (the user
    // reads the URL from the terminal directly).
    if (handler.pasteCodePattern.test(clean)) {
      return { nextPhase: "awaiting-code", clearBuffer: true, armStall: false };
    }
  }

  // Stall detection: nothing matched. The PRIMARY mechanism for navigating
  // an unrecognized TUI screen (the same phase re-check upstream's own
  // `setTimeout` callback does happens in the caller, at fire time — see
  // `stallLoginAction`). A mid-escape tail never arms a countdown off an
  // incomplete render.
  return {
    nextPhase: phase,
    clearBuffer: false,
    armStall: NAVIGATING_PHASES.has(phase) && !parsed.endsInsideEscape,
  };
};

/**
 * What the stall countdown should do once it actually fires, given the
 * LIVE phase at that moment (re-checked by the caller, never the phase
 * captured when the countdown was armed — a real transition may have
 * already happened in between). Only `starting`/`menu` still get the
 * auto-Enter; every other phase is a no-op (the countdown fired stale).
 */
export const stallLoginAction = (
  livePhase: ZeropsAgentLoginPhase,
): { readonly write?: string; readonly clearBuffer: boolean } =>
  NAVIGATING_PHASES.has(livePhase) ? { write: ENTER, clearBuffer: true } : { clearBuffer: false };
