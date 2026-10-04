/**
 * Why a Claude session's stream stopped, read off what is left of it: the
 * SDK's error (its message, the CLI's exit code or signal) and a bounded tail
 * of the CLI's own stderr. The person reads a plain reason and what happens
 * next; the server log keeps the cause, its secrets scrubbed.
 */

const STDERR_TAIL_BYTES = 8 * 1024;

export interface StderrTail {
  readonly push: (chunk: string) => void;
  readonly text: () => string;
}

/** The last `limit` characters the CLI wrote to stderr, cut at a line where it can be. */
export function makeStderrTail(limit = STDERR_TAIL_BYTES): StderrTail {
  let kept = "";
  return {
    push: (chunk) => {
      kept += chunk;
      if (kept.length <= limit) return;
      const cut = kept.slice(kept.length - limit);
      const line = cut.indexOf("\n");
      kept = line === -1 || line === cut.length - 1 ? cut : cut.slice(line + 1);
    },
    text: () => kept,
  };
}

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  // Anthropic keys and OAuth tokens.
  /sk-ant-[A-Za-z0-9_-]{8,}/gu,
  // A bearer credential in a header.
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/giu,
  // KEY=value and "key": "value" for names that hold credentials.
  /((?:[A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|AUTH)[A-Z0-9_]*)\s*=\s*)\S{8,}/gu,
  /("(?:[A-Za-z]*(?:[Tt]oken|[Kk]ey|[Ss]ecret|[Pp]assword))"\s*:\s*")[^"]{8,}/gu,
  /((?:x-api-key|authorization|cookie)\s*:\s*)\S{8,}/giu,
  // A JSON web token.
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
];

/** The text with every credential-looking value replaced by "[redacted]". */
export function scrubSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (scrubbed, pattern) =>
      scrubbed.replace(pattern, (whole, prefix?: unknown) =>
        typeof prefix === "string" && whole.startsWith(prefix)
          ? `${prefix}[redacted]`
          : "[redacted]",
      ),
    text,
  );
}

export interface ClaudeStreamFailure {
  /** The plain reason, for the person. */
  readonly reason: string;
  /** The reason and what happens next: what the conversation says. */
  readonly words: string;
  /** What the server log keeps, scrubbed. */
  readonly log: {
    readonly error: string | null;
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly stderr: string;
  };
}

const NEXT = "Send a message to pick up where it left off.";

const OUT_OF_MEMORY =
  /heap out of memory|reached heap limit|allocation failed|\bENOMEM\b|out of memory/iu;
const API_STOPPED =
  /\bAPI Error\b|overloaded|\b5\d\d\b.*(?:error|status)|(?:error|status).*\b5\d\d\b|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|network error/iu;

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The plain reason a Claude session's stream stopped, and the cause for the log. */
export function describeClaudeStreamFailure(input: {
  readonly error: unknown;
  readonly stderr: string;
}): ClaudeStreamFailure {
  const error = input.error;
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : null;
  const exitCode =
    readNumber(record.exitCode) ??
    readNumber(Number(/exited with code (\d+)/u.exec(message ?? "")?.[1] ?? Number.NaN));
  const signal =
    (typeof record.signal === "string" ? record.signal : null) ??
    /terminated by signal (SIG[A-Z0-9]+)/u.exec(message ?? "")?.[1] ??
    null;
  const said = `${message ?? ""}\n${input.stderr}`;
  const reason = OUT_OF_MEMORY.test(said)
    ? "Claude Code ran out of memory."
    : signal === "SIGKILL"
      ? "Claude Code was stopped by the system (SIGKILL), most often for lack of memory."
      : API_STOPPED.test(said)
        ? "The Claude API stopped answering."
        : signal !== null
          ? `Claude Code was stopped (${signal}).`
          : exitCode !== null
            ? `Claude Code exited (code ${exitCode}).`
            : "Claude Code stopped unexpectedly.";
  return {
    reason,
    words: `${reason} ${NEXT}`,
    log: {
      error: message === null ? null : scrubSecrets(message),
      exitCode,
      signal,
      stderr: scrubSecrets(input.stderr),
    },
  };
}
