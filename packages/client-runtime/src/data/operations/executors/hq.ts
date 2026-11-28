import type { HqDeliveryAnswer } from "@t3tools/shared/hqDeploys";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { hqNavigation, hqEnvironmentOffers } from "../../projections/hqNavigation.ts";
import { hqAwayAnswer, hqLinkOf } from "../../projections/hqLink.ts";
import { readsOfState, type AccountStore } from "../../store.ts";
import { sameValue } from "../../projections/equal.ts";
import {
  HQ_GIT_OPERATION_VERBS,
  isHqGitTargetIntent,
  needsGitCandidate,
  type HqGitTargetIntent,
  type HqGitCandidateIntent,
} from "../hqGitTargets.ts";
import type { Operations } from "../coordinator.ts";
/**
 * HQ as the owner of the operations it executes: each kind's write through the organization's
 * official HQ, its answer the receipt. A write whose answer was lost — HQ's client could not read
 * back whether it was made — may have been made: uncertain, never sent again blindly. A refusal
 * keeps what HQ said; HQ unreachable took nothing.
 *
 * A creation's writes (`hqWrites.ts`) HQ answers at once, and keeps no request id for: a lost
 * answer is resolved by the kind's effect handles in HQ's navigation. A conflict says a record is
 * there already — perhaps this very write's — so it is read there as a lost answer is.
 *
 * @module data/operations/executors/hq
 */
import * as Effect from "effect/Effect";

import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import {
  chatLinkRefusalWords,
  HQ_NOT_OPEN,
  mergersRefusalWords,
  outsideProductionRefusalWords,
} from "../../../zerops/hq/refusals.ts";
import { discussionId } from "../../families/hqDiscussion.ts";
import { observeCredentialId, observeRequestScope } from "../../families/hqObserveCredential.ts";
import { commitOwn } from "../../adapters/hqSettingsReads.ts";
import type { OperationIntent, OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationExecutor, SubmissionFault, UncertainAcceptance } from "../coordinator.ts";
import { REVEAL_UNRECORDABLE, PROPOSAL_DECIDED_ELSEWHERE, type HqChiefIntent } from "../hqChief.ts";
import type { HqWriteIntent } from "../hqWrites.ts";

import {
  changeHandle,
  environmentHandle,
  FLOW_WRITE_KINDS,
  type FlowWriteIntent,
} from "../flowWrites.ts";

/** The flow's writes HQ executes, as its client sends them. */
type FlowWrites = Pick<
  HqApi,
  | "rollback"
  | "redeploy"
  | "addService"
  | "mergeChange"
  | "stopAdding"
  | "closeChange"
  | "handChange"
  | "askMerge"
  | "takeBackMergeAsk"
> & {
  readonly release: (
    ...input: Parameters<HqApi["release"]>
  ) => Promise<Awaited<ReturnType<HqApi["release"]>> & { readonly delivery?: HqDeliveryAnswer }>;
};

/** The writes HQ executes, as its client sends them. */
export type HqWrites = Pick<
  HqApi,
  | "commentOnChange"
  | "answerKeptGit"
  | "createBirth"
  | "continueOperation"
  | "endOperation"
  | "startMateDeletion"
  | "startMateRestart"
  | "startMatePower"
  | "startMateRename"
  | "startProductionRemoval"
  | "startAppDeletion"
  | "startEnvironment"
  | "startDeployKey"
  | "startPutLive"
  | "startProjectMove"
  | "startAppRename"
  | "deleteBirth"
  | "acknowledgeBirthDeletion"
  | "establishZcpAuthorization"
  | "takeChatLink"
  | "askReadAccess"
  | "closeReadAccess"
  | "startAccessChanges"
  | "deleteAccessChange"
  | "handOver"
  | "setChief"
  | "decideProposal"
  | "approveProposal"
  | "setMergers"
  | "setOutsideProduction"
  | "recordReveal"
  | "repoRemoteViaApp"
  | "repoRemoteCreateViaApp"
  | "followRepoUpstream"
  | "unfollowRepoUpstream"
  | "deleteRepo"
  | "setRepoCap"
  | "gitTargetWrite"
  | "gitTargetReceipt"
  | "updateMate"
  | "setAutoUpdatePolicy"
  | "savePersonaTemplate"
  | "deletePersonaTemplate"
> &
  FlowWrites;

interface HqExecutor extends OperationExecutor {
  readonly submitGitCandidate: (
    operations: Operations,
    requestId: string,
    intent: HqGitCandidateIntent,
    token: string,
  ) => Effect.Effect<string>;
  readonly cancelGitCandidate: (requestId: string) => void;
  readonly hasGitCandidate: (requestId: string) => boolean;
  /** Takes a chat account link: its one-time code goes beside the intent, never into it. */
  readonly submitChatLink: (
    operations: Operations,
    requestId: string,
    intent: Extract<OperationIntent, { readonly kind: "take-chat-link" }>,
    code: string,
  ) => Effect.Effect<string>;
}

type Write = <A>(call: () => Promise<A>) => Effect.Effect<A, StreamFault | UncertainAcceptance>;

const receipt = (
  requestId: string,
  handle: string,
  result: OperationResult | undefined,
  outcome: OperationReceipt["outcome"],
): OperationReceipt => ({
  requestId,
  operationId: handle,
  executor: "hq",
  affected: [],
  handles: [handle],
  acceptance: { kind: "accepted", ...(result === undefined ? {} : { result }) },
  outcome,
});
const PENDING: OperationReceipt["outcome"] = { kind: "pending" };

function flowWrite(
  requestId: string,
  api: FlowWrites,
  intent: FlowWriteIntent,
  write: Write,
): Effect.Effect<OperationReceipt, StreamFault | UncertainAcceptance> {
  switch (intent.kind) {
    case "release":
      return Effect.map(
        write(() =>
          api.release(intent.appId, {
            tag: intent.tag,
            groupHead: intent.groupHead,
            entries: intent.entries,
            ...(intent.planHash === undefined ? {} : { planHash: intent.planHash }),
            ...(intent.productionShape === undefined
              ? {}
              : { productionShape: intent.productionShape }),
            ...(intent.releaseTarget === undefined
              ? {}
              : { target: "zerops", releaseTarget: intent.releaseTarget }),
            ...(intent.git === undefined ? {} : { target: "git", ...intent.git }),
          }),
        ),
        ({ made, deploys, delivery }) =>
          receipt(
            requestId,
            made.tag,
            { tag: made.tag, deploys, ...(delivery === undefined ? {} : { delivery }) },
            PENDING,
          ),
      );
    case "roll-back":
      return Effect.map(
        write(() => api.rollback(intent.appId, intent.tag, { groupHead: intent.groupHead })),
        ({ made, deploys }) => receipt(requestId, made.tag, { tag: made.tag, deploys }, PENDING),
      );
    case "redeploy":
      return Effect.map(
        write(() =>
          api.redeploy(intent.appId, intent.environment, {
            service: intent.service,
            sha: intent.sha,
          }),
        ),
        (deploys) => receipt(requestId, environmentHandle(intent), { deploys }, PENDING),
      );
    case "add-service":
      return Effect.map(
        write(() => api.addService(intent.appId, intent.environment, intent.service)),
        (deploys) =>
          receipt(
            requestId,
            environmentHandle(intent),
            { deploys },
            { kind: "succeeded", evidence: "HQ answered the write." },
          ),
      );
    case "merge-change":
      return Effect.map(
        write(() => api.mergeChange(intent.link, intent.expectedHead)),
        ({ made, deploys }) =>
          receipt(
            requestId,
            changeHandle(intent.link),
            { deploys, mergedSha: made.mergedSha, state: made.state },
            PENDING,
          ),
      );
    case "stop-adding":
      return Effect.map(
        write(() => api.stopAdding(intent.link)),
        () => receipt(requestId, changeHandle(intent.link), undefined, PENDING),
      );
    case "close-change":
      return Effect.map(
        write(() => api.closeChange(intent.link, intent.expectedHead)),
        () => receipt(requestId, changeHandle(intent.link), undefined, PENDING),
      );
    case "hand-change":
      return Effect.map(
        write(() => api.handChange(intent.link, intent.mateProjectId)),
        () => receipt(requestId, changeHandle(intent.link), undefined, PENDING),
      );
    case "ask-merge":
    case "take-back-merge-ask": {
      const call = intent.kind === "ask-merge" ? api.askMerge : api.takeBackMergeAsk;
      return Effect.map(
        Effect.tryPromise({ try: () => call(intent.link), catch: (cause) => faultOf(cause, true) }),
        (change) =>
          receipt(
            requestId,
            changeHandle(intent.link),
            { mergeAsk: change.mergeAsk ?? null },
            { kind: "succeeded", evidence: "HQ answered the write." },
          ),
      );
    }
  }
}

const FLOW_KINDS: ReadonlySet<string> = new Set(FLOW_WRITE_KINDS.map(({ kind }) => kind));

function faultOf(cause: unknown, keepCode = false): StreamFault | UncertainAcceptance {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (!(cause instanceof HqError) || cause.kind === "uncertain")
    return { outcome: "uncertain-acceptance", message };
  if (cause.kind === "refused")
    return {
      outcome: "definitive-refusal",
      message,
      ...(cause.problems === undefined ? {} : { problems: cause.problems }),
      ...(keepCode ? { code: cause.reason ?? cause.code } : {}),
    };
  return { outcome: "transient", message };
}

/** HQ's answer to who merges as a fault: its refusal in plain words. */
function mergersFault(cause: unknown): StreamFault | UncertainAcceptance {
  const fault = faultOf(cause, true);
  const words =
    cause instanceof HqError && cause.kind === "refused" ? mergersRefusalWords(cause) : undefined;
  return words === undefined ? fault : { ...fault, message: words };
}

/** HQ's answer to the statement as a fault: its refusal in plain words. */
function outsideProductionFault(cause: unknown): StreamFault | UncertainAcceptance {
  const fault = faultOf(cause, true);
  if (!(cause instanceof HqError) || cause.kind !== "refused") return fault;
  const said = outsideProductionRefusalWords(cause);
  return said === undefined ? fault : { ...fault, message: said };
}

/** A take whose code this executor no longer holds: the account changed, or it was sent once already. */
const CHAT_LINK_CODE_GONE = "Open the link Mate sent you again.";

/** HQ's refusal of a chat account link in its own words, where the route has them. */
function chatLinkFault(cause: unknown): StreamFault | UncertainAcceptance {
  const fault = faultOf(cause);
  if (!(cause instanceof HqError) || cause.kind !== "refused") return fault;
  const said = chatLinkRefusalWords(cause);
  return said === undefined ? fault : { ...fault, message: said };
}

/** An HQ that will not record a reveal by this person: someone HQ lets record it reveals it. */
const HQ_REFUSES_REVEAL = "HQ won't record a reveal by you here, so it stays hidden.";

const write = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof HqError && cause.code === "conflict" && !cause.problems?.length
        ? { outcome: "uncertain-acceptance" as const, message: cause.message }
        : faultOf(cause),
  });

/** A creation's write HQ answered: done, its target the handle. */
const answered = (
  requestId: string,
  target: string,
  result?: OperationResult,
): OperationReceipt => ({
  requestId,
  operationId: target,
  executor: "hq",
  affected: [],
  handles: [target],
  acceptance: { kind: "accepted", ...(result === undefined ? {} : { result }) },
  outcome: { kind: "succeeded", evidence: "HQ answered the write." },
});

/** Reject an adapter answer that echoes transient input before it enters an operation receipt. */
function containsCandidate(value: unknown, token: string): boolean {
  if (typeof value === "string") return value.includes(token);
  if (Array.isArray(value)) return value.some((entry) => containsCandidate(entry, token));
  return (
    typeof value === "object" &&
    value !== null &&
    Object.entries(value).some(
      ([key, entry]) => key.includes(token) || containsCandidate(entry, token),
    )
  );
}

export function makeHqExecutor(ports: {
  /** The organization's official HQ, once known; `null` while none is. */
  readonly apiOf: (orgId: string) => HqWrites | null;
  /** Captured account lifetime: an ended sign-in sends nothing, and Git requires a live one. */
  readonly active?: () => boolean;
  /** Required for Git: offers and candidate cleanup share the account store lifetime. */
  readonly gitStore?: AccountStore;
  readonly hqProjectIdOf?: (orgId: string) => string | null;
  /** The account store: an acknowledged observe authorization fences status reads begun before. */
  readonly store?: AccountStore;
}): HqExecutor {
  const candidates = new Map<string, { readonly intent: HqGitCandidateIntent; token: string }>();
  /** Each chat-link take's code by its request id, until its one send takes it out. */
  const chatLinkCodes = new Map<string, string>();
  let gitClosed = false;
  const cancelGitCandidate = (id: string) => {
    const held = candidates.get(id);
    if (held !== undefined) held.token = "";
    candidates.delete(id);
  };
  ports.gitStore?.onClose(() => {
    gitClosed = true;
    for (const id of candidates.keys()) cancelGitCandidate(id);
  });
  const gitCurrent = (intent: HqGitTargetIntent) =>
    ports.gitStore !== undefined &&
    !gitClosed &&
    ports.active?.() === true &&
    ports.hqProjectIdOf?.(intent.orgId) === intent.hqProjectId;
  const gitFault = (message: string): StreamFault => ({ outcome: "definitive-refusal", message });
  const gitReceipt = (id: string, said: OperationReceipt): OperationReceipt => {
    if (said.requestId !== id || said.executor !== "hq")
      throw new HqError({
        kind: "uncertain",
        code: "unreadable",
        message: "HQ did not confirm the original Git operation identity.",
      });
    return said;
  };
  const gitWrite = (id: string, intent: HqGitTargetIntent) =>
    Effect.gen(function* () {
      const held = candidates.get(id);
      // Move the candidate out before use; neither retry nor a second execution can recover it.
      let token = held?.token;
      cancelGitCandidate(id);
      if (!gitCurrent(intent))
        return yield* Effect.fail(gitFault("This Zerops sign-in has ended."));
      if (
        needsGitCandidate(intent) &&
        (token === undefined || token === "" || !sameValue(held?.intent, intent))
      )
        return yield* Effect.fail(gitFault("Enter the candidate token again."));
      const read = readsOfState(ports.gitStore!.state());
      const nav = hqNavigation.derive(read, intent.orgId);
      const app = read.fact("hqApp", intent.appId);
      if (app.kind !== "known")
        return yield* Effect.fail(gitFault("HQ has not offered this Git operation."));
      const can =
        "environmentId" in intent
          ? hqEnvironmentOffers.derive(read, intent)
          : nav.structure?.apps.find((candidate) => candidate.id === intent.appId)?.can;
      const offer = hqOffer(can, HQ_GIT_OPERATION_VERBS[intent.kind]);
      if (offer.kind !== "allowed")
        return yield* Effect.fail(
          gitFault(
            offer.kind === "refused" ? offer.reason : "HQ has not offered this Git operation.",
          ),
        );
      const api = ports.apiOf(intent.orgId);
      if (api === null) return yield* Effect.fail(gitFault(HQ_NOT_OPEN));
      const releaseClose = ports.gitStore!.onClose(() => {
        token = undefined;
      });
      return yield* Effect.tryPromise({
        try: async () => {
          const said = await api.gitTargetWrite(id, intent, token);
          if (token && containsCandidate(said, token))
            throw new HqError({
              kind: "uncertain",
              code: "unreadable",
              message: "HQ returned unsafe candidate evidence.",
            });
          if (!gitCurrent(intent))
            throw new HqError({
              kind: "uncertain",
              code: "closed",
              message: "This Zerops sign-in has ended.",
            });
          return gitReceipt(id, said);
        },
        // Keep proven refusal words, withholding any error that echoes transient input.
        catch: (cause) => {
          const fault = faultOf(cause, true);
          return needsGitCandidate(intent) &&
            (token === undefined || containsCandidate(fault, token))
            ? {
                outcome: fault.outcome,
                message: "HQ did not return safe evidence for this Git operation.",
              }
            : fault;
        },
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            token = undefined;
            releaseClose();
          }),
        ),
      );
    });

  /** A Chief's registration, its token and a proposal's decision: HQ's answer is their end. */
  const chiefWrite = (requestId: string, api: HqWrites, intent: HqChiefIntent) => {
    switch (intent.kind) {
      case "set-chief":
        return Effect.map(
          Effect.tryPromise({ try: () => api.setChief(intent.projectId), catch: faultOf }),
          ({ chief }) => answered(requestId, intent.projectId, { chief }),
        );
      case "decide-proposal":
        return Effect.map(
          Effect.tryPromise({
            try: () => api.decideProposal(intent.proposalId, intent.write),
            // HQ holds another decision of it: refused as decided, never a write that may land.
            catch: (cause) =>
              cause instanceof HqError && cause.kind === "refused" && cause.status === 409
                ? {
                    outcome: "definitive-refusal" as const,
                    message: cause.message,
                    code: PROPOSAL_DECIDED_ELSEWHERE,
                  }
                : faultOf(cause),
          }),
          (decision) => answered(requestId, intent.proposalId, { decision }),
        );
      case "approve-proposal":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.approveProposal(intent.proposalId, intent.approval),
            // HQ holds another decision of it: refused as decided, the card draws that one.
            catch: (cause) =>
              cause instanceof HqError && cause.kind === "refused" && cause.reason === "decided"
                ? {
                    outcome: "definitive-refusal" as const,
                    message: cause.message,
                    code: PROPOSAL_DECIDED_ELSEWHERE,
                  }
                : faultOf(cause, true),
          }),
          answered(requestId, intent.proposalId),
        );
      case "record-reveal": {
        // Nothing recorded, so nothing is shown, where no retry records it: HQ refusing the person.
        const unrecordable = (message: string): StreamFault => ({
          outcome: "definitive-refusal",
          message,
          code: REVEAL_UNRECORDABLE,
        });
        return Effect.map(
          Effect.tryPromise({
            try: () => api.recordReveal(intent.reveal),
            catch: (cause) =>
              cause instanceof HqError && cause.status === 403
                ? unrecordable(HQ_REFUSES_REVEAL)
                : faultOf(cause),
          }),
          () => answered(requestId, intent.reveal.projectId, {}),
        );
      }
    }
  };

  const creationWrite = (requestId: string, api: HqWrites, intent: HqWriteIntent) => {
    switch (intent.kind) {
      case "set-auto-update-policy":
        return Effect.map(
          write(async () => {
            const policy = await api.setAutoUpdatePolicy(intent.enabled);
            if (policy.orgId !== intent.orgId || policy.enabled !== intent.enabled)
              throw new HqError({
                kind: "uncertain",
                code: "unreadable",
                message: "HQ did not confirm this organization's policy change.",
              });
            return policy;
          }),
          (policy) => answered(requestId, intent.orgId, { policy }),
        );
      case "update-mate-face":
        return Effect.as(
          write(() => api.updateMate(intent.projectId, { face: intent.face })),
          answered(requestId, intent.projectId),
        );
      case "create-birth":
        return Effect.map(
          Effect.tryPromise({
            try: () => {
              const { kind: _kind, orgId: _orgId, ...birth } = intent;
              return api.createBirth(birth);
            },
            catch: (cause) => faultOf(cause, true),
          }),
          ({ id, appId }) => answered(requestId, id, { birthId: id, appId }),
        );
      case "continue-operation":
        // Another device continued it first, or it moved on, or it waits for someone else: HQ
        // took nothing, and the birth's own line says why, so it is done as answered. Never
        // `write`: its `409` is no doubt.
        return Effect.as(
          Effect.tryPromise({
            try: () =>
              api.continueOperation(intent.id).catch((cause: unknown) => {
                if (
                  cause instanceof HqError &&
                  cause.kind === "refused" &&
                  (cause.reason === "operation_not_waiting" ||
                    cause.reason === "not_operation_maker")
                )
                  return;
                throw cause;
              }),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.id),
        );
      case "end-operation":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.endOperation(intent.id),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.id),
        );
      case "start-mate-deletion":
        return Effect.as(
          Effect.tryPromise({
            try: () =>
              api.startMateDeletion(intent.projectId, {
                id: intent.id,
                ...(intent.keptGit === undefined ? {} : { keptGit: intent.keptGit }),
              }),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.projectId),
        );
      case "start-mate-restart":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.startMateRestart(intent.projectId, { id: intent.id }),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.projectId),
        );
      case "start-mate-stop":
      case "start-mate-start":
        return Effect.as(
          Effect.tryPromise({
            try: () =>
              api.startMatePower(
                intent.projectId,
                intent.kind === "start-mate-stop" ? "stop" : "start",
                {
                  id: intent.id,
                },
              ),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.projectId),
        );
      case "start-mate-rename":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.startMateRename(intent.projectId, { id: intent.id, name: intent.name }),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.projectId),
        );
      case "start-production-removal":
        return Effect.as(
          Effect.tryPromise({
            try: () =>
              api.startProductionRemoval(intent.appId, intent.projectId, {
                id: intent.id,
                deleteProject: intent.deleteProject,
              }),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.projectId),
        );
      case "start-app-deletion":
        return Effect.as(
          Effect.tryPromise({
            try: () =>
              api.startAppDeletion(intent.appId, {
                id: intent.id,
                stages: intent.stages,
                ...(intent.mate === undefined ? {} : { mate: intent.mate }),
                ...(intent.plains === undefined || intent.plains.length === 0
                  ? {}
                  : { plains: intent.plains }),
                ...(intent.productions === undefined || intent.productions.length === 0
                  ? {}
                  : { productions: intent.productions }),
                ...(intent.keepRepos === undefined || intent.keepRepos.length === 0
                  ? {}
                  : { keepRepos: intent.keepRepos }),
                ...(intent.names === undefined || Object.keys(intent.names).length === 0
                  ? {}
                  : { names: intent.names }),
              }),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.appId),
        );
      case "start-environment":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.startEnvironment(intent.appId, intent.start),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.appId),
        );
      case "start-deploy-key":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.startDeployKey(intent.appId, intent.name, { id: intent.id }),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.appId),
        );
      case "start-put-live":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.startPutLive(intent.appId, intent.start),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.appId),
        );
      case "start-project-move":
        return Effect.as(
          Effect.tryPromise({
            try: () => {
              const { kind: _kind, orgId: _orgId, projectId, ...start } = intent;
              return api.startProjectMove(projectId, start);
            },
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.projectId),
        );
      case "start-app-rename":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.startAppRename(intent.appId, { id: intent.id, name: intent.name }),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.appId),
        );
      case "delete-birth":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.deleteBirth(intent.birthId, { id: intent.id }),
            catch: (cause) => faultOf(cause, true),
          }),
          receipt(requestId, intent.id, undefined, PENDING),
        );
      case "acknowledge-birth-deletion":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.acknowledgeBirthDeletion(intent.id),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.id),
        );
      case "start-mate-handover":
        return Effect.as(
          Effect.tryPromise({
            try: () =>
              api.handOver(intent.projectId, { id: intent.id, ownerUserId: intent.ownerUserId }),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.projectId),
        );
    }
  };

  return {
    cancelGitCandidate,
    hasGitCandidate: (id) => candidates.has(id),
    submitChatLink: (operations, id, intent, code) => {
      if (chatLinkCodes.has(id)) throw new Error("This chat link is being taken already.");
      chatLinkCodes.set(id, code);
      return operations
        .submit(intent, id)
        .pipe(Effect.ensuring(Effect.sync(() => chatLinkCodes.delete(id))));
    },
    submitGitCandidate: (operations, id, intent, token) => {
      if (candidates.has(id)) throw new Error("This Git operation already has a candidate.");
      const candidate = { intent, token };
      if (gitCurrent(intent)) candidates.set(id, candidate);
      else candidate.token = "";
      token = "";
      return Effect.suspend(() =>
        candidates.get(id) === candidate ? operations.submit(intent, id) : Effect.succeed(id),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (candidates.get(id) === candidate) cancelGitCandidate(id);
          }),
        ),
      );
    },
    lookupKinds: new Set(Object.keys(HQ_GIT_OPERATION_VERBS)),
    lookup: (requestId, intent) =>
      Effect.gen(function* () {
        if (!isHqGitTargetIntent(intent))
          return yield* Effect.fail(gitFault("HQ keeps no request of this kind to check."));
        if (!gitCurrent(intent))
          return yield* Effect.fail(
            gitFault("Return to the original account to check this Git operation."),
          );
        const api = ports.apiOf(intent.orgId);
        if (api === null)
          return yield* Effect.fail({
            outcome: "transient" as const,
            message: "The original HQ must resolve this Git operation.",
          });
        const said = yield* Effect.tryPromise({
          try: () => api.gitTargetReceipt(requestId, intent),
          catch: (cause): StreamFault => ({
            outcome: "transient",
            message: faultOf(cause).message,
          }),
        });
        // An absent answer cannot authorize replay of an external write or a consumed token.
        if (said === null)
          return yield* Effect.fail({
            outcome: "transient" as const,
            message: "HQ has not resolved this Git operation.",
          });
        return yield* Effect.try({
          try: () => gitReceipt(requestId, said),
          catch: (): StreamFault => ({
            outcome: "transient",
            message: "HQ did not confirm the original Git operation identity.",
          }),
        });
      }),
    isCurrent: (intent) =>
      (!isHqGitTargetIntent(intent) || gitCurrent(intent)) &&
      ports.active?.() !== false &&
      (!("hqProjectId" in intent) ||
        (ports.active !== undefined && ports.hqProjectIdOf?.(intent.orgId) === intent.hqProjectId)),
    submit: (requestId, intent: OperationIntent) =>
      Effect.gen(function* () {
        // HQ away since it last answered here: answered at once, nothing sent, the person tries
        // again (`hqLink`). A link that has not answered yet is no outage: the write is sent.
        const away =
          "orgId" in intent && ports.store !== undefined && ports.apiOf(intent.orgId) !== null
            ? hqAwayAnswer(hqLinkOf(readsOfState(ports.store.state()), intent.orgId))
            : null;
        if (away !== null)
          return yield* Effect.fail<SubmissionFault>({
            outcome: "definitive-refusal",
            message: away,
            writeNotSent: true,
          });
        if (isHqGitTargetIntent(intent)) return yield* gitWrite(requestId, intent);
        if (ports.active?.() === false)
          return yield* Effect.fail<StreamFault>({
            outcome: "definitive-refusal",
            message: "This Zerops sign-in has ended.",
          });
        if (FLOW_KINDS.has(intent.kind)) {
          const flow = intent as FlowWriteIntent;
          const api = ports.apiOf(flow.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          // A refusal keeps HQ's code: the review hands a merge's `too_large` on as it is.
          return yield* flowWrite(requestId, api, flow, (call) =>
            Effect.tryPromise({ try: call, catch: (cause) => faultOf(cause, true) }),
          );
        }
        if (intent.kind === "answer-kept-git") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          yield* Effect.tryPromise({
            try: () => api.answerKeptGit(intent.appId, intent.answer),
            catch: (cause) => faultOf(cause, true),
          });
          return {
            ...answered(requestId, intent.appId),
            affected: [{ family: "hqKeptGit", id: intent.appId }],
            outcome: { kind: "succeeded", evidence: "HQ answered the kept code question." },
          };
        }
        if (intent.kind === "save-persona-template" || intent.kind === "delete-persona-template") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          const call: () => Promise<unknown> =
            intent.kind === "save-persona-template"
              ? () =>
                  api.savePersonaTemplate(intent.templateId, {
                    name: intent.name,
                    description: intent.description,
                    instructions: intent.instructions,
                    revision: intent.revision,
                  })
              : () => api.deletePersonaTemplate(intent.templateId, intent.revision);
          // A conflict is HQ's answer that it holds another revision: refused, its code kept.
          yield* Effect.tryPromise({ try: call, catch: (cause) => faultOf(cause, true) });
          return {
            ...answered(requestId, intent.templateId),
            affected: [{ family: "hqPersonaTemplates", id: intent.orgId }],
          };
        }
        if (intent.kind === "connect-git-remote-via-app") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          yield* Effect.tryPromise({
            try: () =>
              api.repoRemoteViaApp(intent.appId, intent.repo, {
                repository: intent.repository,
                ...(intent.githubAppId === undefined ? {} : { githubAppId: intent.githubAppId }),
              }),
            catch: faultOf,
          });
          return {
            ...answered(requestId, intent.appId),
            affected: [{ family: "hqAppDetail", id: `${intent.appId}/repos` }],
            outcome: { kind: "pending" },
          };
        }
        if (intent.kind === "create-git-remote-via-app") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          yield* Effect.tryPromise({
            try: () =>
              api.repoRemoteCreateViaApp(intent.appId, intent.repo, {
                installationId: intent.installationId,
                name: intent.name,
              }),
            catch: faultOf,
          });
          return {
            ...answered(requestId, intent.appId),
            affected: [{ family: "hqAppDetail", id: `${intent.appId}/repos` }],
            outcome: { kind: "pending" },
          };
        }
        if (intent.kind === "follow-github-repository") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          yield* Effect.tryPromise({
            try: () => api.followRepoUpstream(intent.appId, intent.repo, { url: intent.url }),
            catch: faultOf,
          });
          return {
            ...answered(requestId, intent.appId),
            affected: [{ family: "hqAppDetail", id: `${intent.appId}/repos` }],
            outcome: { kind: "succeeded", evidence: "HQ answered the write." },
          };
        }
        if (intent.kind === "stop-following-github-repository") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          yield* Effect.tryPromise({
            try: () => api.unfollowRepoUpstream(intent.appId, intent.repo),
            catch: faultOf,
          });
          return {
            ...answered(requestId, intent.appId),
            affected: [{ family: "hqAppDetail", id: `${intent.appId}/repos` }],
            outcome: { kind: "pending" },
          };
        }
        if (intent.kind === "delete-repository") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          yield* Effect.tryPromise({
            try: () => api.deleteRepo(intent.appId, intent.repo),
            catch: faultOf,
          });
          return {
            ...answered(requestId, intent.appId),
            affected: [{ family: "hqAppDetail", id: `${intent.appId}/repos` }],
            outcome: { kind: "pending" },
          };
        }
        if (intent.kind === "set-repo-cap") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          // HQ's `409 conflict` here is a refusal it names (`cap_below_usage`, `repo_not_moved`).
          const storage = yield* Effect.tryPromise({
            try: () => api.setRepoCap(intent.appId, intent.repo, intent.capGiB),
            catch: faultOf,
          });
          return answered(requestId, intent.appId, { storage });
        }
        if (intent.kind === "set-mergers") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          // HQ's `409 conflict` here is a refusal it names (`not_active_member`), never a lost write.
          const mergers = yield* Effect.tryPromise({
            try: () => api.setMergers(intent.appId, intent.people),
            catch: mergersFault,
          });
          return {
            ...answered(requestId, intent.appId, { mergers }),
            affected: [{ family: "hqApp", id: intent.appId }],
          };
        }
        if (intent.kind === "set-outside-production") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          const said = yield* Effect.tryPromise({
            try: () => api.setOutsideProduction(intent.appId, intent.outside),
            catch: outsideProductionFault,
          });
          return {
            ...answered(requestId, intent.appId, {
              outside: said === null ? null : { address: said.address },
            }),
            affected: [{ family: "hqApp", id: intent.appId }],
          };
        }
        if (!("orgId" in intent))
          return yield* Effect.die(new Error(`HQ executes no ${intent.kind}.`));
        const api = ports.apiOf(intent.orgId);
        // No HQ to send it to: nothing was sent, and nothing will be until one is named.
        if (api === null)
          return yield* Effect.fail<StreamFault>({
            outcome: "definitive-refusal",
            message: HQ_NOT_OPEN,
          });
        if (
          intent.kind === "set-chief" ||
          intent.kind === "decide-proposal" ||
          intent.kind === "approve-proposal" ||
          intent.kind === "record-reveal"
        )
          return yield* chiefWrite(requestId, api, intent);
        if (intent.kind === "take-chat-link") {
          const code = chatLinkCodes.get(requestId);
          chatLinkCodes.delete(requestId);
          if (code === undefined)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: CHAT_LINK_CODE_GONE,
            });
          const link = yield* Effect.tryPromise({
            try: () => api.takeChatLink(code),
            catch: chatLinkFault,
          });
          return answered(requestId, intent.orgId, link);
        }
        if (intent.kind === "authorize-observe") {
          const answer = yield* Effect.tryPromise({
            try: () => api.establishZcpAuthorization(intent.projectId, {}),
            catch: faultOf,
          });
          const key = { orgId: intent.orgId, projectId: intent.projectId };
          // HQ's answer is the status now, over any read begun before it.
          if (ports.store !== undefined && ports.active?.() !== false)
            commitOwn(
              ports.store,
              "hqObserveCredentialRequest",
              observeRequestScope(key),
              observeCredentialId(key),
              { requestId, answer },
            );
          return answered(requestId, intent.projectId);
        }
        if (intent.kind === "ask-read-access" || intent.kind === "close-read-access") {
          const call =
            intent.kind === "ask-read-access"
              ? () => api.askReadAccess(intent.projectId).then(() => {})
              : () => api.closeReadAccess(intent.id, intent.outcome);
          yield* Effect.tryPromise({ try: call, catch: faultOf });
          return answered(
            requestId,
            intent.kind === "ask-read-access" ? intent.projectId : intent.id,
          );
        }
        if (intent.kind === "start-access-changes") {
          // A refusal names HQ's reason (`admin_required`, `already_member`, the target's
          // `operation_in_flight`); the token rides only in the body the client builds.
          const started = yield* Effect.tryPromise({
            try: () => api.startAccessChanges(intent.changes),
            catch: (cause) => faultOf(cause, true),
          });
          const ids = started.operations.map((operation) => operation.id);
          return {
            ...answered(requestId, ids[0] ?? intent.orgId, { operations: started.operations }),
            handles: ids,
          };
        }
        if (intent.kind === "delete-access-change") {
          // `409 operation_running` and `404` are HQ's refusals, kept with their reason.
          yield* Effect.tryPromise({
            try: () => api.deleteAccessChange(intent.id),
            catch: (cause) => faultOf(cause, true),
          });
          return answered(requestId, intent.id);
        }
        if (intent.kind === "change-comment") {
          const said = yield* Effect.tryPromise({
            try: () => api.commentOnChange(intent.link, intent.body),
            catch: faultOf,
          });
          return {
            requestId,
            operationId: said.id,
            executor: "hq",
            affected: [{ family: "hqDiscussion", id: discussionId(intent.link) }],
            handles: [said.id],
            acceptance: { kind: "accepted" },
            outcome: { kind: "pending" },
          } satisfies OperationReceipt;
        }
        return yield* creationWrite(requestId, api, intent as HqWriteIntent);
      }),
  };
}
