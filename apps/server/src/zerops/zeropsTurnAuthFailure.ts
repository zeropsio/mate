/**
 * Recognising, on the provider runtime event bus, a turn that failed because
 * its agent is not signed in — so the agent-auth feed re-asks the agent's own
 * CLI (`ZeropsAgentAuth`'s `turnAuthFailures`) instead of waiting for the next
 * credential event or periodic check.
 *
 * Read off the SPI events only: the ported drivers stay as they are, and this
 * decides nothing about the agent — the re-probe does, and the project's
 * sign-in flag still decides whether it is signed in
 * (`packages/shared/src/zeropsAgentAuth.ts`).
 *
 * - Claude says it in words: `claudeSignedOutMessage` opens with "could not
 *   authenticate", the phrase the client's `agentNeedsSignIn` matches too.
 * - Codex says it in its typed error info: `unauthorized`, or a connection
 *   refused with HTTP 401.
 *
 * @module zeropsTurnAuthFailure
 */
import { agentIdForProviderInstance, type SpiEvent, type ZeropsAgentId } from "@t3tools/contracts";

const CLAUDE_SIGNED_OUT_PHRASE = "could not authenticate";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Codex's `codexErrorInfo`: a plain literal, or one member naming a failed connection's status. */
const isCodexUnauthorized = (info: unknown): boolean => {
  if (info === "unauthorized") return true;
  if (!isRecord(info)) return false;
  return Object.values(info).some(
    (failure) => isRecord(failure) && failure["httpStatusCode"] === 401,
  );
};

/** The agent whose turn this event failed for want of a login, or `undefined`. */
export function turnAuthFailureAgent(event: SpiEvent): ZeropsAgentId | undefined {
  if (event.type !== "runtime.error") return undefined;
  const agentId = agentIdForProviderInstance(event.providerInstanceId ?? event.provider);
  switch (agentId) {
    case "claude-code":
      return event.payload.message.includes(CLAUDE_SIGNED_OUT_PHRASE) ? agentId : undefined;
    case "codex": {
      const detail = event.payload.detail;
      const error = isRecord(detail) ? detail["error"] : undefined;
      return isRecord(error) && isCodexUnauthorized(error["codexErrorInfo"]) ? agentId : undefined;
    }
    case undefined:
      return undefined;
  }
}
