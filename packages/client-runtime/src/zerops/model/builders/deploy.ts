import {
  PIPELINE_SLOTS,
  failedPipelineSlots,
  queuedPipelineSlots,
} from "../../activity/observedSteps.ts";
import type { DeployBuildRead } from "../../activity/deployBuild.ts";
import type { PipelineState } from "../../activity/pipelineState.ts";
import {
  readNumber,
  readRecord,
  readRecordArray,
  readString,
  readStringArray,
} from "../../cards/decode.ts";
import {
  type ZeropsCardPayload,
  type ZeropsDeployCard,
  decodeDeployResult,
} from "../../cards/payloads.ts";
import {
  GIT_PUSH_LABEL,
  OPEN_IN_ZEROPS,
  gitPushClosing,
  gitPushVoice,
  operationClosing,
} from "../../operations/phrases.ts";
import { zeropsProjectUrl } from "../../serviceMap.ts";
import type {
  ZeropsCall,
  ZeropsOperationLink,
  ZeropsOperationPhase,
  ZeropsOperationPullRequest,
  ZeropsOperationStep,
  ZeropsOperationVersion,
} from "../types.ts";
import {
  type BuiltCardFields,
  type DecodedEntry,
  type ErrorInfo,
  KIND_LABEL,
  type OperationBuildContext,
  UNREPORTED_STEP_STATUS,
  buildStep,
  decodeCall,
  errorInfoFor,
  explanationField,
  failedCallReason,
  firstLine,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  pickFirst,
  readInputString,
  urlHost,
} from "./shared.ts";

/** A triggered build's phase, from where the platform says it stands. */
const BUILD_PHASE: Readonly<Record<DeployBuildRead, ZeropsOperationPhase>> = {
  unread: "running",
  running: "running",
  finished: "done",
  failed: "failed",
  unobservable: "uncertain",
};

/**
 * The deploy tool call itself may complete while the build it triggered is
 * still running (zcp stopped following it): the phase is then the build's own,
 * read by the appVersion the result named — never a clock. A result that
 * named none leaves no handle to read it by: uncertain.
 */
function deployPhase(
  call: ZeropsCall,
  triggered: ReadonlyArray<string | undefined> | undefined,
  builds: OperationBuildContext["builds"],
): ZeropsOperationPhase {
  const basePhase = phaseFor(call.status);
  if (basePhase !== "done" || triggered === undefined) {
    return basePhase;
  }
  const phases = triggered.map((appVersionId) =>
    appVersionId === undefined ? "uncertain" : BUILD_PHASE[builds(appVersionId)],
  );
  for (const phase of ["failed", "running", "uncertain"] as const) {
    if (phases.includes(phase)) return phase;
  }
  return "done";
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

/** zcp's `failedPhase` (`failedPhaseForStatus`) → the pipeline slot it failed at. */
const FAILED_PHASE_SLOT: Readonly<Record<string, keyof PipelineState>> = {
  build: "RUN_BUILD_COMMANDS",
  prepare: "RUN_PREPARE_COMMANDS",
  init: "DEPLOY",
};

/**
 * A single-service deploy holds the pipeline's five slots from birth to
 * settle, whether or not the card was open to observe them: queued while it
 * runs, then read from the result — the slot a failure names and the ones
 * around it, else every slot under the call's own phase.
 */
function deploySlots(
  phase: ZeropsOperationPhase,
  failedPhase: string | undefined,
): ReadonlyArray<ZeropsOperationStep> {
  if (phase === "running") {
    return queuedPipelineSlots();
  }
  const failedAt = failedPhase === undefined ? undefined : FAILED_PHASE_SLOT[failedPhase];
  if (failedAt !== undefined) {
    return failedPipelineSlots(failedAt);
  }
  return PIPELINE_SLOTS.map(({ id, label }) => buildStep(id, label, UNREPORTED_STEP_STATUS[phase]));
}

export function buildDeployFields(
  call: ZeropsCall,
  context: OperationBuildContext,
): BuiltCardFields {
  if (call.toolName === "zerops_deploy_batch") {
    return buildDeployBatchFields(call, context);
  }
  const decoded = decodeCall(call);
  // A failed call's document is zcp's error, never a push result.
  const pushed = call.status === "failed" ? undefined : decodeGitPushResult(decoded.document);
  if (pushed !== undefined || readInputString(call.input, "strategy") === GIT_PUSH_STRATEGY) {
    return buildGitPushFields(call, context, decoded, pushed);
  }
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "deploy" ? decoded.card : undefined;
  const resultStatus = card?.status;
  // A result that reports its own failure is a failed deploy however cleanly
  // the call returned — the batch reads its entries the same way.
  const failedByResult = card !== undefined && reportsFailure(card);
  // A build zcp stopped following: its phase is the build's own, and zcp's words from before it
  // ended say nothing of how it ended.
  const triggered = !failedByResult && resultStatus === "BUILD_TRIGGERED";
  const phase = failedByResult
    ? "failed"
    : deployPhase(call, triggered ? [card?.appVersionId] : undefined, context.builds);
  const subject =
    pickFirst(readInputString(call.input, "targetService"), card?.target) ?? "the service";
  const { voice, voiceSource } = mateVoiceFor("deploy", subject);

  // decodeZeropsCard never returns a "deploy" card once the tool call itself
  // failed (it returns the error card, or nothing) — the failing step still
  // needs naming, so a failed call's document is read as a deploy result here.
  const result =
    card ?? (decoded.document !== undefined ? decodeDeployResult(decoded.document) : undefined);
  const steps = deploySlots(phase, result?.failedPhase);

  const links = deployLinks(phase, card?.subdomainUrl, context.projectId);

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("deploy", "failed", {
            errorFirstLine:
              errorInfo !== undefined
                ? firstLine(errorInfo.message)
                : card?.message !== undefined && !triggered
                  ? firstLine(card.message)
                  : undefined,
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
    target: { hostname: subject },
    ...(resultStatus !== undefined ? { resultStatus } : {}),
    hasResult: decoded.document !== undefined,
    ...versionField(result),
    ...(triggered && phase !== "running" && phase !== "uncertain"
      ? {}
      : deployExplanation(decoded, result, errorInfo)),
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

// --- git push ----------------------------------------------------------------

/** zcp's `strategy` for a push to a git remote (`deployStrategyGitPush`, `internal/tools/deploy_ssh.go`). */
const GIT_PUSH_STRATEGY = "git-push";

/** A git push's own step: every outcome holds it alone but a build zcp watched to its end. */
const GIT_PUSH_STEP_ID = "push";

/**
 * What a git push came to (`internal/tools/deploy_git_push.go`): `pushed` —
 * nothing built by this call, whether nothing is wired to build (a Mate's own
 * change in HQ among them) or zcp could not watch; `upToDate` — the remote
 * already had every commit; `delivered` — the build the push triggered was
 * watched to ACTIVE; `buildFailed` — that build failed or was cancelled;
 * `buildUnconfirmed` — it never appeared, or was still running when zcp
 * stopped watching; `refused` — zcp's `gitPushPrerequisites`, nothing pushed.
 */
type GitPushOutcome =
  | "pushed"
  | "upToDate"
  | "delivered"
  | "buildFailed"
  | "buildUnconfirmed"
  | "refused";

/**
 * `internal/ops/deploy_common.go` `GitPushResult`, with the change
 * `deployGitPushResponse` adds for a push to this Mate's HQ — or zcp's
 * `gitPushPrerequisites`, which answers `GIT_TOKEN_MISSING` as a call that
 * succeeded. Only the fields the card reads.
 */
interface GitPushResult {
  readonly outcome: GitPushOutcome;
  readonly status: string;
  readonly branch: string | undefined;
  readonly message: string | undefined;
  /** Where the push's build lands — a standard pair's stage half. */
  readonly buildTarget: string | undefined;
  /** The watched build's last appVersion status, or `NOT_OBSERVED`. */
  readonly buildStatus: string | undefined;
  readonly verifyTarget: string | undefined;
  readonly failureCause: string | undefined;
  readonly buildLogs: ReadonlyArray<string>;
  readonly pullRequest: ZeropsOperationPullRequest | undefined;
}

/**
 * A build that did not land: an appVersion's `*_FAILED`, or the watch's own
 * `FAILED` / `CANCELED`. zcp's watch ends only on ACTIVE, FAILED and
 * CANCELED (`internal/ops/build_watch.go`), so a `BUILD_FAILED` comes back as
 * a watch that gave up — and still failed.
 */
const FAILED_BUILD_STATUS = /FAIL|CANCEL/u;

function gitPushOutcome(
  status: string,
  buildStatus: string | undefined,
): GitPushOutcome | undefined {
  switch (status) {
    case "DELIVERED":
      return "delivered";
    case "NOTHING_TO_PUSH":
      return "upToDate";
    case "GIT_TOKEN_MISSING":
      return "refused";
    case "PUSHED":
      return buildStatus === undefined
        ? "pushed"
        : FAILED_BUILD_STATUS.test(buildStatus)
          ? "buildFailed"
          : "buildUnconfirmed";
    default:
      return undefined;
  }
}

/** A git push's result, or undefined for any other document — a deploy's among them. */
function decodeGitPushResult(
  document: Record<string, unknown> | undefined,
): GitPushResult | undefined {
  const status = readString(document?.status);
  if (document === undefined || status === undefined) {
    return undefined;
  }
  const buildStatus = readString(document.buildStatus);
  const outcome = gitPushOutcome(status, buildStatus);
  if (outcome === undefined) {
    return undefined;
  }
  return {
    outcome,
    status,
    branch: readString(document.branch),
    message: readString(document.message),
    buildTarget: readString(document.buildTarget),
    buildStatus,
    verifyTarget: readString(document.verifyTarget),
    failureCause: readString(readRecord(document.failureClassification)?.likelyCause),
    buildLogs: readStringArray(document.buildLogs),
    pullRequest: decodePullRequest(readRecord(document.pullRequest)),
  };
}

/**
 * The change a push lands through: `repo` is its repository's name in HQ, or
 * `org/name` from main's zcp, and the flow names a repository by its last part.
 */
function decodePullRequest(
  record: Record<string, unknown> | undefined,
): ZeropsOperationPullRequest | undefined {
  const number = readNumber(record?.number);
  const repository = readString(record?.repo)
    ?.split("/")
    .findLast((part) => part.length > 0);
  return number === undefined || repository === undefined ? undefined : { repository, number };
}

const GIT_PUSH_PHASE: Readonly<Record<GitPushOutcome, ZeropsOperationPhase>> = {
  pushed: "done",
  upToDate: "done",
  delivered: "done",
  buildFailed: "failed",
  refused: "failed",
  buildUnconfirmed: "uncertain",
};

/** A call that returned reads as its result says; any other keeps the call's own phase. */
function gitPushPhase(call: ZeropsCall, pushed: GitPushResult | undefined): ZeropsOperationPhase {
  const basePhase = phaseFor(call.status);
  return basePhase === "done" && pushed !== undefined ? GIT_PUSH_PHASE[pushed.outcome] : basePhase;
}

/** zcp's `FailurePhaseFromStatus` (`internal/ops/deploy_failure.go`): the phase an appVersion failed in. */
const BUILD_STATUS_FAILED_PHASE: Readonly<Record<string, string>> = {
  BUILD_FAILED: "build",
  PREPARING_RUNTIME_FAILED: "prepare",
  DEPLOY_FAILED: "init",
};

/**
 * One push step for all a push did alone — the call's own phase, or done
 * under a build nobody saw end; the pipeline's five slots only for a build
 * zcp watched to its end, landed or failed where its status says.
 */
function gitPushSteps(
  phase: ZeropsOperationPhase,
  pushed: GitPushResult | undefined,
): ReadonlyArray<ZeropsOperationStep> {
  switch (pushed?.outcome) {
    case "delivered":
      return deploySlots(phase, undefined);
    case "buildFailed":
      return deploySlots(phase, BUILD_STATUS_FAILED_PHASE[pushed.buildStatus ?? ""]);
    case "buildUnconfirmed":
      return [buildStep(GIT_PUSH_STEP_ID, GIT_PUSH_LABEL, "FINISHED")];
    default:
      return [buildStep(GIT_PUSH_STEP_ID, GIT_PUSH_LABEL, UNREPORTED_STEP_STATUS[phase])];
  }
}

/** The service a push's outcome is about: the build's target once a build was watched, else the push's source. */
function gitPushTarget(subject: string, pushed: GitPushResult | undefined): string {
  switch (pushed?.outcome) {
    case "delivered":
      return pushed.verifyTarget ?? pushed.buildTarget ?? subject;
    case "buildFailed":
    case "buildUnconfirmed":
      return pushed.buildTarget ?? subject;
    default:
      return subject;
  }
}

function gitPushClosingFor(
  phase: ZeropsOperationPhase,
  pushed: GitPushResult | undefined,
  errorInfo: ErrorInfo | undefined,
  target: string,
): string | undefined {
  switch (phase) {
    case "running":
      return undefined;
    case "failed": {
      // A push result's message says the push landed — only a refusal's is the failure.
      const failure =
        errorInfo?.message ?? (pushed?.outcome === "refused" ? pushed.message : undefined);
      return operationClosing("deploy", "failed", {
        failureCause: pushed?.failureCause,
        errorFirstLine: failure === undefined ? undefined : firstLine(failure),
      });
    }
    case "done":
      switch (pushed?.outcome) {
        case "delivered":
          return operationClosing("deploy", "done", { host: target });
        case "pushed":
          return gitPushClosing("pushed", {
            branch: pushed.branch,
            pullRequest: pushed.pullRequest?.number,
          });
        case "upToDate":
          return gitPushClosing("upToDate", {});
        default:
          return "Finished.";
      }
    default:
      return operationClosing("deploy", phase, {});
  }
}

function gitPushExplanation(
  decoded: DecodedEntry,
  pushed: GitPushResult | undefined,
  errorInfo: ErrorInfo | undefined,
): ReturnType<typeof explanationField> {
  if (errorInfo !== undefined) {
    return explanationField(failedCallReason(decoded, errorInfo));
  }
  switch (pushed?.outcome) {
    case "buildFailed":
      return explanationField(pushed.failureCause, pushed.buildLogs);
    case "refused":
      return explanationField(pushed.message === undefined ? undefined : firstLine(pushed.message));
    default:
      return {};
  }
}

/**
 * `zerops_deploy` with `strategy: "git-push"` (`GIT_PUSH_LABEL`): a push from
 * the call's first moment — its input says so — to its last, and a deploy
 * only once the build it triggered landed. `pushed` is undefined while the
 * call runs, once it failed, and for a result this build cannot read, which
 * then claims nothing.
 */
function buildGitPushFields(
  call: ZeropsCall,
  context: OperationBuildContext,
  decoded: DecodedEntry,
  pushed: GitPushResult | undefined,
): BuiltCardFields {
  const errorInfo = errorInfoFor(call, decoded);
  const phase = gitPushPhase(call, pushed);
  const subject = readInputString(call.input, "targetService") ?? "the service";
  const target = gitPushTarget(subject, pushed);
  const closing = gitPushClosingFor(phase, pushed, errorInfo, target);
  return {
    subject,
    kicker: `${GIT_PUSH_LABEL} · ${subject}`,
    strategy: "git-push",
    ...(pushed?.pullRequest !== undefined ? { pullRequest: pushed.pullRequest } : {}),
    voice: gitPushVoice(subject),
    voiceSource: "mate",
    statusWord: gatedStatusWord(
      "deploy",
      phase,
      pushed !== undefined,
      call.resultText !== undefined,
      { gitPush: true, resultStatus: pushed?.status },
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps: gitPushSteps(phase, pushed),
    links: deployLinks(phase, undefined, context.projectId),
    target: { hostname: target },
    ...(pushed !== undefined ? { resultStatus: pushed.status } : {}),
    hasResult: decoded.document !== undefined,
    ...gitPushExplanation(decoded, pushed, errorInfo),
    phaseOverride: phase,
  };
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
  const stillBuilding = entries.flatMap((entry) =>
    entry.result?.status === "BUILD_TRIGGERED" ? [entry.result.appVersionId] : [],
  );
  const phase =
    batch === undefined
      ? phaseFor(call.status)
      : failedEntry !== undefined
        ? "failed"
        : deployPhase(call, stillBuilding.length > 0 ? stillBuilding : undefined, context.builds);
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
  const appVersionIds = entries.flatMap((entry) =>
    entry.result?.appVersionId === undefined ? [] : [entry.result.appVersionId],
  );

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
    ...(firstHost !== undefined ? { target: { hostname: firstHost } } : {}),
    batch: true,
    ...(appVersionIds.length > 0 ? { appVersionIds } : {}),
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
