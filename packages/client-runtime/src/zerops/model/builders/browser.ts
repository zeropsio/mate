import { operationClosing, sentenceCase } from "../../operations/phrases.ts";
import type { ZeropsCall } from "../types.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  detailField,
  errorInfoFor,
  firstLine,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  pickFirst,
  readInputString,
  undecodedDetail,
} from "./shared.ts";

function browserStepNote(step: {
  readonly success: boolean;
  readonly errorKind?: string;
}): string | undefined {
  return step.success || step.errorKind === undefined ? undefined : sentenceCase(step.errorKind);
}

export function buildBrowserFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "browser" ? decoded.card : undefined;
  const phase = phaseFor(call.status);
  const subject = pickFirst(readInputString(call.input, "url"), card?.url) ?? "the page";
  const { voice, voiceSource } = mateVoiceFor("browser", subject);

  const steps = (card?.steps ?? []).map((step, index) =>
    buildStep(
      `step-${index}`,
      step.label,
      step.success ? "ACTIVE" : "FAILED",
      browserStepNote(step),
    ),
  );

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("browser", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : phase === "done"
          ? card !== undefined
            ? operationClosing("browser", "done", {
                url: card.url,
                consoleErrorCount: card.consoleErrorCount,
                pageErrorCount: card.pageErrorCount,
                failedRequestCount: card.failedRequestCount,
              })
            : "Finished."
          : operationClosing("browser", phase, {});

  const firstImage = call.images?.[0];
  const screenshot =
    firstImage !== undefined
      ? {
          src: `data:${firstImage.mimeType};base64,${firstImage.data}`,
          ...(firstImage.width !== undefined ? { width: firstImage.width } : {}),
          ...(firstImage.height !== undefined ? { height: firstImage.height } : {}),
        }
      : undefined;

  return {
    subject,
    kicker: `${KIND_LABEL.browser} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "browser",
      phase,
      card !== undefined,
      call.resultText !== undefined,
    ),
    ...(closing !== undefined ? { closing } : {}),
    ...(screenshot !== undefined ? { screenshot } : {}),
    steps,
    links: [],
    ...detailField([
      card?.message,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(call) : undefined,
    ]),
    hasResult: decoded.document !== undefined,
  };
}
