/**
 * `reduceZeropsOperations` — one object per thing done to the project. See
 * `../../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §3.
 *
 * Pure and deterministic: same entries in, same operations out. No clock —
 * every timestamp on a `ZeropsOperation` comes from an entry's own
 * `createdAt` / `startedAt` / `settledAt`.
 */
import {
  readRecord,
  readRecordArray,
  readString,
  readZeropsCardSource,
  type ZeropsCardSource,
} from "../cards/decode.ts";
import { decodeZeropsCard, type ZeropsCardPayload } from "../cards/payloads.ts";
import {
  classifyZeropsCall,
  isBootstrapRouteMenuStart,
  isBootstrapSessionCall,
  isBootstrapStartWithRoute,
} from "./classify.ts";
import {
  humanizeCheckName,
  humanizeToolName,
  neutralStatusWord,
  operationClosing,
  operationStatusWord,
  operationVoice,
  sentenceCase,
  statusWord,
  type OperationStatusWordContext,
} from "./phrases.ts";
import type {
  ZeropsCallEntry,
  ZeropsOperation,
  ZeropsOperationKind,
  ZeropsOperationLink,
  ZeropsOperationPhase,
  ZeropsOperationStep,
  ZeropsOperationStepState,
  ZeropsOperationsReduction,
} from "./types.ts";

// --- small text helpers ------------------------------------------------------

/**
 * The one line a person should read. A zcli SSH-deploy error is a multi-line
 * CLI log transcript whose own first line is a generic "X failed:" header —
 * the actionable reason is the first `level=error msg="…"` line (zcli's own
 * log format), so that one wins when present; otherwise the literal first
 * line, which is already the whole story for every other zcp error shape.
 */
function firstLine(text: string): string {
  const cliErrorLine = text.match(/level=error msg="([^"]*)"/);
  const message = cliErrorLine?.[1];
  if (message !== undefined) {
    return message.replace(/^[✗✓➤]\s*(ERR|DONE|INFO)\s*/, "").trim();
  }
  return (text.split("\n")[0] ?? text).trim();
}

function firstParagraph(text: string): string {
  return (text.split(/\n\s*\n/)[0] ?? text).trim();
}

/** The host portion of a URL, without a scheme parser — R1 keeps this platform-free. */
function urlHost(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? url;
}

function stepState(rawStatus: string): ZeropsOperationStepState {
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

function buildStep(
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

// --- reading the wire: reuse cards/decode.ts + cards/payloads.ts ------------

/** Every entry read in this module goes through here — the one wire reader. */
function cardSourceForEntry(entry: ZeropsCallEntry): ZeropsCardSource | undefined {
  return readZeropsCardSource(
    {
      toolName: entry.toolName,
      ...(entry.resultText !== undefined ? { resultText: entry.resultText } : {}),
      ...(entry.truncated === true ? { truncated: true } : {}),
    },
    { failed: entry.status === "failed" },
  );
}

interface DecodedEntry {
  readonly document?: Record<string, unknown> | undefined;
  readonly card?: ZeropsCardPayload | undefined;
}

function decodeEntry(entry: ZeropsCallEntry): DecodedEntry {
  const source = cardSourceForEntry(entry);
  return { document: source?.document, card: decodeZeropsCard(source) };
}

/** An entry decoded exactly once, at fold time — every later read reuses this. */
interface DecodedCall {
  readonly entry: ZeropsCallEntry;
  readonly decoded: DecodedEntry;
}

function decodeCall(entry: ZeropsCallEntry): DecodedCall {
  return { entry, decoded: decodeEntry(entry) };
}

interface ErrorInfo {
  readonly message: string;
  readonly diagnostic?: string;
  readonly suggestion?: string;
}

function errorInfoFor(entry: ZeropsCallEntry, decoded: DecodedEntry): ErrorInfo | undefined {
  if (entry.status !== "failed") {
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
  const rawMessage = readString(decoded.document?.error) ?? entry.resultText;
  return { message: rawMessage ?? "Failed." };
}

// --- classification helpers reused from the fold ------------------------------

function readInputString(
  input: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return readString(input?.[key]);
}

const CARD_TOOL_KINDS: Readonly<Record<string, ZeropsOperationKind>> = {
  zerops_deploy: "deploy",
  zerops_deploy_batch: "deploy",
  zerops_import: "import",
  zerops_verify: "verify",
  zerops_subdomain: "subdomain",
  zerops_delete: "delete",
  zerops_scale: "scale",
  zerops_manage: "manage",
  zerops_env: "env",
};

/**
 * The operation kind a "card"-classified call becomes — independent of
 * success/failure, but NOT independent of tool-specific shape: a call whose
 * successful form would be hidden or generic (`zerops_workflow status`, the
 * route-menu start, `zerops_mount action=status`, `zerops_discover`, …) only
 * ever reaches this function by failing, and stays kind `error` even then —
 * it never borrows `bootstrap` or `mount` just because the tool name matches.
 * Mirrors `classifyZeropsCall`'s own bootstrap/mount predicates exactly, so
 * the two never disagree about what a call fundamentally is.
 */
function determineKind(entry: ZeropsCallEntry): ZeropsOperationKind {
  const fixed = CARD_TOOL_KINDS[entry.toolName];
  if (fixed !== undefined) {
    return fixed;
  }
  if (entry.toolName === "zerops_mount") {
    return readInputString(entry.input, "action") === "status" ? "error" : "mount";
  }
  if (entry.toolName === "zerops_workflow" && isBootstrapSessionCall(entry.input)) {
    return "bootstrap";
  }
  return "error";
}

// --- fold: entries -> operation groups ---------------------------------------

interface OperationGroup {
  key: string;
  kind: ZeropsOperationKind;
  anchorEntryId: string;
  /** The bootstrap / card-tool calls folded into this operation, in fold order. */
  entries: DecodedCall[];
  /** `zerops_import` calls absorbed into an open bootstrap's `provision` step. */
  joinedImports: DecodedCall[];
  /** The bootstrap founder's own `intent`, or the route-menu reply's — set once, never overwritten. */
  bootstrapIntent?: string;
}

function bootstrapLatestPlan(group: OperationGroup):
  | {
      call: DecodedCall;
      document: Record<string, unknown>;
      card: Extract<ZeropsCardPayload, { kind: "plan" }>;
    }
  | undefined {
  for (let i = group.entries.length - 1; i >= 0; i--) {
    const call = group.entries[i]!;
    if (call.decoded.card?.kind === "plan" && call.decoded.document !== undefined) {
      return { call, document: call.decoded.document, card: call.decoded.card };
    }
  }
  return undefined;
}

function phaseFromStatus(status: ZeropsCallEntry["status"]): ZeropsOperationPhase {
  return status === "inProgress" ? "running" : status === "completed" ? "done" : "failed";
}

function bootstrapPhase(group: OperationGroup): ZeropsOperationPhase {
  const plan = bootstrapLatestPlan(group);
  if (plan !== undefined) {
    return plan.card.completed >= plan.card.total ? "done" : "running";
  }
  const latest = group.entries[group.entries.length - 1]!;
  return phaseFromStatus(latest.entry.status);
}

function findSingleOpenBootstrap(
  groups: ReadonlyArray<OperationGroup>,
): OperationGroup | undefined {
  const open = groups.filter((g) => g.kind === "bootstrap" && bootstrapPhase(g) === "running");
  return open.length === 1 ? open[0] : undefined;
}

/**
 * Folds one bootstrap-kind entry into `groups`/`groupByKey`.
 *
 * A founding `start route=…` call joins its own already-open group instead
 * of starting a duplicate when the session is already known (the agent
 * re-issuing `start` on an active session, which zcp answers with that
 * session's current state rather than a new one).
 *
 * A continuation's own decoded `sessionId`, when present, is authoritative —
 * it never re-keys a group that already carries a *different* real session
 * identity (`bootstrap:<id>`, not the placeholder `call:<entryId>`): doing so
 * would hijack that group's identity out from under its own later calls, which
 * would then find no group to join. A continuation with no resolvable session
 * of its own (still pending, or failed with no session in its error) instead
 * joins the single open bootstrap, exactly as before.
 */
function foldBootstrap(
  entry: ZeropsCallEntry,
  groups: OperationGroup[],
  groupByKey: Map<string, OperationGroup>,
  pendingIntent: string | undefined,
): void {
  const call = decodeCall(entry);
  const sessionId = call.decoded.card?.kind === "plan" ? call.decoded.card.sessionId : undefined;

  if (isBootstrapStartWithRoute(entry.input)) {
    const key = sessionId !== undefined ? `bootstrap:${sessionId}` : `call:${entry.id}`;
    const existing = sessionId !== undefined ? groupByKey.get(key) : undefined;
    if (existing !== undefined) {
      existing.entries.push(call);
      return;
    }
    const intent = readInputString(entry.input, "intent") ?? pendingIntent;
    const group: OperationGroup = {
      key,
      kind: "bootstrap",
      anchorEntryId: entry.id,
      entries: [call],
      joinedImports: [],
      ...(intent !== undefined ? { bootstrapIntent: intent } : {}),
    };
    groups.push(group);
    groupByKey.set(key, group);
    return;
  }

  let target = sessionId !== undefined ? groupByKey.get(`bootstrap:${sessionId}`) : undefined;
  if (target === undefined) {
    const openCandidate = findSingleOpenBootstrap(groups);
    if (
      openCandidate !== undefined &&
      (sessionId === undefined || openCandidate.key.startsWith("call:"))
    ) {
      target = openCandidate;
    }
  }
  if (target === undefined) {
    const key = sessionId !== undefined ? `bootstrap:${sessionId}` : `call:${entry.id}`;
    const group: OperationGroup = {
      key,
      kind: "bootstrap",
      anchorEntryId: entry.id,
      entries: [call],
      joinedImports: [],
    };
    groups.push(group);
    groupByKey.set(key, group);
    return;
  }

  target.entries.push(call);
  if (sessionId !== undefined && target.key.startsWith("call:")) {
    groupByKey.delete(target.key);
    target.key = `bootstrap:${sessionId}`;
    groupByKey.set(target.key, target);
  }
}

/** `reduceZeropsOperations` in anchor order — one object per thing done to the project. */
export function reduceZeropsOperations(
  entries: ReadonlyArray<ZeropsCallEntry>,
): ZeropsOperationsReduction {
  const groups: OperationGroup[] = [];
  const groupByKey = new Map<string, OperationGroup>();
  const consumedEntryIds = new Set<string>();
  let pendingBootstrapIntent: string | undefined;

  for (const entry of entries) {
    const cls = classifyZeropsCall(entry.toolName, entry.input, entry.status);

    if (cls === "hidden") {
      if (isBootstrapRouteMenuStart(entry.input)) {
        const intent = readInputString(entry.input, "intent");
        if (intent !== undefined) {
          pendingBootstrapIntent = intent;
        }
      }
      continue;
    }
    if (cls === "generic") {
      continue;
    }

    const kind = determineKind(entry);

    if (kind === "bootstrap") {
      consumedEntryIds.add(entry.id);
      foldBootstrap(entry, groups, groupByKey, pendingBootstrapIntent);
      pendingBootstrapIntent = undefined;
      continue;
    }

    if (kind === "import") {
      const openBootstrap = findSingleOpenBootstrap(groups);
      if (openBootstrap !== undefined) {
        consumedEntryIds.add(entry.id);
        openBootstrap.joinedImports.push(decodeCall(entry));
        continue;
      }
    }

    consumedEntryIds.add(entry.id);
    const key = `call:${entry.id}`;
    const group: OperationGroup = {
      key,
      kind,
      anchorEntryId: entry.id,
      entries: [decodeCall(entry)],
      joinedImports: [],
    };
    groups.push(group);
    groupByKey.set(key, group);
  }

  return {
    operations: groups.map(buildOperation),
    consumedEntryIds,
  };
}

// --- build: an operation group -> the rendered ZeropsOperation ---------------

const KIND_LABEL: Readonly<Record<Exclude<ZeropsOperationKind, "bootstrap" | "error">, string>> = {
  deploy: "Deploy",
  import: "Import",
  mount: "Mount",
  verify: "Verify",
  subdomain: "Subdomain",
  delete: "Delete",
  scale: "Scale",
  manage: "Manage",
  env: "Env",
};

function pickFirst(...values: ReadonlyArray<string | undefined>): string | undefined {
  return values.find((v) => v !== undefined);
}

/**
 * The status word: the kind's own verb/claim when a card decoded, OR when no
 * result has landed at all yet — a running verb ("Deploying", "Checking",
 * "In progress", …) describes what is happening, not a claim the result
 * made, so a pending call keeps it. The neutral word (`neutralStatusWord`)
 * applies only once a result has landed and still did not decode.
 */
function gatedStatusWord(
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

function buildOperation(group: OperationGroup): ZeropsOperation {
  switch (group.kind) {
    case "bootstrap":
      return buildBootstrapOperation(group);
    case "deploy":
      return buildDeployOperation(group);
    case "verify":
      return buildVerifyOperation(group);
    case "import":
      return buildImportOperation(group);
    case "mount":
      return buildMountOperation(group);
    case "subdomain":
      return buildSubdomainOperation(group);
    case "delete":
    case "scale":
    case "manage":
    case "env":
      return buildSimpleOperation(group);
    case "error":
      return buildErrorOperation(group);
  }
}

function baseFields(group: OperationGroup) {
  const first = group.entries[0]!.entry;
  return {
    key: group.key,
    anchorEntryId: group.anchorEntryId,
    createdAt: first.createdAt,
    startedAt: first.startedAt ?? first.createdAt,
    turnId: first.turnId,
    entryIds: [
      ...group.entries.map((c) => c.entry.id),
      ...group.joinedImports.map((c) => c.entry.id),
    ],
  };
}

function settledAtFor(group: OperationGroup, phase: ZeropsOperationPhase): string | undefined {
  if (phase === "running") {
    return undefined;
  }
  const latest = group.entries[group.entries.length - 1]!.entry;
  return latest.settledAt ?? latest.createdAt;
}

function voiceFor(
  intentInput: string | undefined,
  kind: ZeropsOperationKind,
  subject: string,
): { voice: string; voiceSource: "agent" | "mate" } {
  const trimmed = intentInput?.trim();
  if (trimmed !== undefined && trimmed.length > 0 && trimmed.length <= 300) {
    return { voice: trimmed, voiceSource: "agent" };
  }
  return { voice: operationVoice(kind, subject), voiceSource: "mate" };
}

function undecodedDetail(entry: ZeropsCallEntry): string | undefined {
  if (entry.truncated === true) {
    return "Result too large to show.";
  }
  return entry.resultText;
}

function buildDetail(parts: ReadonlyArray<string | undefined>): string | undefined {
  const present = parts.filter((p): p is string => p !== undefined && p.trim().length > 0);
  return present.length > 0 ? present.join("\n\n") : undefined;
}

/** `{ detail }` when any part is present, else `{}` — spread directly into the built operation. */
function detailField(
  parts: ReadonlyArray<string | undefined>,
): { detail: string } | Record<string, never> {
  const detail = buildDetail(parts);
  return detail !== undefined ? { detail } : {};
}

// --- deploy -------------------------------------------------------------------

function buildDeployOperation(group: OperationGroup): ZeropsOperation {
  const { entry, decoded } = group.entries[0]!;
  const errorInfo = errorInfoFor(entry, decoded);
  const card = decoded.card?.kind === "deploy" ? decoded.card : undefined;
  const resultStatus = card?.status;
  const phase: ZeropsOperationPhase =
    entry.status === "failed"
      ? "failed"
      : resultStatus === "BUILD_TRIGGERED"
        ? "running"
        : entry.status === "inProgress"
          ? "running"
          : "done";
  const subject =
    pickFirst(readInputString(entry.input, "targetService"), card?.target) ?? "the service";
  const { voice, voiceSource } = voiceFor(
    readInputString(entry.input, "intent"),
    "deploy",
    subject,
  );
  const settledAt = settledAtFor(group, phase);

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

  const links: ZeropsOperationLink[] = [];
  if (phase === "done" && card?.subdomainUrl !== undefined) {
    links.push({ label: urlHost(card.subdomainUrl), url: card.subdomainUrl });
  }

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("deploy", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : card !== undefined
          ? operationClosing("deploy", "done", { host: subject })
          : "Finished.";

  return {
    ...baseFields(group),
    kind: "deploy",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL.deploy} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "deploy",
      phase,
      card !== undefined,
      entry.resultText !== undefined,
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
      decoded.card === undefined ? undecodedDetail(entry) : undefined,
    ]),
    target: { hostname: subject },
    ...(resultStatus !== undefined ? { resultStatus } : {}),
    hasResult: decoded.document !== undefined,
  };
}

// --- verify -------------------------------------------------------------------

function buildVerifyOperation(group: OperationGroup): ZeropsOperation {
  const { entry, decoded } = group.entries[0]!;
  const errorInfo = errorInfoFor(entry, decoded);
  const card = decoded.card?.kind === "verify" ? decoded.card : undefined;
  const phase: ZeropsOperationPhase =
    entry.status === "failed" ? "failed" : entry.status === "inProgress" ? "running" : "done";
  // `payloads.ts` folds the all-services shape's summary prose into `hostname`
  // when there is no single service — that prose is never a subject, so the
  // only trustworthy source is whether the call itself named one service.
  const inputHostname = readInputString(entry.input, "serviceHostname");
  const isAllServices = inputHostname === undefined;
  const subject = inputHostname ?? "all services";
  const { voice, voiceSource } = voiceFor(
    readInputString(entry.input, "intent"),
    "verify",
    subject,
  );
  const settledAt = settledAtFor(group, phase);

  const steps: ZeropsOperationStep[] = (card?.checks ?? []).map((check) =>
    buildStep(
      check.name,
      // The all-services shape's "checks" are per-service verdicts, keyed by
      // hostname, not check names — humanizing a hostname would mangle it.
      isAllServices ? check.name : humanizeCheckName(check.name),
      check.status,
      check.httpStatus !== undefined ? `HTTP ${check.httpStatus}` : undefined,
    ),
  );
  const passed = steps.filter((s) => s.state === "done").length;
  const failedCount = steps.filter((s) => s.state === "failed").length;

  const checkHints = isAllServices
    ? []
    : (card?.checks ?? []).flatMap((check) =>
        check.detail !== undefined ? [`${check.name}: ${check.detail}`] : [],
      );

  const closing =
    phase === "running"
      ? undefined
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
          ? operationClosing("verify", "done", { checksPassed: passed, checksTotal: steps.length })
          : "Finished.";

  return {
    ...baseFields(group),
    kind: "verify",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL.verify} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "verify",
      phase,
      card !== undefined,
      entry.resultText !== undefined,
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      ...checkHints,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(entry) : undefined,
    ]),
    target: { hostname: subject },
    hasResult: decoded.document !== undefined,
  };
}

// --- Import (standalone) -------------------------------------------------------

interface ImportRead {
  hostnames: string[];
  steps: ZeropsOperationStep[];
  summary?: string | undefined;
  errorFirstLine?: string | undefined;
  document?: Record<string, unknown> | undefined;
}

function readImport(call: DecodedCall): ImportRead {
  const { decoded } = call;
  const card = decoded.card?.kind === "import" ? decoded.card : undefined;
  if (card === undefined) {
    return { hostnames: [], steps: [], document: decoded.document };
  }
  const byHost = new Map<string, { status: string; failReason?: string }>();
  for (const service of card.services) {
    byHost.set(service.hostname, {
      status: service.status,
      ...(service.failReason !== undefined ? { failReason: service.failReason } : {}),
    });
  }
  const hostnames = [...byHost.keys()];
  const steps = hostnames.map((hostname) => {
    const info = byHost.get(hostname)!;
    const failed = info.failReason !== undefined;
    return buildStep(hostname, hostname, failed ? "FAILED" : info.status, info.failReason);
  });
  const errorFirstLine =
    card.errors.length > 0
      ? firstLine(card.errors[0]!.message)
      : steps.find((s) => s.state === "failed")?.note !== undefined
        ? firstLine(steps.find((s) => s.state === "failed")!.note!)
        : undefined;
  return {
    hostnames,
    steps,
    ...(card.summary !== undefined ? { summary: card.summary } : {}),
    ...(errorFirstLine !== undefined ? { errorFirstLine } : {}),
    document: decoded.document,
  };
}

function buildImportOperation(group: OperationGroup): ZeropsOperation {
  const call = group.entries[0]!;
  const { entry, decoded } = call;
  const errorInfo = errorInfoFor(entry, decoded);
  const card = decoded.card?.kind === "import" ? decoded.card : undefined;
  const read = readImport(call);
  const phase: ZeropsOperationPhase =
    entry.status === "failed"
      ? "failed"
      : read.steps.some((s) => s.state === "failed")
        ? "failed"
        : entry.status === "inProgress"
          ? "running"
          : "done";
  const subject = read.hostnames.length > 0 ? read.hostnames.join(", ") : "the services";
  const target = read.hostnames[0];
  const { voice, voiceSource } = voiceFor(
    readInputString(entry.input, "intent"),
    "import",
    subject,
  );
  const settledAt = settledAtFor(group, phase);

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("import", "failed", {
            errorFirstLine:
              read.errorFirstLine ??
              (errorInfo !== undefined ? firstLine(errorInfo.message) : undefined),
          })
        : card !== undefined
          ? operationClosing("import", "done", {
              summary: read.summary,
              createdCount: read.hostnames.length,
            })
          : "Finished.";

  return {
    ...baseFields(group),
    kind: "import",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL.import} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "import",
      phase,
      card !== undefined,
      entry.resultText !== undefined,
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps: read.steps,
    links: [],
    ...detailField([
      read.document !== undefined ? readString(read.document.nextActions) : undefined,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(entry) : undefined,
    ]),
    ...(target !== undefined ? { target: { hostname: target } } : {}),
    hasResult: read.document !== undefined,
  };
}

// --- mount ----------------------------------------------------------------------

function buildMountOperation(group: OperationGroup): ZeropsOperation {
  const { entry, decoded } = group.entries[0]!;
  const errorInfo = errorInfoFor(entry, decoded);
  const card = decoded.card?.kind === "mount" ? decoded.card : undefined;
  const phase: ZeropsOperationPhase =
    entry.status === "failed" ? "failed" : entry.status === "inProgress" ? "running" : "done";
  const hostnames = card?.mounts.map((m) => m.hostname) ?? [];
  const subject = hostnames.length > 0 ? hostnames.join(", ") : "the services";
  const { voice, voiceSource } = voiceFor(readInputString(entry.input, "intent"), "mount", subject);
  const settledAt = settledAtFor(group, phase);

  const steps: ZeropsOperationStep[] = (card?.mounts ?? []).map((mount) =>
    buildStep(mount.hostname, mount.hostname, mount.mounted ? "ACTIVE" : "FAILED", mount.mountPath),
  );
  const mountedCount = (card?.mounts ?? []).filter((m) => m.mounted).length;

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("mount", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : card !== undefined
          ? operationClosing("mount", "done", { mountedCount, mountsTotal: card.mounts.length })
          : "Finished.";

  return {
    ...baseFields(group),
    kind: "mount",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL.mount} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord("mount", phase, card !== undefined, entry.resultText !== undefined),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(entry) : undefined,
    ]),
    ...(hostnames[0] !== undefined ? { target: { hostname: hostnames[0] } } : {}),
    hasResult: decoded.document !== undefined,
  };
}

// --- subdomain -------------------------------------------------------------------

function buildSubdomainOperation(group: OperationGroup): ZeropsOperation {
  const { entry, decoded } = group.entries[0]!;
  const errorInfo = errorInfoFor(entry, decoded);
  const card = decoded.card?.kind === "subdomain" ? decoded.card : undefined;
  const phase: ZeropsOperationPhase =
    entry.status === "failed" ? "failed" : entry.status === "inProgress" ? "running" : "done";
  const subject =
    pickFirst(readInputString(entry.input, "serviceHostname"), card?.hostname) ?? "the service";
  const action = pickFirst(readInputString(entry.input, "action"), card?.action) ?? "enable";
  const { voice, voiceSource } = voiceFor(
    readInputString(entry.input, "intent"),
    "subdomain",
    subject,
  );
  const settledAt = settledAtFor(group, phase);

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("subdomain", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : operationClosing("subdomain", "done", { action });

  const links: ZeropsOperationLink[] = (card?.urls ?? []).map((url) => ({
    label: urlHost(url),
    url,
  }));

  return {
    ...baseFields(group),
    kind: "subdomain",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL.subdomain} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "subdomain",
      phase,
      card !== undefined,
      entry.resultText !== undefined,
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
      decoded.card === undefined ? undecodedDetail(entry) : undefined,
    ]),
    target: { hostname: subject },
    hasResult: decoded.document !== undefined,
  };
}

// --- delete / scale / manage / env (no payloads.ts decoder) ----------------------

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

function buildSimpleOperation(group: OperationGroup): ZeropsOperation {
  const { entry, decoded } = group.entries[0]!;
  const errorInfo = errorInfoFor(entry, decoded);
  const kind = group.kind as "delete" | "scale" | "manage" | "env";
  const phase: ZeropsOperationPhase =
    entry.status === "failed" ? "failed" : entry.status === "inProgress" ? "running" : "done";
  const subject = readSimpleSubject(entry.input, decoded.document) ?? "the service";
  const { voice, voiceSource } = voiceFor(readInputString(entry.input, "intent"), kind, subject);
  const settledAt = settledAtFor(group, phase);

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
        : operationClosing(kind, "done", { message: messageFirstParagraph, summary });
  const messageUsedAsClosing = phase === "done" && rawMessage !== undefined;

  return {
    ...baseFields(group),
    kind,
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL[kind]} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      kind,
      phase,
      decoded.document !== undefined,
      entry.resultText !== undefined,
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
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.document === undefined ? undecodedDetail(entry) : undefined,
    ]),
    target: { hostname: subject },
    hasResult: decoded.document !== undefined,
  };
}

// --- error (failed generic/hidden zerops call) -----------------------------------

function buildErrorOperation(group: OperationGroup): ZeropsOperation {
  const { entry, decoded } = group.entries[0]!;
  const errorInfo = errorInfoFor(entry, decoded);
  const toolLabel = humanizeToolName(entry.toolName);
  const settledAt = settledAtFor(group, "failed");
  const code = decoded.card?.kind === "error" ? decoded.card.code : undefined;

  return {
    ...baseFields(group),
    kind: "error",
    phase: "failed",
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject: toolLabel,
    kicker: `Error · ${code ?? toolLabel}`,
    voice: `${toolLabel} failed.`,
    voiceSource: "mate",
    statusWord: operationStatusWord("error", "failed"),
    closing: operationClosing("error", "failed", {
      errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
    }),
    steps: [],
    links: [],
    ...detailField([
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(entry) : undefined,
    ]),
    hasResult: decoded.document !== undefined,
  };
}

// --- bootstrap ------------------------------------------------------------------

function readAttestation(document: Record<string, unknown>, step: string): string | undefined {
  const current = readRecord(document.current);
  const priorContext = current !== undefined ? readRecord(current.priorContext) : undefined;
  const attestations =
    priorContext !== undefined ? readRecord(priorContext.attestations) : undefined;
  return attestations !== undefined ? readString(attestations[step]) : undefined;
}

function readPlanTargets(
  document: Record<string, unknown>,
): ReadonlyArray<Record<string, unknown>> {
  const current = readRecord(document.current);
  const priorContext = current !== undefined ? readRecord(current.priorContext) : undefined;
  const plan = priorContext !== undefined ? readRecord(priorContext.plan) : undefined;
  return plan !== undefined ? readRecordArray(plan.targets) : [];
}

/**
 * The latest folded entry whose result still carries `current.priorContext.plan.targets`.
 *
 * The plan is fixed once `discover` completes, but the session's own LATEST
 * result (typically `close`, once every step is `complete`) reports no
 * `current` step at all — there is nothing left to act on — so it carries no
 * plan either. The kicker still needs the plan, so this looks past the
 * newest result to the last one that had it.
 */
function bootstrapPlanTargetsDocument(group: OperationGroup): Record<string, unknown> | undefined {
  for (let i = group.entries.length - 1; i >= 0; i--) {
    const document = group.entries[i]!.decoded.document;
    if (document !== undefined && readPlanTargets(document).length > 0) {
      return document;
    }
  }
  return undefined;
}

/**
 * The hostnames a bootstrap kicker names.
 *
 * `route=adopt` names every target — adopting is precisely taking over
 * runtimes that already exist, so "existing" is not a reason to drop one.
 * Otherwise it names only what this bootstrap actually creates: a target
 * whose own runtime is new, plus any dependency the plan resolves as
 * `CREATE` — an existing target with a new managed dependency (`add-mariadb`:
 * runtime `weatherdash` already exists, dependency `db` is `CREATE`) is named
 * by its created dependency, not by the untouched runtime it hangs off.
 */
function readPlanKickerHostnames(
  document: Record<string, unknown>,
  route: string | undefined,
): string[] {
  const targets = readPlanTargets(document);
  if (route === "adopt") {
    return targets.flatMap((target) => {
      const runtime = readRecord(target.runtime);
      const hostname = runtime !== undefined ? readString(runtime.devHostname) : undefined;
      return hostname !== undefined ? [hostname] : [];
    });
  }
  return targets.flatMap((target) => {
    const runtime = readRecord(target.runtime);
    const hostname = runtime !== undefined ? readString(runtime.devHostname) : undefined;
    const ownHostname = hostname !== undefined && runtime?.isExisting !== true ? [hostname] : [];
    const createdDependencies = readRecordArray(target.dependencies).flatMap((dependency) =>
      readString(dependency.resolution) === "CREATE" &&
      readString(dependency.hostname) !== undefined
        ? [readString(dependency.hostname)!]
        : [],
    );
    return [...ownHostname, ...createdDependencies];
  });
}

/** A bare, lowercase, hostname-shaped token — never an unrelated bolded phrase. */
const HOSTNAME_TOKEN = /^[a-z0-9]+$/;

/** The bold names in a bootstrap `message`, when the plan's own targets are absent. */
function readMessageBoldNames(message: string): string[] {
  const matches = [...message.matchAll(/\*\*([^*]+)\*\*/g)];
  return matches.flatMap((m) => {
    const token = m[1]?.split(" ")[0]?.trim();
    return token !== undefined && HOSTNAME_TOKEN.test(token) ? [token] : [];
  });
}

function joinedImportProvisionNote(group: OperationGroup): {
  note?: string;
  failed: boolean;
  errorFirstLine?: string;
} {
  if (group.joinedImports.length === 0) {
    return { failed: false };
  }
  const latest = group.joinedImports[group.joinedImports.length - 1]!;
  if (latest.entry.status === "failed") {
    const errorInfo = errorInfoFor(latest.entry, latest.decoded);
    return {
      failed: true,
      errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : "Import failed.",
    };
  }
  const read = readImport(latest);
  const note =
    read.hostnames.length === 1
      ? `${read.hostnames[0]} created`
      : `${read.hostnames.length} processes finished`;
  return { note, failed: false };
}

function buildBootstrapOperation(group: OperationGroup): ZeropsOperation {
  const anchorCall = group.entries[0]!;
  const anchor = anchorCall.entry;
  const latestCall = group.entries[group.entries.length - 1]!;
  const plan = bootstrapLatestPlan(group);
  const phase = bootstrapPhase(group);
  const settledAt = settledAtFor(group, phase);

  const route = readInputString(anchor.input, "route");
  const targetsDocument = bootstrapPlanTargetsDocument(group);
  const targets =
    targetsDocument !== undefined ? readPlanKickerHostnames(targetsDocument, route) : [];
  const targetHostnames =
    targets.length > 0
      ? targets
      : plan !== undefined && plan.card.message !== undefined
        ? readMessageBoldNames(plan.card.message)
        : [];
  const subject = targetHostnames.length > 0 ? targetHostnames.join(", ") : "the project";

  const kicker =
    route === "adopt"
      ? `Adopt · ${subject}`
      : targetHostnames.length === 1
        ? `New service · ${targetHostnames[0]}`
        : targetHostnames.length > 1
          ? `New services · ${targetHostnames.length}`
          : "New service";

  const { voice, voiceSource } = voiceFor(group.bootstrapIntent, "bootstrap", subject);

  const errorInfo = errorInfoFor(latestCall.entry, latestCall.decoded);

  const joinedImportInfo = joinedImportProvisionNote(group);

  // A pending continuation (no result yet) names the step it targets in its
  // own `input.step` — the latest known plan can't reflect that yet, so it
  // renders as running regardless of what that plan last said about it.
  const pendingStep =
    latestCall.entry.status === "inProgress"
      ? readInputString(latestCall.entry.input, "step")
      : undefined;

  const stepIndexRunning =
    plan !== undefined ? plan.card.steps.findIndex((s) => s.status === "in_progress") : -1;
  const trailingFailure =
    plan !== undefined
      ? group.entries
          .slice(group.entries.indexOf(plan.call) + 1)
          .find((c) => c.entry.status === "failed")
      : group.entries.length === 1 && anchor.status === "failed"
        ? anchorCall
        : undefined;

  const steps: ZeropsOperationStep[] =
    plan === undefined
      ? []
      : plan.card.steps.map((step, index) => {
          const label = sentenceCase(step.name);
          if (pendingStep === step.name) {
            return buildStep(step.name, label, "in_progress");
          }
          const attestation = readAttestation(plan.document, step.name);
          const importNote = step.name === "provision" ? joinedImportInfo.note : undefined;
          const note = attestation ?? importNote;
          if (trailingFailure !== undefined && index === stepIndexRunning) {
            const failureInfo = errorInfoFor(trailingFailure.entry, trailingFailure.decoded);
            return buildStep(
              step.name,
              label,
              "FAILED",
              failureInfo !== undefined ? firstLine(failureInfo.message) : undefined,
            );
          }
          if (
            step.name === "provision" &&
            joinedImportInfo.failed &&
            step.status === "in_progress"
          ) {
            return buildStep(step.name, label, "FAILED", joinedImportInfo.errorFirstLine);
          }
          return buildStep(step.name, label, step.status, note);
        });

  const messageFirstParagraph =
    plan?.card.message !== undefined ? firstParagraph(plan.card.message) : undefined;

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("bootstrap", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : operationClosing("bootstrap", "done", { messageFirstParagraph });

  return {
    ...baseFields(group),
    kind: "bootstrap",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "bootstrap",
      phase,
      plan !== undefined,
      latestCall.entry.resultText !== undefined,
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      plan !== undefined ? readString(plan.document.nextActions) : undefined,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      anchorCall.decoded.card === undefined ? undecodedDetail(anchor) : undefined,
    ]),
    ...(targetHostnames[0] !== undefined ? { target: { hostname: targetHostnames[0] } } : {}),
    hasResult: plan !== undefined,
  };
}
