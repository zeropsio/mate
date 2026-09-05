/**
 * Small helpers every per-kind builder shares: reading a call's decoded card,
 * the step/status-word/voice plumbing, and `phaseFor` — the ONE mapping from
 * a call's status to an operation's phase (declined/stopped are their own
 * outcome, never folded into "done" — the bug §2.6 fixes).
 */
import {
  readRecord,
  readString,
  readZeropsCardSource,
  type ZeropsCardSource,
} from "../../cards/decode.ts";
import { decodeZeropsCard, type ZeropsCardPayload } from "../../cards/payloads.ts";
import {
  neutralStatusWord,
  operationStatusWord,
  operationVoice,
  statusWord,
  type OperationStatusWordContext,
} from "../../operations/phrases.ts";
import type {
  ZeropsCall,
  ZeropsOperationKind,
  ZeropsOperationLink,
  ZeropsOperationPhase,
  ZeropsOperationStep,
  ZeropsOperationStepState,
} from "../types.ts";

/**
 * What a per-kind builder returns: everything about a `ZeropsOperation` that
 * depends on the tool's own shape. `operations.ts` fills in the rest (key,
 * kind, phase, anchor, callIds, attempts) — the same fields for every kind.
 */
export interface BuiltCardFields {
  readonly subject: string;
  readonly kicker: string;
  readonly voice: string;
  readonly voiceSource: "agent" | "mate";
  readonly statusWord: string;
  readonly closing?: string;
  readonly steps: ReadonlyArray<ZeropsOperationStep>;
  readonly links: ReadonlyArray<ZeropsOperationLink>;
  readonly detail?: string;
  readonly target?: { readonly hostname: string };
  readonly resultStatus?: string;
  readonly hasResult: boolean;
  /** `browser` only: the last call's screenshot, as a data URI ready for an `<img src>`. */
  readonly screenshot?: { readonly src: string; readonly width?: number; readonly height?: number };
  /** Overrides `phaseFor(call.status)` — only `deploy`'s BUILD_TRIGGERED needs this. */
  readonly phaseOverride?: ZeropsOperationPhase;
}

/**
 * The one line a person should read. A zcli SSH-deploy error is a multi-line
 * CLI log transcript whose own first line is a generic "X failed:" header —
 * the actionable reason is the first `level=error msg="…"` line (zcli's own
 * log format), so that one wins when present; otherwise the literal first
 * line, which is already the whole story for every other zcp error shape.
 */
export function firstLine(text: string): string {
  const cliErrorLine = text.match(/level=error msg="([^"]*)"/);
  const message = cliErrorLine?.[1];
  if (message !== undefined) {
    return message.replace(/^[✗✓➤]\s*(ERR|DONE|INFO)\s*/, "").trim();
  }
  return (text.split("\n")[0] ?? text).trim();
}

export function firstParagraph(text: string): string {
  return (text.split(/\n\s*\n/)[0] ?? text).trim();
}

/** The host portion of a URL, without a scheme parser — R1 keeps this platform-free. */
export function urlHost(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? url;
}

export function stepState(rawStatus: string): ZeropsOperationStepState {
  switch (statusWord(rawStatus)) {
    case "Done":
    case "Skipped":
      return "done";
    case "Running":
      return "running";
    case "Failed":
      return "failed";
    case "Waiting":
      return "queued";
    default:
      return "queued";
  }
}

export function buildStep(
  id: string,
  label: string,
  rawStatus: string,
  note?: string,
): ZeropsOperationStep {
  return {
    id,
    label,
    state: stepState(rawStatus),
    stateLabel: statusWord(rawStatus),
    ...(note !== undefined && note.length > 0 ? { note } : {}),
  };
}

/** Every call read in this module goes through here — the one wire reader. */
function cardSourceForCall(call: ZeropsCall): ZeropsCardSource | undefined {
  return readZeropsCardSource(
    {
      toolName: call.toolName,
      ...(call.resultText !== undefined ? { resultText: call.resultText } : {}),
      ...(call.truncated ? { truncated: true } : {}),
    },
    { failed: call.status === "failed" },
  );
}

export interface DecodedEntry {
  readonly document?: Record<string, unknown> | undefined;
  readonly card?: ZeropsCardPayload | undefined;
}

/** A call decoded exactly once, at fold time — every later read reuses this. */
export function decodeCall(call: ZeropsCall): DecodedEntry {
  const source = cardSourceForCall(call);
  return { document: source?.document, card: decodeZeropsCard(source) };
}

export interface ErrorInfo {
  readonly message: string;
  readonly diagnostic?: string;
  readonly suggestion?: string;
}

export function errorInfoFor(call: ZeropsCall, decoded: DecodedEntry): ErrorInfo | undefined {
  if (call.status !== "failed") {
    return undefined;
  }
  if (decoded.card?.kind === "error") {
    return {
      message: decoded.card.message,
      ...(decoded.card.suggestion !== undefined ? { suggestion: decoded.card.suggestion } : {}),
      ...(readString(decoded.document?.diagnostic) !== undefined
        ? { diagnostic: readString(decoded.document?.diagnostic)! }
        : {}),
    };
  }
  const rawMessage = readString(decoded.document?.error) ?? call.resultText;
  return { message: rawMessage ?? "Failed." };
}

export function readInputString(
  input: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return readString(input?.[key]);
}

export function pickFirst(...values: ReadonlyArray<string | undefined>): string | undefined {
  return values.find((v) => v !== undefined);
}

export const KIND_LABEL: Readonly<
  Record<Exclude<ZeropsOperationKind, "bootstrap" | "error">, string>
> = {
  deploy: "Deploy",
  import: "Import",
  mount: "Mount",
  verify: "Verify",
  subdomain: "Subdomain",
  delete: "Delete",
  scale: "Scale",
  manage: "Manage",
  env: "Env",
  devServer: "Dev server",
  browser: "Browser",
};

/** The ONE call-status → operation-phase mapping (§2.3, declined/stopped are not "done"). */
export function phaseFor(status: ZeropsCall["status"]): ZeropsOperationPhase {
  switch (status) {
    case "inProgress":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "declined":
      return "declined";
    case "stopped":
      return "stopped";
    case "interrupted":
      return "interrupted";
  }
}

/**
 * The status word: the kind's own verb/claim when a card decoded, OR when no
 * result has landed at all yet — a running verb ("Deploying", "Checking",
 * "In progress", …) describes what is happening, not a claim the result
 * made, so a pending call keeps it. The neutral word (`neutralStatusWord`)
 * applies only once a result has landed and still did not decode.
 */
export function gatedStatusWord(
  kind: ZeropsOperationKind,
  phase: ZeropsOperationPhase,
  hasCard: boolean,
  hasResult: boolean,
  context?: OperationStatusWordContext,
): string {
  return hasCard || !hasResult
    ? operationStatusWord(kind, phase, context)
    : neutralStatusWord(phase);
}

export function mateVoiceFor(
  kind: ZeropsOperationKind,
  subject: string,
): { voice: string; voiceSource: "agent" | "mate" } {
  return { voice: operationVoice(kind, subject), voiceSource: "mate" };
}

export function undecodedDetail(call: ZeropsCall): string | undefined {
  if (call.truncated) {
    return "Result too large to show.";
  }
  return call.resultText;
}

function buildDetail(parts: ReadonlyArray<string | undefined>): string | undefined {
  const present = parts.filter((p): p is string => p !== undefined && p.trim().length > 0);
  return present.length > 0 ? present.join("\n\n") : undefined;
}

/** `{ detail }` when any part is present, else `{}` — spread directly into the built operation. */
export function detailField(
  parts: ReadonlyArray<string | undefined>,
): { detail: string } | Record<string, never> {
  const detail = buildDetail(parts);
  return detail !== undefined ? { detail } : {};
}

export { readRecord };
