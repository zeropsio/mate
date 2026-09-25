/**
 * delete / scale / manage / env — no `payloads.ts` card, just a message
 * document plus the process outcome `decodeProcessOutcome` reads off it.
 */
import { readString } from "../../cards/decode.ts";
import { decodeProcessOutcome, type ZeropsProcessOutcome } from "../../cards/payloads.ts";
import { operationClosing } from "../../operations/phrases.ts";
import type { ZeropsCall } from "../types.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  detailField,
  errorInfoFor,
  explanationField,
  failedCallReason,
  firstLine,
  firstParagraph,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  readInputString,
  undecodedDetail,
} from "./shared.ts";

const SIMPLE_VOICE_SOURCE_FIELDS = ["hostname", "serviceHostname", "targetService"] as const;

function readSimpleSubject(
  input: Record<string, unknown> | undefined,
  document: Record<string, unknown> | undefined,
): string | undefined {
  for (const field of SIMPLE_VOICE_SOURCE_FIELDS) {
    const fromInput = readInputString(input, field);
    if (fromInput !== undefined) {
      return fromInput;
    }
  }
  for (const field of SIMPLE_VOICE_SOURCE_FIELDS) {
    const fromDocument = document !== undefined ? readString(document[field]) : undefined;
    if (fromDocument !== undefined) {
      return fromDocument;
    }
  }
  return undefined;
}

export function buildSimpleFields(
  kind: "delete" | "scale" | "manage" | "env",
  call: ZeropsCall,
): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const phase = phaseFor(call.status);
  const subject = readSimpleSubject(call.input, decoded.document) ?? "the service";
  const { voice, voiceSource } = mateVoiceFor(kind, subject);

  const outcome =
    decoded.document !== undefined ? decodeProcessOutcome(decoded.document) : undefined;
  const rawMessage =
    decoded.document !== undefined ? readString(decoded.document.message) : undefined;
  const summary = decoded.document !== undefined ? readString(decoded.document.summary) : undefined;
  const messageFirstParagraph = rawMessage !== undefined ? firstParagraph(rawMessage) : undefined;

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing(kind, "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : phase === "done"
          ? operationClosing(kind, "done", { message: messageFirstParagraph, summary })
          : operationClosing(kind, phase, {});
  const messageUsedAsClosing = phase === "done" && rawMessage !== undefined;

  return {
    subject,
    kicker: `${KIND_LABEL[kind]} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      kind,
      phase,
      decoded.document !== undefined,
      call.resultText !== undefined,
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps: [
      buildStep(
        kind,
        subject,
        phase === "failed" ? "FAILED" : phase === "done" ? "ACTIVE" : "in_progress",
      ),
    ],
    links: [],
    ...detailField([
      !messageUsedAsClosing ? rawMessage : undefined,
      outcome?.nextActions,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.document === undefined ? undecodedDetail(call) : undefined,
    ]),
    target: { hostname: subject },
    hasResult: decoded.document !== undefined,
    ...(errorInfo !== undefined
      ? explanationField(failedCallReason(decoded, errorInfo))
      : explanationField(outcomeReason(decoded.document, outcome))),
  };
}

/** The platform's reason for a failed process, else zcp's own word on a process it stopped waiting for. */
function outcomeReason(
  document: Record<string, unknown> | undefined,
  outcome: ZeropsProcessOutcome | undefined,
): string | undefined {
  if (outcome?.process?.status === "FAILED") {
    return outcome.process.failReason ?? readString(document?.message);
  }
  if (outcome?.timedOut === true) {
    return readString(document?.message) ?? readString(document?.warning);
  }
  return undefined;
}
