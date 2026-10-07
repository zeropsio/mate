import * as Cause from "effect/Cause";

/** A provider failure as the person reads it: one plain sentence and a code. */
export interface ProviderFailureText {
  readonly sentence: string;
  readonly code: string;
}

const SENTENCE_LIMIT = 240;

/** The first line of a message, never a stack or a dump. */
function plainLine(text: string): string | undefined {
  const line = text.split("\n")[0]?.trim() ?? "";
  if (line.length === 0) return undefined;
  return line.length > SENTENCE_LIMIT ? `${line.slice(0, SENTENCE_LIMIT - 1)}…` : line;
}

const KNOWN: Record<
  string,
  { readonly code: string; readonly sentence?: string; readonly field?: string }
> = {
  ProviderAdapterSessionClosedError: {
    code: "session-closed",
    sentence: "The agent's session closed before it got this message.",
  },
  ProviderAdapterSessionNotFoundError: {
    code: "session-missing",
    sentence: "The agent's session was not running.",
  },
  ProviderAdapterRequestError: { code: "request-failed", field: "detail" },
  ProviderAdapterProcessError: { code: "process-failed", field: "detail" },
  ProviderAdapterValidationError: { code: "invalid-request", field: "issue" },
  ProviderValidationError: { code: "invalid-request", field: "issue" },
  ProviderWorkspaceMissingError: { code: "workspace-missing", field: "message" },
  BackgroundWorkBlocksModelChangeError: {
    code: "background-work",
    sentence:
      "Claude is still running background work, and this model change needs a new session that would end it. Wait for it to finish or stop it, or keep the current model, then send the message again.",
  },
};

const codeOfTag = (tag: string) =>
  tag
    .replace(/Error$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

export function describeProviderFailure(cause: Cause.Cause<unknown>): ProviderFailureText {
  const failure = cause.reasons.find(Cause.isFailReason)?.error;
  const tag =
    typeof failure === "object" && failure !== null && "_tag" in failure
      ? String((failure as { readonly _tag: unknown })._tag)
      : undefined;
  if (tag === undefined) {
    return { sentence: "Something went wrong while starting this turn.", code: "internal" };
  }
  const known = KNOWN[tag];
  const fieldValue = known?.field
    ? (failure as unknown as Record<string, unknown>)[known.field]
    : undefined;
  const fromField = typeof fieldValue === "string" ? plainLine(fieldValue) : undefined;
  const ownMessage =
    known === undefined && failure instanceof Error ? plainLine(failure.message) : undefined;
  return {
    sentence:
      known?.sentence ?? fromField ?? ownMessage ?? "The agent could not take this message.",
    code: known?.code ?? codeOfTag(tag),
  };
}

export function formatProviderFailure(cause: Cause.Cause<unknown>): string {
  const { sentence, code } = describeProviderFailure(cause);
  return `${sentence} (${code})`;
}
