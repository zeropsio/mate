/**
 * Why a Claude session's stream stopped, read off what is left of it: the
 * SDK's error (its message, the CLI's exit code or signal), a defect of our
 * own reading of it, and the CLI's stderr from this stream's life. The person
 * reads a plain reason and what to do next.
 *
 * The log never takes stderr as it came: only the lines that say what crashed
 * (an allow-list), each cut before anything key-like, with any long token-like
 * run and any URL credential redacted. Every pattern here runs in linear time
 * on a bounded line: one bounded class repetition, or plain alternatives.
 */

const STDERR_TAIL_CHARS = 8 * 1024;
/** No line is read past this: what crashed is said at its start. */
const LINE_CHARS = 400;

export interface StderrTail {
  readonly push: (chunk: string) => void;
  readonly text: () => string;
  /** A new stream's life begins: what came before is no longer its stderr. */
  readonly reset: () => void;
}

/** The newest whole lines the CLI wrote to stderr, within `limit` characters. */
export function makeStderrTail(limit = STDERR_TAIL_CHARS): StderrTail {
  let kept = "";
  return {
    push: (chunk) => {
      kept += chunk;
      if (kept.length <= limit) return;
      const cut = kept.slice(kept.length - limit);
      // A cut never starts mid-line: what it cut into may be half a secret.
      const line = cut.indexOf("\n");
      kept = line === -1 ? "" : cut.slice(line + 1);
    },
    text: () => kept,
    reset: () => {
      kept = "";
    },
  };
}

const LONG_RUN = /[A-Za-z0-9+/_=.-]{20,}/gu;
const URL_CREDENTIALS = /\/\/[^\s/@]{1,256}@/gu;
/** Where key-like matter can start: the line is cut there. */
const CUT_AT = [
  "=",
  '"',
  "'",
  "`",
  "{",
  "authorization",
  "cookie",
  "api-key",
  "api_key",
  "apikey",
  "password",
  "secret",
  "bearer ",
  "basic ",
];

function guard(text: string): string {
  return text.replace(URL_CREDENTIALS, "//[redacted]@").replace(LONG_RUN, "[redacted]");
}

function cutBeforeKeys(line: string): string {
  const lower = line.toLowerCase();
  let end = line.length;
  for (const marker of CUT_AT) {
    const at = lower.indexOf(marker);
    if (at !== -1 && at < end) end = at;
  }
  return line.slice(0, end).trimEnd();
}

const HEAP = /heap out of memory|Reached heap limit|Allocation failed/u;
const ERROR_HEADLINE = /^(?:[A-Z][A-Za-z]{0,40})?Error:/u;
const EXIT_OR_SIGNAL = /exited with code \d{1,5}|terminated by signal SIG[A-Z0-9]{1,12}/u;
const NETWORK = /\bENOMEM\b|\bECONNRESET\b|\bETIMEDOUT\b|socket hang up/u;
const API_STATUS = /^API Error: \d{3}\b/u;

/**
 * The lines of a stderr that say what crashed, and nothing else: Node's fatal
 * and heap lines, error headlines cut before anything key-like, an exit or
 * signal, a network failure, the API's status line.
 */
export function crashLines(stderr: string): string[] {
  const kept: string[] = [];
  for (const raw of stderr.split("\n")) {
    const line = raw.trim().slice(0, LINE_CHARS);
    if (line.length === 0) continue;
    let crash: string | null = null;
    if (line.startsWith("FATAL ERROR") || HEAP.test(line)) {
      crash = cutBeforeKeys(line);
    } else if (API_STATUS.test(line) || ERROR_HEADLINE.test(line)) {
      crash = cutBeforeKeys(line);
    } else {
      const exit = EXIT_OR_SIGNAL.exec(line);
      if (exit !== null) {
        crash = line.slice(0, exit.index + exit[0].length);
      } else {
        const network = NETWORK.exec(line);
        if (network !== null) crash = network[0];
      }
    }
    if (crash !== null && crash.length > 0) kept.push(guard(crash));
  }
  return kept;
}

export interface ClaudeStreamFailure {
  /** The plain reason, for the person. */
  readonly reason: string;
  /** The reason and what to do next: what the conversation says. */
  readonly words: string;
  /** What the server log keeps. */
  readonly log: {
    readonly error: string | null;
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly crashLines: ReadonlyArray<string>;
    readonly stack: string | null;
  };
}

const NEXT = "Send a message to pick up where it left off.";
const SIGN_IN_NEXT = "Sign Claude in again, then send a message to pick up where it left off.";

const SIGNED_OUT = /OAuth token has expired|Invalid API key|API Error: 401\b|Please run \/login/u;
const OUT_OF_MEMORY = /heap out of memory|Reached heap limit|Allocation failed|\bENOMEM\b/u;
const API_DOWN_HEAD = /^API Error: (?:5\d\d|529)\b|\boverloaded\b/iu;
const API_DOWN_LINE = /^API Error: (?:5\d\d|529)\b/u;
const DROPPED = /ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/u;

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The API stopped answering, as the CLI's own lines say it: never an MCP server's or a stack frame's. */
function apiDownIn(stderr: string): boolean {
  return stderr.split("\n").some((raw) => {
    const line = raw.trim().slice(0, LINE_CHARS);
    return API_DOWN_LINE.test(line) || (ERROR_HEADLINE.test(line) && DROPPED.test(line));
  });
}

/** The plain reason a Claude session's stream stopped, and the cause for the log. */
export function describeClaudeStreamFailure(input: {
  readonly error: unknown;
  /** The CLI's stderr from this stream's life (`StderrTail`). */
  readonly stderr: string;
  /** A defect of our own reading of the stream, not Claude Code's failure. */
  readonly defect?: boolean;
}): ClaudeStreamFailure {
  const { error } = input;
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : null;
  // The SDK appends its own stderr tail to a process error: not its message.
  const head = rawMessage === null ? null : rawMessage.split(". stderr: ")[0]!.slice(0, LINE_CHARS);
  const exitCode =
    readNumber(record.exitCode) ??
    readNumber(Number(/exited with code (\d{1,5})/u.exec(head ?? "")?.[1] ?? Number.NaN));
  const signal =
    (typeof record.signal === "string" ? record.signal.slice(0, 16) : null) ??
    /terminated by signal (SIG[A-Z0-9]{1,12})/u.exec(head ?? "")?.[1] ??
    null;
  const said = `${head ?? ""}\n${input.stderr}`;
  const reason = input.defect
    ? "Mate failed to read Claude's output."
    : signal === "SIGKILL"
      ? "Claude Code was stopped by the system (SIGKILL), most often for lack of memory."
      : SIGNED_OUT.test(said)
        ? "Claude's sign-in has expired."
        : OUT_OF_MEMORY.test(said)
          ? "Claude Code ran out of memory."
          : signal !== null
            ? `Claude Code was stopped (${signal}).`
            : exitCode !== null
              ? `Claude Code exited (code ${exitCode}).`
              : API_DOWN_HEAD.test(head ?? "") ||
                  DROPPED.test(head ?? "") ||
                  apiDownIn(input.stderr)
                ? "The Claude API stopped answering."
                : "Claude Code stopped unexpectedly.";
  const named =
    head === null
      ? null
      : error instanceof Error && error.name !== "Error"
        ? `${error.name}: ${head}`
        : head;
  const stack =
    input.defect && error instanceof Error && typeof error.stack === "string"
      ? guard(error.stack.slice(0, 2000))
      : null;
  return {
    reason,
    words: `${reason} ${reason === "Claude's sign-in has expired." ? SIGN_IN_NEXT : NEXT}`,
    log: {
      error: named === null ? null : guard(named),
      exitCode,
      signal,
      crashLines: crashLines(input.stderr),
      stack,
    },
  };
}
