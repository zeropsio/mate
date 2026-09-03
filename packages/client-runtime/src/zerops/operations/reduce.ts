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
import { classifyZeropsCall } from "./classify.ts";
import {
  humanizeCheckName,
  humanizeToolName,
  operationClosing,
  operationStatusWord,
  operationVoice,
  statusWord,
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

function isBootstrapStartWithRoute(input: Record<string, unknown> | undefined): boolean {
  return (
    readInputString(input, "action") === "start" &&
    readInputString(input, "workflow") === "bootstrap" &&
    readInputString(input, "route") !== undefined
  );
}

function isBootstrapRouteMenuStart(input: Record<string, unknown> | undefined): boolean {
  return (
    readInputString(input, "action") === "start" &&
    readInputString(input, "workflow") === "bootstrap" &&
    readInputString(input, "route") === undefined
  );
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

/** The operation kind a "card"-classified call becomes — independent of success/failure. */
function determineKind(entry: ZeropsCallEntry): ZeropsOperationKind {
  const fixed = CARD_TOOL_KINDS[entry.toolName];
  if (fixed !== undefined) {
    return fixed;
  }
  if (entry.toolName === "zerops_mount") {
    return "mount";
  }
  if (entry.toolName === "zerops_workflow") {
    return "bootstrap";
  }
  // A generic/hidden-shaped zerops_* call only reaches "card" classification
  // by failing (classifyZeropsCall's zerops_*-wide failed override).
  return "error";
}

// --- fold: entries -> operation groups ---------------------------------------

interface OperationGroup {
  key: string;
  kind: ZeropsOperationKind;
  anchorEntryId: string;
  /** The bootstrap / card-tool call entries folded into this operation, in fold order. */
  entries: ZeropsCallEntry[];
  /** `zerops_import` calls absorbed into an open bootstrap's `provision` step. */
  joinedImports: ZeropsCallEntry[];
  /** The bootstrap founder's own `intent`, or the route-menu reply's — set once, never overwritten. */
  bootstrapIntent?: string;
}

function bootstrapLatestPlan(
  group: OperationGroup,
):
  | {
      entry: ZeropsCallEntry;
      document: Record<string, unknown>;
      card: Extract<ZeropsCardPayload, { kind: "plan" }>;
    }
  | undefined {
  for (let i = group.entries.length - 1; i >= 0; i--) {
    const entry = group.entries[i]!;
    const decoded = decodeEntry(entry);
    if (decoded.card?.kind === "plan" && decoded.document !== undefined) {
      return { entry, document: decoded.document, card: decoded.card };
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
  return phaseFromStatus(latest.status);
}

function findSingleOpenBootstrap(
  groups: ReadonlyArray<OperationGroup>,
): OperationGroup | undefined {
  const open = groups.filter((g) => g.kind === "bootstrap" && bootstrapPhase(g) === "running");
  return open.length === 1 ? open[0] : undefined;
}

function foldBootstrap(
  entry: ZeropsCallEntry,
  groups: OperationGroup[],
  groupByKey: Map<string, OperationGroup>,
  pendingIntent: string | undefined,
): void {
  const decoded = decodeEntry(entry);
  const sessionId = decoded.card?.kind === "plan" ? decoded.card.sessionId : undefined;

  if (isBootstrapStartWithRoute(entry.input)) {
    const key = sessionId !== undefined ? `bootstrap:${sessionId}` : `call:${entry.id}`;
    const intent = readInputString(entry.input, "intent") ?? pendingIntent;
    const group: OperationGroup = {
      key,
      kind: "bootstrap",
      anchorEntryId: entry.id,
      entries: [entry],
      joinedImports: [],
      ...(intent !== undefined ? { bootstrapIntent: intent } : {}),
    };
    groups.push(group);
    groupByKey.set(key, group);
    return;
  }

  let target = sessionId !== undefined ? groupByKey.get(`bootstrap:${sessionId}`) : undefined;
  if (target === undefined) {
    target = findSingleOpenBootstrap(groups);
  }
  if (target === undefined) {
    const key = `call:${entry.id}`;
    const group: OperationGroup = {
      key,
      kind: "bootstrap",
      anchorEntryId: entry.id,
      entries: [entry],
      joinedImports: [],
    };
    groups.push(group);
    groupByKey.set(key, group);
    return;
  }

  target.entries.push(entry);
  if (sessionId !== undefined && target.key !== `bootstrap:${sessionId}`) {
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
        openBootstrap.joinedImports.push(entry);
        continue;
      }
    }

    consumedEntryIds.add(entry.id);
    const key = `call:${entry.id}`;
    const group: OperationGroup = {
      key,
      kind,
      anchorEntryId: entry.id,
      entries: [entry],
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
  const first = group.entries[0]!;
  return {
    key: group.key,
    anchorEntryId: group.anchorEntryId,
    createdAt: first.createdAt,
    startedAt: first.startedAt ?? first.createdAt,
    turnId: first.turnId,
    entryIds: [...group.entries.map((e) => e.id), ...group.joinedImports.map((e) => e.id)],
  };
}

function settledAtFor(group: OperationGroup, phase: ZeropsOperationPhase): string | undefined {
  if (phase === "running") {
    return undefined;
  }
  const latest = group.entries[group.entries.length - 1]!;
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
  const entry = group.entries[0]!;
  const decoded = decodeEntry(entry);
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

  const steps: ZeropsOperationStep[] = [];
  if (card !== undefined) {
    if (card.buildStatus !== undefined) {
      const failed = card.failedPhase === "build" && phase === "failed";
      steps.push(buildStep("build", "Build", failed ? "FAILED" : card.buildStatus));
    }
    const deployFailed =
      phase === "failed" && (card.failedPhase === undefined || card.failedPhase !== "build");
    steps.push(buildStep("deploy", "Deploy", deployFailed ? "FAILED" : card.status));
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
            failureCause: card?.failureCause,
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : operationClosing("deploy", "done", { host: subject });

  return {
    ...baseFields(group),
    kind: "deploy",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL.deploy} · ${subject}`,
    voice,
    voiceSource,
    statusWord: operationStatusWord("deploy", phase, { resultStatus }),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links,
    ...detailField([
      decoded.document !== undefined ? readString(decoded.document.nextActions) : undefined,
      decoded.document !== undefined ? readString(decoded.document.verification) : undefined,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.document === undefined ? undecodedDetail(entry) : undefined,
    ]),
    target: { hostname: subject },
    ...(resultStatus !== undefined ? { resultStatus } : {}),
    hasResult: decoded.document !== undefined,
  };
}

// --- verify -------------------------------------------------------------------

function buildVerifyOperation(group: OperationGroup): ZeropsOperation {
  const entry = group.entries[0]!;
  const decoded = decodeEntry(entry);
  const errorInfo = errorInfoFor(entry, decoded);
  const card = decoded.card?.kind === "verify" ? decoded.card : undefined;
  const phase: ZeropsOperationPhase =
    entry.status === "failed" ? "failed" : entry.status === "inProgress" ? "running" : "done";
  const subject =
    pickFirst(readInputString(entry.input, "serviceHostname"), card?.hostname) ?? "the service";
  const { voice, voiceSource } = voiceFor(
    readInputString(entry.input, "intent"),
    "verify",
    subject,
  );
  const settledAt = settledAtFor(group, phase);

  const steps: ZeropsOperationStep[] = (card?.checks ?? []).map((check) =>
    buildStep(
      check.name,
      humanizeCheckName(check.name),
      check.status,
      check.httpStatus !== undefined ? `HTTP ${check.httpStatus}` : undefined,
    ),
  );
  const passed = steps.filter((s) => s.state === "done").length;
  const failedCount = steps.filter((s) => s.state === "failed").length;

  const checkHints = (card?.checks ?? []).flatMap((check) =>
    check.detail !== undefined ? [`${check.name}: ${check.detail}`] : [],
  );

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("verify", "failed", {
            checksFailed: failedCount,
            checksTotal: steps.length,
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : operationClosing("verify", "done", { checksPassed: passed, checksTotal: steps.length });

  return {
    ...baseFields(group),
    kind: "verify",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL.verify} · ${subject}`,
    voice,
    voiceSource,
    statusWord: operationStatusWord("verify", phase),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      ...checkHints,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.document === undefined ? undecodedDetail(entry) : undefined,
    ]),
    target: { hostname: subject },
    hasResult: decoded.document !== undefined,
  };
}

// --- import (standalone) -------------------------------------------------------

interface ImportRead {
  hostnames: string[];
  steps: ZeropsOperationStep[];
  summary?: string | undefined;
  errorFirstLine?: string | undefined;
  document?: Record<string, unknown> | undefined;
}

function readImport(entry: ZeropsCallEntry): ImportRead {
  const decoded = decodeEntry(entry);
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
  const entry = group.entries[0]!;
  const decoded = decodeEntry(entry);
  const errorInfo = errorInfoFor(entry, decoded);
  const read = readImport(entry);
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
        : operationClosing("import", "done", {
            summary: read.summary,
            createdCount: read.hostnames.length,
          });

  return {
    ...baseFields(group),
    kind: "import",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL.import} · ${subject}`,
    voice,
    voiceSource,
    statusWord: operationStatusWord("import", phase),
    ...(closing !== undefined ? { closing } : {}),
    steps: read.steps,
    links: [],
    ...detailField([
      read.document !== undefined ? readString(read.document.nextActions) : undefined,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      read.document === undefined ? undecodedDetail(entry) : undefined,
    ]),
    ...(target !== undefined ? { target: { hostname: target } } : {}),
    hasResult: read.document !== undefined,
  };
}

// --- mount ----------------------------------------------------------------------

function buildMountOperation(group: OperationGroup): ZeropsOperation {
  const entry = group.entries[0]!;
  const decoded = decodeEntry(entry);
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
        : operationClosing("mount", "done", {
            mountedCount,
            mountsTotal: card?.mounts.length ?? 0,
          });

  return {
    ...baseFields(group),
    kind: "mount",
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL.mount} · ${subject}`,
    voice,
    voiceSource,
    statusWord: operationStatusWord("mount", phase),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.document === undefined ? undecodedDetail(entry) : undefined,
    ]),
    ...(hostnames[0] !== undefined ? { target: { hostname: hostnames[0] } } : {}),
    hasResult: decoded.document !== undefined,
  };
}

// --- subdomain -------------------------------------------------------------------

function buildSubdomainOperation(group: OperationGroup): ZeropsOperation {
  const entry = group.entries[0]!;
  const decoded = decodeEntry(entry);
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
    statusWord: operationStatusWord("subdomain", phase, { action }),
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
      decoded.document === undefined ? undecodedDetail(entry) : undefined,
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
  const entry = group.entries[0]!;
  const decoded = decodeEntry(entry);
  const errorInfo = errorInfoFor(entry, decoded);
  const kind = group.kind as "delete" | "scale" | "manage" | "env";
  const phase: ZeropsOperationPhase =
    entry.status === "failed" ? "failed" : entry.status === "inProgress" ? "running" : "done";
  const subject = readSimpleSubject(entry.input, decoded.document) ?? "the service";
  const { voice, voiceSource } = voiceFor(readInputString(entry.input, "intent"), kind, subject);
  const settledAt = settledAtFor(group, phase);

  const message = decoded.document !== undefined ? readString(decoded.document.message) : undefined;
  const summary = decoded.document !== undefined ? readString(decoded.document.summary) : undefined;

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing(kind, "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : operationClosing(kind, "done", { message, summary });
  const messageUsedAsClosing = phase === "done" && message !== undefined && closing === message;

  return {
    ...baseFields(group),
    kind,
    phase,
    ...(settledAt !== undefined ? { settledAt } : {}),
    subject,
    kicker: `${KIND_LABEL[kind]} · ${subject}`,
    voice,
    voiceSource,
    statusWord: operationStatusWord(kind, phase),
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
      !messageUsedAsClosing ? message : undefined,
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
  const entry = group.entries[0]!;
  const decoded = decodeEntry(entry);
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
    kicker: `Error · ${code ?? entry.toolName}`,
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
      decoded.document === undefined ? undecodedDetail(entry) : undefined,
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
    const document = decodeEntry(group.entries[i]!).document;
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

/** The bold names in a bootstrap `message`, when the plan's own targets are absent. */
function readMessageBoldNames(message: string): string[] {
  const matches = [...message.matchAll(/\*\*([^*]+)\*\*/g)];
  return matches.flatMap((m) => (m[1] !== undefined ? [m[1].split(" ")[0]!.trim()] : []));
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
  if (latest.status === "failed") {
    const decoded = decodeEntry(latest);
    const errorInfo = errorInfoFor(latest, decoded);
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
  const anchor = group.entries[0]!;
  const latestEntry = group.entries[group.entries.length - 1]!;
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

  const decodedAnchor = decodeEntry(anchor);
  const errorInfo = errorInfoFor(latestEntry, decodeEntry(latestEntry));

  const joinedImportInfo = joinedImportProvisionNote(group);

  const stepIndexRunning =
    plan !== undefined ? plan.card.steps.findIndex((s) => s.status === "in_progress") : -1;
  const trailingFailure =
    plan !== undefined
      ? group.entries
          .slice(group.entries.indexOf(plan.entry) + 1)
          .find((e) => e.status === "failed")
      : group.entries.length === 1 && anchor.status === "failed"
        ? anchor
        : undefined;

  const steps: ZeropsOperationStep[] =
    plan === undefined
      ? []
      : plan.card.steps.map((step, index) => {
          const attestation = readAttestation(plan.document, step.name);
          const importNote = step.name === "provision" ? joinedImportInfo.note : undefined;
          const note = attestation ?? importNote;
          if (trailingFailure !== undefined && index === stepIndexRunning) {
            const decodedFailure = decodeEntry(trailingFailure);
            const failureInfo = errorInfoFor(trailingFailure, decodedFailure);
            return buildStep(
              step.name,
              step.name[0]!.toUpperCase() + step.name.slice(1),
              "FAILED",
              failureInfo !== undefined ? firstLine(failureInfo.message) : undefined,
            );
          }
          if (
            step.name === "provision" &&
            joinedImportInfo.failed &&
            step.status === "in_progress"
          ) {
            return buildStep(
              step.name,
              step.name[0]!.toUpperCase() + step.name.slice(1),
              "FAILED",
              joinedImportInfo.errorFirstLine,
            );
          }
          return buildStep(
            step.name,
            step.name[0]!.toUpperCase() + step.name.slice(1),
            step.status,
            note,
          );
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
    statusWord: operationStatusWord("bootstrap", phase),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      plan !== undefined ? readString(plan.document.nextActions) : undefined,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decodedAnchor.document === undefined ? undecodedDetail(anchor) : undefined,
    ]),
    ...(targetHostnames[0] !== undefined ? { target: { hostname: targetHostnames[0] } } : {}),
    hasResult: plan !== undefined,
  };
}
