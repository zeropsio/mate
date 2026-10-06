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
 * - Claude says it in words: `claudeSignedOutMessage` opens with "Claude could
 *   not authenticate.", and a stream that died signed out (`claudeStreamFailure`)
 *   with "Claude's sign-in has expired." — the openings the client's
 *   `signedOutAgent` matches too; a Git refusal that says it "could not
 *   authenticate" is none.
 * - Codex says it in its typed error info: `unauthorized`, or a connection
 *   refused with HTTP 401.
 *
 * @module zeropsTurnAuthFailure
 */
import { agentIdForProviderInstance, type SpiEvent, type ZeropsAgentId } from "@t3tools/contracts";

/** Claude's own sentences for a refused sign-in, as they open: never a phrase anywhere. */
const CLAUDE_SIGNED_OUT_OPENINGS = [
  "Claude could not authenticate.",
  "Claude's sign-in has expired.",
];

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
      return CLAUDE_SIGNED_OUT_OPENINGS.some((opening) =>
        event.payload.message.trimStart().startsWith(opening),
      )
        ? agentId
        : undefined;
    case "codex": {
      const detail = event.payload.detail;
      const error = isRecord(detail) ? detail["error"] : undefined;
      return isRecord(error) && isCodexUnauthorized(error["codexErrorInfo"]) ? agentId : undefined;
    }
    case undefined:
      return undefined;
  }
}
