import { readRecordArray, readString } from "../../cards/decode.ts";
import {
  type ZeropsCardPayload,
  type ZeropsDeployCard,
  decodeDeployResult,
} from "../../cards/payloads.ts";
import { OPEN_IN_ZEROPS, operationClosing, sentenceCase } from "../../operations/phrases.ts";
import { zeropsProjectUrl } from "../../serviceMap.ts";
import type {
  ZeropsCall,
  ZeropsOperationLink,
  ZeropsOperationPhase,
  ZeropsOperationStep,
  ZeropsOperationVersion,
} from "../types.ts";
import {
  type BuiltCardFields,
  DEPLOY_BUILD_CAP_MS,
  type DecodedEntry,
  type ErrorInfo,
  KIND_LABEL,
  type OperationBuildContext,
  buildStep,
  decodeCall,
  detailField,
  errorInfoFor,
  explanationField,
  failedCallReason,
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

/**
 * The deploy tool call itself may complete while the build it triggered is
 * still running — the phase then stays running regardless of the call's own
 * terminal status, until the cap past the call's return makes it uncertain.
 */
function deployPhase(
  call: ZeropsCall,
  resultStatus: string | undefined,
  nowMs: number,
): ZeropsOperationPhase {
  const basePhase = phaseFor(call.status);
  if (basePhase !== "done" || resultStatus !== "BUILD_TRIGGERED") {
    return basePhase;
  }
  const pastCap =
    call.settledAt !== undefined && nowMs - Date.parse(call.settledAt) >= DEPLOY_BUILD_CAP_MS;
  return pastCap ? "uncertain" : "running";
}

function deployLinks(
  phase: ZeropsOperationPhase,
  subdomainUrl: string | undefined,
  projectId: string | undefined,
): ReadonlyArray<ZeropsOperationLink> {
  if (phase === "done" && subdomainUrl !== undefined) {
    return [{ label: urlHost(subdomainUrl), url: subdomainUrl }];
  }
  if (phase === "uncertain" && projectId !== undefined) {
    return [{ label: OPEN_IN_ZEROPS, url: zeropsProjectUrl(projectId) }];
  }
  return [];
}

export function buildDeployFields(
  call: ZeropsCall,
  context: OperationBuildContext,
): BuiltCardFields {
  if (call.toolName === "zerops_deploy_batch") {
    return buildDeployBatchFields(call, context);
  }
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "deploy" ? decoded.card : undefined;
  const resultStatus = card?.status;
  const phase = deployPhase(call, resultStatus, context.nowMs);
  const subject =
    pickFirst(readInputString(call.input, "targetService"), card?.target) ?? "the service";
  const { voice, voiceSource } = mateVoiceFor("deploy", subject);

  // decodeZeropsCard never returns a "deploy" card once the tool call itself
  // failed (it returns the error card, or nothing) — the failing step still
  // needs naming, so a failed call's document is read as a deploy result here.
  const result =
    card ?? (decoded.document !== undefined ? decodeDeployResult(decoded.document) : undefined);
  const steps: ZeropsOperationStep[] = [];
  const failureClassification =
    phase === "failed" && decoded.document !== undefined
      ? readRecord(decoded.document.failureClassification)
      : undefined;
  if (phase === "failed") {
    const buildStatus = result?.buildStatus;
    const failedPhase = result?.failedPhase;
    if (buildStatus !== undefined) {
      steps.push(buildStep("build", "Build", failedPhase === "build" ? "FAILED" : buildStatus));
    }
    if (decoded.document !== undefined) {
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

  const links = deployLinks(phase, card?.subdomainUrl, context.projectId);

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
      result?.nextActions,
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
    ...versionField(result),
    ...deployExplanation(decoded, result, errorInfo),
    phaseOverride: phase,
  };
}

/** A deploy result that reports its own failure — zcp returns BUILD_FAILED and kin as a successful call. */
const reportsFailure = (card: ZeropsDeployCard): boolean =>
  card.failedPhase !== undefined || card.status.endsWith("FAILED");

function deployExplanation(
  decoded: DecodedEntry,
  result: ZeropsDeployCard | undefined,
  errorInfo: ErrorInfo | undefined,
): ReturnType<typeof explanationField> {
  const fromResult = result === undefined ? {} : resultExplanation(result);
  if (fromResult.explanation !== undefined || errorInfo === undefined) {
    return fromResult;
  }
  return explanationField(failedCallReason(decoded, errorInfo));
}

/** A deploy result's own reason and the log of its failing phase — `{}` when it neither failed nor timed out. */
function resultExplanation(card: ZeropsDeployCard): ReturnType<typeof explanationField> {
  if (card.timedOut !== true && !reportsFailure(card)) {
    return {};
  }
  const log =
    card.failedPhase === "init"
      ? (card.runtimeLogs ?? card.buildLogs)
      : (card.buildLogs ?? card.runtimeLogs);
  const message = card.message !== undefined ? firstLine(card.message) : undefined;
  return explanationField(card.failureCause ?? message, log);
}

type BatchEntry = Extract<ZeropsCardPayload, { kind: "deployBatch" }>["entries"][number];

/** The targets the agent named, in its order — known from the call's start. */
function batchInputTargets(input: Record<string, unknown>): ReadonlyArray<string> {
  return readRecordArray(input.targets).flatMap((target) => {
    const hostname = readString(target.targetService);
    return hostname === undefined ? [] : [hostname];
  });
}

function batchEntryStep(
  hostname: string,
  entry: BatchEntry | undefined,
  phase: ZeropsOperationPhase,
) {
  if (entry === undefined) {
    // No entry of its own: still running with the batch, or never reported.
    return buildStep(hostname, hostname, phase === "running" ? "in_progress" : "FAILED");
  }
  const result = entry.result;
  if (entry.error !== undefined || result === undefined) {
    return buildStep(hostname, hostname, "FAILED", entry.error);
  }
  if (reportsFailure(result)) {
    return buildStep(hostname, hostname, "FAILED", resultExplanation(result).explanation?.reason);
  }
  return buildStep(
    hostname,
    hostname,
    result.status === "BUILD_TRIGGERED" ? "in_progress" : result.status,
  );
}

/**
 * `zerops_deploy_batch`: one step per target. The targets come from the
 * input, so every service has its entry from the call's start and only
 * settles in place when the result lands; a target only the result names is
 * appended after them.
 */
function buildDeployBatchFields(call: ZeropsCall, context: OperationBuildContext): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const batch = decoded.card?.kind === "deployBatch" ? decoded.card : undefined;
  const entries = batch?.entries ?? [];
  const hostnames = [
    ...new Set([...batchInputTargets(call.input), ...entries.map((entry) => entry.target)]),
  ];
  const failedEntry = entries.find(
    (entry) =>
      entry.error !== undefined || entry.result === undefined || reportsFailure(entry.result),
  );
  const stillBuilding = entries.some((entry) => entry.result?.status === "BUILD_TRIGGERED");
  const phase =
    batch === undefined
      ? phaseFor(call.status)
      : failedEntry !== undefined
        ? "failed"
        : deployPhase(call, stillBuilding ? "BUILD_TRIGGERED" : undefined, context.nowMs);
  const subject = hostnames.length > 0 ? hostnames.join(", ") : "the services";
  const { voice, voiceSource } = mateVoiceFor("deploy", subject);
  const steps = hostnames.map((hostname) =>
    batchEntryStep(
      hostname,
      entries.find((entry) => entry.target === hostname),
      phase,
    ),
  );
  const failedReason =
    failedEntry === undefined
      ? undefined
      : (failedEntry.error ??
        (failedEntry.result !== undefined
          ? resultExplanation(failedEntry.result).explanation?.reason
          : undefined));
  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("deploy", "failed", {
            errorFirstLine:
              failedReason ?? (errorInfo !== undefined ? firstLine(errorInfo.message) : undefined),
          })
        : phase === "done" && batch?.summary !== undefined
          ? batch.summary
          : phase === "done"
            ? "Finished."
            : operationClosing("deploy", phase, {});
  const explanation =
    errorInfo !== undefined
      ? explanationField(failedCallReason(decoded, errorInfo))
      : failedEntry?.error !== undefined
        ? explanationField(failedEntry.error)
        : failedEntry?.result !== undefined
          ? resultExplanation(failedEntry.result)
          : {};
  const firstHost = hostnames[0];

  return {
    subject,
    kicker: `${KIND_LABEL.deploy} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "deploy",
      phase,
      batch !== undefined,
      call.resultText !== undefined,
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(call) : undefined,
    ]),
    ...(firstHost !== undefined ? { target: { hostname: firstHost } } : {}),
    hasResult: decoded.document !== undefined,
    ...explanation,
    phaseOverride: phase,
  };
}

function versionField(card: ZeropsDeployCard | undefined): { version?: ZeropsOperationVersion } {
  if (card?.appVersionId === undefined && card?.versionName === undefined) {
    return {};
  }
  return {
    version: {
      ...(card.appVersionId !== undefined ? { id: card.appVersionId } : {}),
      ...(card.versionName !== undefined ? { name: card.versionName } : {}),
    },
  };
}
