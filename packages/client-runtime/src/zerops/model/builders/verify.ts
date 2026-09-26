import { operationClosing } from "../../operations/phrases.ts";
import { humanizeCheckName } from "../../operations/phrases.ts";
import type { ZeropsCall } from "../types.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  errorInfoFor,
  firstLine,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  readInputString,
} from "./shared.ts";

export function buildVerifyFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "verify" ? decoded.card : undefined;
  const callPhase = phaseFor(call.status);
  // `payloads.ts` folds the all-services shape's summary prose into
  // `hostname` when there is no single service — that prose is never a
  // subject, so the only trustworthy source is whether the call itself named
  // one service.
  const inputHostname = readInputString(call.input, "serviceHostname");
  const isAllServices = inputHostname === undefined;
  const subject = inputHostname ?? "all services";
  const { voice, voiceSource } = mateVoiceFor("verify", subject);

  const steps = (card?.checks ?? []).map((check) => {
    // The name already says HTTP ("HTTP internal"); the result is the code
    // alone — and a failed check says why beside it, in its first line.
    const code = check.httpStatus !== undefined ? String(check.httpStatus) : undefined;
    const step = buildStep(
      check.name,
      isAllServices ? check.name : humanizeCheckName(check.name),
      check.status,
      code,
    );
    const why = check.detail === undefined ? undefined : firstLine(check.detail).trim();
    if (step.state !== "failed" || why === undefined || why.length === 0) return step;
    return { ...step, note: code === undefined ? why : `${code} · ${why}` };
  });
  const passed = steps.filter((s) => s.state === "done").length;
  const failedCount = steps.filter((s) => s.state === "failed").length;
  /**
   * The tool answers whether it could look; the checks answer what it saw.
   *
   * A verify over a service that was down came back `completed` — the look
   * succeeded — and the card said HEALTHY above "service running: failed" and
   * "http public: failed" (measured on the test account, 2026-09-20). A green
   * word over red steps is the one thing a status line must never do, so a
   * card with a failed check is a failed verify whatever the call's own status
   * was. A skipped check is not a failed one.
   */
  const phase = callPhase === "done" && failedCount > 0 ? "failed" : callPhase;

  const closing =
    phase === "running"
      ? undefined
      : phase !== "failed" && phase !== "done"
        ? operationClosing("verify", phase, {})
        : phase === "failed"
          ? card !== undefined
            ? operationClosing("verify", "failed", {
                checksFailed: failedCount,
                checksTotal: steps.length,
              })
            : errorInfo !== undefined
              ? firstLine(errorInfo.message)
              : "Failed."
          : card !== undefined
            ? operationClosing("verify", "done", {
                checksPassed: passed,
                checksTotal: steps.length,
              })
            : "Finished.";

  return {
    subject,
    kicker: `${KIND_LABEL.verify} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord("verify", phase, card !== undefined, call.resultText !== undefined),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    target: { hostname: subject },
    hasResult: decoded.document !== undefined,
    ...(phase === callPhase ? {} : { phaseOverride: phase }),
  };
}
