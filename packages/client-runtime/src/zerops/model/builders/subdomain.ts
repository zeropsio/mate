import { operationClosing } from "../../operations/phrases.ts";
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
  urlHost,
} from "./shared.ts";

export function buildSubdomainFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "subdomain" ? decoded.card : undefined;
  const phase = phaseFor(call.status);
  const subject =
    pickFirst(readInputString(call.input, "serviceHostname"), card?.hostname) ?? "the service";
  const action = pickFirst(readInputString(call.input, "action"), card?.action) ?? "enable";
  const { voice, voiceSource } = mateVoiceFor("subdomain", subject);

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("subdomain", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : phase === "done"
          ? operationClosing("subdomain", "done", { action })
          : operationClosing("subdomain", phase, {});

  const links = (card?.urls ?? []).map((url) => ({ label: urlHost(url), url }));

  return {
    subject,
    kicker: `${KIND_LABEL.subdomain} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "subdomain",
      phase,
      card !== undefined,
      call.resultText !== undefined,
      { action },
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps: [
      buildStep(
        "subdomain",
        subject,
        phase === "failed" ? "FAILED" : phase === "done" ? "ACTIVE" : "in_progress",
      ),
    ],
    links,
    ...detailField([
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(call) : undefined,
    ]),
    target: { hostname: subject },
    hasResult: decoded.document !== undefined,
  };
}
