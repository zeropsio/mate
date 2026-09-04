/**
 * antigravityAcp — the owned, narrow ACP session-runtime capability
 * `textGeneration/AntigravityTextGeneration.ts` depends on, cut down from the
 * shared `AcpSessionRuntime` driver service (`provider/acp/AcpSessionRuntime.ts`)
 * that every ACP-based driver (Cursor, Grok, Antigravity) provides through.
 *
 * `AntigravityTextRuntime` only ever needs the members Antigravity text
 * generation calls directly (starting a session, prompting it, tearing it
 * down, and reacting to its own session-update/permission/elicitation/fs/
 * terminal callbacks) — never the raw request/notify escape hatches or the
 * other drivers' surfaces.
 *
 * Also re-exports the two Antigravity-specific helpers text generation needs
 * (`applyAntigravityAcpModelSelection`, `removeAntigravitySessionFiles`) so
 * `textGeneration/**` never imports `provider/acp/**` directly — the same
 * boundary `openCodeRuntime.ts` and `claudeModelCatalog.ts` hold for their
 * drivers.
 *
 * @module antigravityAcp
 */
import type {
  AcpSessionRuntime,
  AcpSessionRuntimeEvent,
} from "../provider/acp/AcpSessionRuntime.ts";

export { applyAntigravityAcpModelSelection } from "../provider/acp/AntigravityAcpSupport.ts";
export { removeAntigravitySessionFiles } from "../provider/acp/AntigravitySessionFiles.ts";
export type { AcpSessionRuntimeEvent };

/** The narrow ACP session-runtime capability Antigravity text generation depends on. */
export type AntigravityTextRuntime = Pick<
  AcpSessionRuntime["Service"],
  | "start"
  | "setMode"
  | "getConfigOptions"
  | "getEvents"
  | "setModel"
  | "prompt"
  | "cancel"
  | "handleSessionUpdate"
  | "handleRequestPermission"
  | "handleElicitation"
  | "handleReadTextFile"
  | "handleWriteTextFile"
  | "handleCreateTerminal"
  | "handleTerminalOutput"
  | "handleTerminalWaitForExit"
  | "handleTerminalKill"
  | "handleTerminalRelease"
  | "handleUnknownExtRequest"
>;
