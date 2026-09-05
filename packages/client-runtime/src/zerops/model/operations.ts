/**
 * `reduceZeropsOperations` — one object per thing done to the project, folded
 * from calls instead of activities. Per-call kinds key `op:<callId>`;
 * bootstrap sessions key `bootstrap:<founderCallId>` — a fixed identity
 * (§2.1 principle 1), never re-keyed once a session id decodes. See
 * `mate-session-model-2026-09-05.md` §2.3 R4-R9 and
 * `C-client-domain.md` §1.5.
 *
 * Pure and deterministic: same calls in, same operations out.
 */
import { attemptWord } from "../operations/phrases.ts";
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
import { type BuiltCardFields, decodeCall, phaseFor, readInputString } from "./builders/shared.ts";
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
};

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

// --- standalone (per-call) groups: the retry fold (R8/R9) --------------------

interface StandaloneGroup {
  readonly kind: Exclude<ZeropsOperationKind, "bootstrap">;
  readonly targetKey: string;
  readonly calls: ZeropsCall[];
}

function targetKeyFor(call: ZeropsCall): string {
  return (
    readInputString(call.input, "targetService") ??
    readInputString(call.input, "serviceHostname") ??
    readInputString(call.input, "hostname") ??
    JSON.stringify(call.input)
  );
}

/**
 * The most recent call that produced or joined ANY card — bootstrap or
 * standalone — regardless of which typed collection it landed in. R8's join
 * requires "no other card operation lies between them" (C §1.5), so the
 * retry fold must see a bootstrap card that intervened between two same-turn
 * failures of one standalone kind+target, not just the last standalone call.
 */
interface LastCardTouch {
  readonly kind: ZeropsOperationKind;
  readonly targetKey: string | undefined;
  readonly call: ZeropsCall;
}

function foldStandalone(
  call: ZeropsCall,
  kind: Exclude<ZeropsOperationKind, "bootstrap">,
  targetKey: string,
  groups: StandaloneGroup[],
  lastCard: LastCardTouch | undefined,
): void {
  const joinsRetry =
    call.status === "failed" &&
    lastCard !== undefined &&
    lastCard.kind === kind &&
    lastCard.targetKey === targetKey &&
    lastCard.call.status === "failed" &&
    lastCard.call.turnId === call.turnId;
  if (joinsRetry) {
    groups[groups.length - 1]!.calls.push(call);
    return;
  }
  groups.push({ kind, targetKey, calls: [call] });
}

const BUILDER_BY_KIND: Readonly<
  Record<
    Exclude<ZeropsOperationKind, "bootstrap" | "delete" | "scale" | "manage" | "env">,
    (call: ZeropsCall) => BuiltCardFields
  >
> = {
  deploy: buildDeployFields,
  verify: buildVerifyFields,
  import: buildImportFields,
  mount: buildMountFields,
  subdomain: buildSubdomainFields,
  devServer: buildDevServerFields,
  browser: buildBrowserFields,
  error: buildErrorFields,
};

function buildFieldsFor(
  kind: Exclude<ZeropsOperationKind, "bootstrap">,
  call: ZeropsCall,
): BuiltCardFields {
  if (kind === "delete" || kind === "scale" || kind === "manage" || kind === "env") {
    return buildSimpleFields(kind, call);
  }
  return BUILDER_BY_KIND[kind](call);
}

function buildStandaloneOperation(group: StandaloneGroup, attempts: number): ZeropsOperation {
  const founder = group.calls[0]!;
  const latest = group.calls[group.calls.length - 1]!;
  const fields = buildFieldsFor(group.kind, latest);
  const phase = fields.phaseOverride ?? phaseFor(latest.status);
  const attemptWordText = attemptWord(attempts);
  return {
    key: `op:${founder.id}`,
    kind: group.kind,
    phase,
    ...anchorOf(founder),
    ...(phase !== "running" ? { settledAt: latest.settledAt ?? latest.startedAt } : {}),
    turnId: founder.turnId,
    subject: fields.subject,
    kicker: fields.kicker,
    voice: fields.voice,
    voiceSource: fields.voiceSource,
    statusWord: fields.statusWord,
    ...(fields.closing !== undefined ? { closing: fields.closing } : {}),
    steps: fields.steps,
    links: fields.links,
    ...(fields.detail !== undefined ? { detail: fields.detail } : {}),
    callIds: group.calls.map((c) => c.id),
    attempts,
    ...(attemptWordText !== undefined ? { attemptWord: attemptWordText } : {}),
    ...(fields.target !== undefined ? { target: fields.target } : {}),
    ...(fields.resultStatus !== undefined ? { resultStatus: fields.resultStatus } : {}),
    hasResult: fields.hasResult,
    ...(fields.screenshot !== undefined ? { screenshot: fields.screenshot } : {}),
    ...(fields.browserSummary !== undefined ? { browserSummary: fields.browserSummary } : {}),
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
    ...(fields.detail !== undefined ? { detail: fields.detail } : {}),
    callIds: [...group.members.map((m) => m.call.id), ...group.joinedImports.map((m) => m.call.id)],
    attempts: group.members.length,
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
): ZeropsOperationsReduction {
  const ordered = [...calls].sort((a, b) => compareAnchors(anchorOf(a), anchorOf(b)));

  const bootstrapState: BootstrapFoldState = {
    groups: [],
    open: undefined,
    pendingIntent: undefined,
  };
  const standaloneGroups: StandaloneGroup[] = [];
  const genericCalls: ZeropsCall[] = [];

  // R9: `attempts` = 1 + earlier SETTLED calls of the same (toolName, target)
  // across the whole thread — independent of the R8 join above, which only
  // decides whether same-turn failures visually merge into one card.
  const settledAttemptsSoFar = new Map<string, number>();
  const attemptByCallId = new Map<string, number>();
  let lastCard: LastCardTouch | undefined;

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
      lastCard = { kind, targetKey: undefined, call };
      continue;
    }
    if (
      kind === "import" &&
      bootstrapState.open !== undefined &&
      importJoinsOpenGroup(call, bootstrapState.open)
    ) {
      bootstrapState.open.joinedImports.push({ call, decoded: decodeCall(call) });
      lastCard = { kind: "bootstrap", targetKey: undefined, call };
      continue;
    }

    const targetKey = targetKeyFor(call);
    const attemptKey = `${call.toolName} ${targetKey}`;
    const priorSettled = settledAttemptsSoFar.get(attemptKey) ?? 0;
    attemptByCallId.set(call.id, priorSettled + 1);
    if (call.status !== "inProgress") {
      settledAttemptsSoFar.set(attemptKey, priorSettled + 1);
    }

    foldStandalone(call, kind, targetKey, standaloneGroups, lastCard);
    lastCard = { kind, targetKey, call };
  }

  const operations = [
    ...bootstrapState.groups.map(buildBootstrapOperation),
    ...standaloneGroups.map((group) => {
      const latest = group.calls[group.calls.length - 1]!;
      return buildStandaloneOperation(group, attemptByCallId.get(latest.id) ?? group.calls.length);
    }),
  ].sort((a, b) => compareAnchors(a, b));

  return { operations, genericCalls };
}
