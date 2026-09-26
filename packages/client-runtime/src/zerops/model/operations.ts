/**
 * `reduceZeropsOperations` — one object per thing done to the project, folded
 * from calls instead of activities. Per-call kinds key `op:<callId>`;
 * bootstrap sessions key `bootstrap:<founderCallId>` — a fixed identity
 * (§2.1 principle 1), never re-keyed once a session id decodes. See
 * `mate-session-model-2026-09-05.md` §2.3 R4-R9 and
 * `C-client-domain.md` §1.5 — except R8 and R9: a same-turn retry is never
 * folded into the card it retries, it is a card of its own, so no row leaves
 * the timeline and no older card is rewritten; and no card is numbered.
 *
 * Pure and deterministic: same calls and context in, same operations out.
 */
import {
  classifyZeropsCall,
  isBootstrapRouteMenuStart,
  isBootstrapSessionCall,
  isBootstrapStartWithRoute,
} from "./classify.ts";
import { compareAnchors } from "./order.ts";
import type {
  ZeropsCall,
  ZeropsOperation,
  ZeropsOperationKind,
  ZeropsOperationPhase,
} from "./types.ts";

import {
  type BootstrapMember,
  bootstrapDecodedPlanTargetHostnames,
  bootstrapLatestPlanCard,
  bootstrapPlanIsTerminal,
  bootstrapPlanTargetsDocument,
  buildBootstrapFields,
} from "./builders/bootstrap.ts";
import { buildBrowserFields } from "./builders/browser.ts";
import { buildDeployFields } from "./builders/deploy.ts";
import { buildDevServerFields } from "./builders/devServer.ts";
import { buildErrorFields } from "./builders/errorKind.ts";
import { buildImportFields, readImport } from "./builders/importCard.ts";
import { buildMountFields } from "./builders/mount.ts";
import {
  buildDiscoverFields,
  buildEventsFields,
  buildLogsFields,
  buildProcessFields,
} from "./builders/readTools.ts";
import {
  type BuiltCardFields,
  decodeCall,
  type OperationBuildContext,
  phaseFor,
  readInputString,
} from "./builders/shared.ts";
import { buildSimpleFields } from "./builders/simple.ts";
import { buildSubdomainFields } from "./builders/subdomain.ts";
import { buildVerifyFields } from "./builders/verify.ts";

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
  zerops_dev_server: "devServer",
  zerops_browser: "browser",
  zerops_logs: "logs",
  zerops_events: "events",
  zerops_process: "process",
  zerops_discover: "discover",
};

/**
 * The read tools' kinds: a read is how the agent looked, not an outcome, so
 * its card folds with the turn's work once the turn settles.
 */
const READ_KINDS: ReadonlySet<ZeropsOperationKind> = new Set([
  "logs",
  "events",
  "process",
  "discover",
]);

export function isReadOperationKind(kind: ZeropsOperationKind): boolean {
  return READ_KINDS.has(kind);
}

/**
 * The operation kind a "card"-classified call becomes — independent of
 * success/failure, but NOT independent of tool-specific shape: a call whose
 * successful form would be hidden or generic only ever reaches this function
 * by failing, and stays kind `error` even then. Mirrors `classifyZeropsCall`'s
 * own bootstrap/mount predicates exactly, so the two never disagree.
 */
function determineKind(call: ZeropsCall): ZeropsOperationKind {
  const fixed = CARD_TOOL_KINDS[call.toolName];
  if (fixed !== undefined) {
    return fixed;
  }
  if (call.toolName === "zerops_mount") {
    return readInputString(call.input, "action") === "status" ? "error" : "mount";
  }
  if (call.toolName === "zerops_workflow" && isBootstrapSessionCall(call.input)) {
    return "bootstrap";
  }
  return "error";
}

function anchorOf(call: ZeropsCall): { anchorAt: string; anchorActivityId: string } {
  return { anchorAt: call.startedAt, anchorActivityId: call.anchorActivityId };
}

// --- standalone (per-call) operations ----------------------------------------

interface StandaloneCall {
  readonly kind: Exclude<ZeropsOperationKind, "bootstrap">;
  readonly call: ZeropsCall;
}

const BUILDER_BY_KIND: Readonly<
  Record<
    Exclude<ZeropsOperationKind, "bootstrap" | "delete" | "scale" | "manage" | "env">,
    (call: ZeropsCall, context: OperationBuildContext) => BuiltCardFields
  >
> = {
  deploy: buildDeployFields,
  verify: buildVerifyFields,
  import: buildImportFields,
  mount: buildMountFields,
  subdomain: buildSubdomainFields,
  devServer: buildDevServerFields,
  browser: buildBrowserFields,
  logs: buildLogsFields,
  events: buildEventsFields,
  process: buildProcessFields,
  discover: buildDiscoverFields,
  error: buildErrorFields,
};

function buildFieldsFor(
  kind: Exclude<ZeropsOperationKind, "bootstrap">,
  call: ZeropsCall,
  context: OperationBuildContext,
): BuiltCardFields {
  if (kind === "delete" || kind === "scale" || kind === "manage" || kind === "env") {
    return buildSimpleFields(kind, call);
  }
  return BUILDER_BY_KIND[kind](call, context);
}

function buildStandaloneOperation(
  { kind, call }: StandaloneCall,
  context: OperationBuildContext,
): ZeropsOperation {
  const fields = buildFieldsFor(kind, call, context);
  const phase = fields.phaseOverride ?? phaseFor(call.status);
  return {
    key: `op:${call.id}`,
    kind,
    phase,
    ...anchorOf(call),
    ...(phase !== "running" ? { settledAt: call.settledAt ?? call.startedAt } : {}),
    turnId: call.turnId,
    subject: fields.subject,
    kicker: fields.kicker,
    voice: fields.voice,
    voiceSource: fields.voiceSource,
    statusWord: fields.statusWord,
    ...(fields.closing !== undefined ? { closing: fields.closing } : {}),
    steps: fields.steps,
    links: fields.links,
    callIds: [call.id],
    ...(fields.target !== undefined ? { target: fields.target } : {}),
    ...(fields.batch !== undefined ? { batch: fields.batch } : {}),
    ...(fields.resultStatus !== undefined ? { resultStatus: fields.resultStatus } : {}),
    hasResult: fields.hasResult,
    ...(fields.version !== undefined ? { version: fields.version } : {}),
    ...(fields.processIds !== undefined ? { processIds: fields.processIds } : {}),
    ...(fields.explanation !== undefined ? { explanation: fields.explanation } : {}),
    ...(fields.screenshot !== undefined ? { screenshot: fields.screenshot } : {}),
    ...(fields.browserSummary !== undefined ? { browserSummary: fields.browserSummary } : {}),
    ...(fields.viewport !== undefined ? { viewport: fields.viewport } : {}),
    ...(fields.readResult !== undefined ? { readResult: fields.readResult } : {}),
  };
}

// --- bootstrap sessions: R5-R7 ------------------------------------------------

interface BootstrapGroup {
  readonly founderCallId: string;
  readonly members: BootstrapMember[];
  readonly joinedImports: BootstrapMember[];
  readonly sessionIds: Set<string>;
  intent?: string;
  closedPhase?: "reset";
}

function bootstrapGroupPhase(group: BootstrapGroup): ZeropsOperationPhase {
  if (group.closedPhase !== undefined) {
    return group.closedPhase;
  }
  // Once ANY member has decoded a plan, the SESSION's own phase is read off
  // that plan (done once its terminal step landed, running otherwise) — a
  // step failing (a failed continuation, a refused re-`start`) is a failed
  // STEP inside a still-open session, never a failed session.
  if (bootstrapLatestPlanCard(group.members) !== undefined) {
    return bootstrapPlanIsTerminal(group.members) ? "done" : "running";
  }
  const latest = group.members[group.members.length - 1]!;
  return phaseFor(latest.call.status);
}

function importJoinsOpenGroup(call: ZeropsCall, group: BootstrapGroup): boolean {
  const decoded = decodeCall(call);
  const importedHostnames = readImport(decoded).hostnames;
  const targetsDocument = bootstrapPlanTargetsDocument(group.members);
  if (targetsDocument === undefined) {
    return true;
  }
  const targets = new Set(bootstrapDecodedPlanTargetHostnames(targetsDocument));
  if (targets.size === 0) {
    return true;
  }
  if (importedHostnames.length === 0) {
    return true;
  }
  return importedHostnames.every((hostname) => targets.has(hostname));
}

interface BootstrapFoldState {
  readonly groups: BootstrapGroup[];
  open: BootstrapGroup | undefined;
  pendingIntent: string | undefined;
}

function foldBootstrap(call: ZeropsCall, state: BootstrapFoldState): void {
  const decoded = decodeCall(call);
  const sessionId = decoded.card?.kind === "plan" ? decoded.card.sessionId : undefined;
  const member: BootstrapMember = { call, decoded };

  if (isBootstrapStartWithRoute(call.input)) {
    if (sessionId !== undefined) {
      const existing = state.groups.find((g) => g.sessionIds.has(sessionId));
      if (existing !== undefined) {
        existing.members.push(member);
        closeIfTerminal(existing, state);
        return;
      }
    }
    const isWorkflowActive =
      call.status === "failed" &&
      decoded.card?.kind === "error" &&
      decoded.card.code === "WORKFLOW_ACTIVE";
    if (isWorkflowActive && state.open !== undefined) {
      state.open.members.push(member);
      return;
    }
    // a genuine new founder supersedes whatever session is currently open.
    if (state.open !== undefined) {
      state.open.closedPhase = "reset";
      state.open = undefined;
    }
    const intent = readInputString(call.input, "intent") ?? state.pendingIntent;
    const group: BootstrapGroup = {
      founderCallId: call.id,
      members: [member],
      joinedImports: [],
      sessionIds: sessionId !== undefined ? new Set([sessionId]) : new Set(),
      ...(intent !== undefined ? { intent } : {}),
    };
    state.groups.push(group);
    state.open = group;
    return;
  }

  // a continuation (complete / skip / resume / reset, or another bootstrap-shaped call)
  let target =
    sessionId !== undefined ? state.groups.find((g) => g.sessionIds.has(sessionId)) : undefined;
  if (
    target === undefined &&
    state.open !== undefined &&
    (sessionId === undefined || state.open.sessionIds.size === 0)
  ) {
    target = state.open;
  }
  if (target === undefined) {
    target = {
      founderCallId: call.id,
      members: [],
      joinedImports: [],
      sessionIds: sessionId !== undefined ? new Set([sessionId]) : new Set(),
    };
    state.groups.push(target);
    state.open = target;
  }
  if (sessionId !== undefined) {
    target.sessionIds.add(sessionId);
  }
  target.members.push(member);

  if (readInputString(call.input, "action") === "reset") {
    target.closedPhase = "reset";
    if (state.open === target) {
      state.open = undefined;
    }
    return;
  }
  closeIfTerminal(target, state);
}

function closeIfTerminal(group: BootstrapGroup, state: BootstrapFoldState): void {
  if (state.open === group && bootstrapPlanIsTerminal(group.members)) {
    state.open = undefined;
  }
}

function buildBootstrapOperation(group: BootstrapGroup): ZeropsOperation {
  const founder = group.members[0]!;
  const phase = bootstrapGroupPhase(group);
  const fields = buildBootstrapFields(group.members, phase, group.joinedImports, group.intent);
  const plan = bootstrapLatestPlanCard(group.members);
  const latest = group.members[group.members.length - 1]!;
  return {
    key: `bootstrap:${group.founderCallId}`,
    kind: "bootstrap",
    phase,
    ...anchorOf(founder.call),
    ...(phase !== "running" ? { settledAt: latest.call.settledAt ?? latest.call.startedAt } : {}),
    turnId: founder.call.turnId,
    subject: fields.subject,
    kicker: fields.kicker,
    voice: fields.voice,
    voiceSource: fields.voiceSource,
    statusWord: fields.statusWord,
    ...(fields.closing !== undefined ? { closing: fields.closing } : {}),
    steps: fields.steps,
    links: fields.links,
    callIds: [...group.members.map((m) => m.call.id), ...group.joinedImports.map((m) => m.call.id)],
    ...(fields.target !== undefined ? { target: fields.target } : {}),
    hasResult: fields.hasResult,
    session: {
      sessionIds: [...group.sessionIds],
      ...(group.intent !== undefined ? { intent: group.intent } : {}),
      completed: plan?.completed ?? 0,
      total: plan?.total ?? 0,
    },
  };
}

// --- the fold ------------------------------------------------------------------

export interface ZeropsOperationsReduction {
  readonly operations: ReadonlyArray<ZeropsOperation>;
  readonly genericCalls: ReadonlyArray<ZeropsCall>;
}

/** `reduceZeropsOperations` in anchor order — one object per thing done to the project. */
export function reduceZeropsOperations(
  calls: ReadonlyArray<ZeropsCall>,
  context: OperationBuildContext,
): ZeropsOperationsReduction {
  const ordered = [...calls].sort((a, b) => compareAnchors(anchorOf(a), anchorOf(b)));

  const bootstrapState: BootstrapFoldState = {
    groups: [],
    open: undefined,
    pendingIntent: undefined,
  };
  const standaloneCalls: StandaloneCall[] = [];
  const genericCalls: ZeropsCall[] = [];

  // Every call is a card of its own: a retry never merges into an earlier
  // card, which would remove a row mid-turn and rewrite what an older card
  // already showed.
  for (const call of ordered) {
    if (call.agentInternal) {
      continue;
    }
    const visibility = classifyZeropsCall(call.toolName, call.input, call.status);

    if (visibility === "hidden" || visibility === "pending-unclassifiable") {
      if (isBootstrapRouteMenuStart(call.input)) {
        const intent = readInputString(call.input, "intent");
        if (intent !== undefined) {
          bootstrapState.pendingIntent = intent;
        }
      }
      continue;
    }
    if (visibility === "generic") {
      genericCalls.push(call);
      continue;
    }

    const kind = determineKind(call);
    if (kind === "bootstrap") {
      foldBootstrap(call, bootstrapState);
      bootstrapState.pendingIntent = undefined;
      continue;
    }
    if (
      kind === "import" &&
      bootstrapState.open !== undefined &&
      importJoinsOpenGroup(call, bootstrapState.open)
    ) {
      bootstrapState.open.joinedImports.push({ call, decoded: decodeCall(call) });
      continue;
    }

    standaloneCalls.push({ kind, call });
  }

  const operations = [
    ...bootstrapState.groups.map(buildBootstrapOperation),
    ...standaloneCalls.map((standalone) => buildStandaloneOperation(standalone, context)),
  ].sort((a, b) => compareAnchors(a, b));

  return { operations, genericCalls };
}
