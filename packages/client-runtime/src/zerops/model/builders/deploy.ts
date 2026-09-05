import { readString } from "../../cards/decode.ts";
import { sentenceCase } from "../../operations/phrases.ts";
import type { ZeropsCall, ZeropsOperationStep } from "../types.ts";
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
  readRecord,
  undecodedDetail,
  urlHost,
} from "./shared.ts";
import { operationClosing } from "../../operations/phrases.ts";

export function buildDeployFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "deploy" ? decoded.card : undefined;
  const resultStatus = card?.status;
  const basePhase = phaseFor(call.status);
  // The deploy tool call itself may complete while the build it triggered is
  // still running — the phase then stays running regardless of the call's
  // own terminal status.
  const phase = basePhase === "done" && resultStatus === "BUILD_TRIGGERED" ? "running" : basePhase;
  const subject =
    pickFirst(readInputString(call.input, "targetService"), card?.target) ?? "the service";
  const { voice, voiceSource } = mateVoiceFor("deploy", subject);

  // decodeZeropsCard never returns a "deploy" card once the tool call itself
  // failed (it returns the error card, or nothing) — the failing step still
  // needs naming, so this reads `failedPhase`/`buildStatus` straight off the
  // raw document instead of the (always-undefined-here) typed payload.
  const steps: ZeropsOperationStep[] = [];
  const failureClassification =
    phase === "failed" && decoded.document !== undefined
      ? readRecord(decoded.document.failureClassification)
      : undefined;
  if (phase === "failed") {
    const document = decoded.document;
    const buildStatus = document !== undefined ? readString(document.buildStatus) : undefined;
    const failedPhase = document !== undefined ? readString(document.failedPhase) : undefined;
    if (buildStatus !== undefined) {
      steps.push(buildStep("build", "Build", failedPhase === "build" ? "FAILED" : buildStatus));
    }
    if (document !== undefined) {
      const stepId = failedPhase ?? "deploy";
      const stepLabel = failedPhase !== undefined ? sentenceCase(failedPhase) : "Deploy";
      steps.push(buildStep(stepId, stepLabel, "FAILED"));
    }
  } else if (card !== undefined) {
    if (card.buildStatus !== undefined) {
      steps.push(buildStep("build", "Build", card.buildStatus));
    }
    steps.push(buildStep("deploy", "Deploy", card.status));
  }

  const links =
    phase === "done" && card?.subdomainUrl !== undefined
      ? [{ label: urlHost(card.subdomainUrl), url: card.subdomainUrl }]
      : [];

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("deploy", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : phase === "done" && card !== undefined
          ? operationClosing("deploy", "done", { host: subject })
          : phase === "done"
            ? "Finished."
            : operationClosing("deploy", phase, {});

  return {
    subject,
    kicker: `${KIND_LABEL.deploy} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "deploy",
      phase,
      card !== undefined,
      call.resultText !== undefined,
      {
        resultStatus,
      },
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links,
    ...detailField([
      decoded.document !== undefined ? readString(decoded.document.nextActions) : undefined,
      decoded.document !== undefined ? readString(decoded.document.verification) : undefined,
      failureClassification !== undefined
        ? readString(failureClassification.likelyCause)
        : undefined,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(call) : undefined,
    ]),
    target: { hostname: subject },
    ...(resultStatus !== undefined ? { resultStatus } : {}),
    hasResult: decoded.document !== undefined,
    phaseOverride: phase,
  };
}
