import type { HqLifecycleRecord } from "@t3tools/shared/hqLifecycle";
import type { HqDeliveryAnswer } from "@t3tools/shared/hqDeploys";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { canonicalHqNavigation, hqEnvironmentOffers } from "../../projections/hqNavigation.ts";
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
import { lifecycleReceipt } from "../../families/hqLifecycle.ts";
/**
 * HQ as the owner of the operations it executes: each kind's write through the organization's
 * official HQ, its answer the receipt. A write whose answer was lost — HQ's client could not read
 * back whether it was made — may have been made: uncertain, never sent again blindly. A refusal
 * keeps what HQ said; HQ unreachable took nothing.
 *
 * A creation's writes (`hqWrites.ts`) HQ answers at once, and keeps no request id for: a lost
 * answer is resolved by the kind's effect handles in HQ's navigation. A conflict says a record is
 * there already — perhaps this very write's — so it is read there as a lost answer is. An
 * environment's deploy key is minted by the person's own Zerops client and handed to HQ, which
 * keeps it; a key HQ refused is taken back.
 *
 * @module data/operations/executors/hq
 */
import * as Effect from "effect/Effect";

import type { ZeropsApiClient } from "../../../zerops/api.ts";
import { deployTokenMint } from "../../../zerops/deployToken.ts";
import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import { HQ_NOT_OPEN, hqNeedsUpdate } from "../../../zerops/hq/refusals.ts";
import { discussionId } from "../../families/hqDiscussion.ts";
import { observeCredentialId, observeRequestScope } from "../../families/hqObserveCredential.ts";
import { commitOwn } from "../../adapters/hqSettingsReads.ts";
import type { OperationIntent, OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationExecutor, SubmissionFault, UncertainAcceptance } from "../coordinator.ts";
import { REVEAL_UNRECORDABLE, PROPOSAL_DECIDED_ELSEWHERE, type HqChiefIntent } from "../hqChief.ts";
import { keptDeployToken, type HqWriteIntent } from "../hqWrites.ts";

import {
  changeHandle,
  environmentHandle,
  FLOW_WRITE_KINDS,
  type FlowWriteIntent,
} from "../flowWrites.ts";

/** The project kinds HQ deploys with an environment's deploy token. */
const ENVIRONMENT_KINDS: ReadonlySet<string> = new Set(["stage", "production"]);

/** Only this reviewed removal may authorize deletion of its particular target. */
function matchingProductionRemoval(intent: OperationIntent, record: HqLifecycleRecord): boolean {
  return (
    intent.kind !== "remove-production" ||
    (record.intent.kind === "remove-production" &&
      record.intent.orgId === intent.orgId &&
      record.intent.hqProjectId === intent.hqProjectId &&
      record.intent.appId === intent.appId &&
      record.intent.projectId === intent.projectId &&
      record.intent.deleteProject === intent.deleteProject &&
      record.productionRemoval?.deleteProject === intent.deleteProject)
  );
}

/** The flow's writes HQ executes, as its client sends them. */
type FlowWrites = Pick<
  HqApi,
  "rollback" | "redeploy" | "addService" | "mergeChange" | "closeChange" | "handChange"
> & {
  readonly release: (
    ...input: Parameters<HqApi["release"]>
  ) => Promise<Awaited<ReturnType<HqApi["release"]>> & { readonly delivery?: HqDeliveryAnswer }>;
};

/** The writes HQ executes, as its client sends them. */
export type HqWrites = Pick<
  HqApi,
  | "commentOnChange"
  | "renameApp"
  | "deleteApp"
  | "answerKeptGit"
  | "completeProjectDeletion"
  | "createApp"
  | "recordBirth"
  | "bindBirth"
  | "registerBirthChief"
  | "deleteBirth"
  | "claimBirthAttempt"
  | "endBirthAttempt"
  | "attachProject"
  | "createMate"
  | "establishZcpAuthorization"
  | "keepDeployToken"
  | "handOver"
  | "setChief"
  | "decideProposal"
> &
  Partial<Pick<HqApi, "recordReveal">> &
  Partial<
    Pick<
      HqApi,
      | "repoRemoteViaApp"
      | "followRepoUpstream"
      | "unfollowRepoUpstream"
      | "deleteRepo"
      | "setRepoCap"
    >
  > &
  FlowWrites &
  Partial<HqGitWrites> &
  Partial<
    Pick<
      HqApi,
      | "lifecycleWrite"
      | "lifecycleReceipt"
      | "updateMate"
      | "setAutoUpdatePolicy"
      | "savePersonaTemplate"
      | "deletePersonaTemplate"
    >
  >;

/** Optional adapter ports; an older HQ/client never implies support for a Git verb. */
export interface HqGitWrites {
  readonly gitTargetWrite: (
    requestId: string,
    intent: HqGitTargetIntent,
    candidate?: string,
  ) => Promise<OperationReceipt>;
  readonly gitTargetReceipt: (
    requestId: string,
    intent: HqGitTargetIntent,
  ) => Promise<OperationReceipt | null>;
}
export interface HqExecutor extends OperationExecutor {
  readonly submitGitCandidate: (
    operations: Operations,
    requestId: string,
    intent: HqGitCandidateIntent,
    token: string,
  ) => Effect.Effect<string>;
  readonly cancelGitCandidate: (requestId: string) => void;
  readonly hasGitCandidate: (requestId: string) => boolean;
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
            { deploys, mergedSha: made.mergedSha },
            PENDING,
          ),
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

/** An HQ from before reveals were recorded: a retry never records one. */
const HQ_RECORDS_NO_REVEALS = hqNeedsUpdate("record reveals");
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

/** A write HQ refuses with `code` as done already: a Mate's record it holds (`conflict`). */
const doneWhenRefused = (code: string, call: () => Promise<void>) =>
  write(() =>
    call().catch((cause: unknown) => {
      if (cause instanceof HqError && cause.kind === "refused" && cause.code === code) return;
      throw cause;
    }),
  );

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
  /**
   * The person's Zerops client, which mints an environment's deploy key and deletes the one HQ no
   * longer keeps.
   */
  readonly zerops: Pick<ZeropsApiClient, "mintIntegrationToken" | "deleteIntegrationToken">;
  /** Says once that a deploy token HQ no longer keeps is still alive on Zerops, and why. */
  readonly tokenLeft?: (message: string) => void;
  /** Captured account lifetime; lifecycle writes require it. */
  readonly active?: () => boolean;
  /** Required for Git: offers and candidate cleanup share the account store lifetime. */
  readonly gitStore?: AccountStore;
  readonly hqProjectIdOf?: (orgId: string) => string | null;
  /** The account store: an acknowledged observe authorization fences status reads begun before. */
  readonly store?: AccountStore;
}): HqExecutor {
  const candidates = new Map<string, { readonly intent: HqGitCandidateIntent; token: string }>();
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
      const nav = canonicalHqNavigation.derive(read, intent.orgId);
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
      if (api?.gitTargetWrite === undefined)
        return yield* Effect.fail(gitFault(hqNeedsUpdate("use Git target operations")));
      const releaseClose = ports.gitStore!.onClose(() => {
        token = undefined;
      });
      return yield* Effect.tryPromise({
        try: async () => {
          const said = await api.gitTargetWrite!(id, intent, token);
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

  /** The deploy token HQ's navigation says it keeps for the environment on `projectId`. */
  const keptToken = (appId: string | null, projectId: string) =>
    appId === null || ports.store === undefined
      ? undefined
      : keptDeployToken(readsOfState(ports.store.state()), appId, projectId);
  /**
   * A token HQ no longer keeps, deleted on Zerops once: a failure, or an id HQ never recorded, is
   * said, never retried and never the failure of the HQ write that let it go.
   */
  const retireToken = (orgId: string, token: { readonly id: string | undefined } | undefined) => {
    if (token === undefined) return Effect.void;
    const tokenId = token.id;
    if (tokenId === undefined)
      return Effect.sync(() =>
        ports.tokenLeft?.(
          "HQ did not record which deploy token it used, so Mate could not delete it. Delete it among the organization's access tokens in Zerops.",
        ),
      );
    return Effect.promise(() =>
      ports.zerops.deleteIntegrationToken({ clientId: orgId, tokenId }).then(
        () => undefined,
        (cause: unknown) =>
          ports.tokenLeft?.(
            `Zerops did not delete the deploy token HQ no longer uses (${
              cause instanceof Error ? cause.message : String(cause)
            }). Delete it among the organization's access tokens in Zerops.`,
          ),
      ),
    );
  };

  /**
   * The environment's own token minted, then kept by HQ; a refused one taken back, and the one HQ
   * kept before deleted.
   */
  const keepKey = (
    api: HqWrites,
    intent: Extract<HqWriteIntent, { readonly kind: "keep-deploy-key" }>,
  ) =>
    Effect.gen(function* () {
      const previous = keptToken(intent.appId, intent.projectId);
      const minted = yield* write(() =>
        ports.zerops.mintIntegrationToken({
          clientId: intent.orgId,
          ...deployTokenMint({
            projectId: intent.projectId,
            environmentName: intent.environmentName,
          }),
        }),
      );
      yield* write(() =>
        api
          .keepDeployToken(intent.appId, intent.environmentName, minted.token)
          .catch(async (cause: unknown) => {
            // A key HQ refused is a key nobody needs: no orphan of a write that failed stays.
            if (cause instanceof HqError && cause.kind === "refused" && cause.code !== "conflict")
              await ports.zerops
                .deleteIntegrationToken({ clientId: intent.orgId, tokenId: minted.id })
                .catch(() => undefined);
            throw cause;
          }),
      );
      if (previous?.id !== minted.id) yield* retireToken(intent.orgId, previous);
    });

  /** A Chief's registration and a proposal's decision: HQ's answer is their end. */
  const chiefWrite = (requestId: string, api: HqWrites, intent: HqChiefIntent) => {
    switch (intent.kind) {
      case "set-chief":
        return Effect.map(
          Effect.tryPromise({ try: () => api.setChief(intent.projectId), catch: faultOf }),
          ({ chief }) => answered(requestId, intent.projectId, { chief }),
        );
      case "register-birth-chief":
        return Effect.map(
          Effect.tryPromise({ try: () => api.registerBirthChief(intent.birthId), catch: faultOf }),
          ({ projectId }) => answered(requestId, projectId, { projectId }),
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
      case "record-reveal": {
        const record = api.recordReveal;
        // Nothing recorded, so nothing is shown, where no retry records it: an HQ without reveals
        // (no call, or no address for it) until HQ is updated, or one refusing the person.
        const unrecordable = (message: string): StreamFault => ({
          outcome: "definitive-refusal",
          message,
          code: REVEAL_UNRECORDABLE,
        });
        if (record === undefined) return Effect.fail(unrecordable(HQ_RECORDS_NO_REVEALS));
        return Effect.map(
          Effect.tryPromise({
            try: () => record(intent.reveal),
            catch: (cause) =>
              cause instanceof HqError && cause.status === 404
                ? unrecordable(HQ_RECORDS_NO_REVEALS)
                : cause instanceof HqError && cause.status === 403
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
            if (api.setAutoUpdatePolicy === undefined)
              throw new HqError({
                kind: "refused",
                code: "unsupported",
                message: hqNeedsUpdate("change automatic updates"),
              });
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
          write(() => {
            if (api.updateMate === undefined)
              throw new HqError({
                kind: "refused",
                code: "unsupported",
                message: "HQ cannot change this Mate’s face.",
              });
            return api.updateMate(intent.projectId, { face: intent.face });
          }),
          answered(requestId, intent.projectId),
        );
      case "create-app":
        return Effect.map(
          write(() => api.createApp(intent.name)),
          ({ id }) => answered(requestId, id, { appId: id }),
        );
      case "record-birth":
        return Effect.map(
          write(() =>
            api.recordBirth({
              appId: intent.appId,
              id: intent.id,
              face: intent.face,
              ...(intent.createdApp === true ? { createdApp: true as const } : {}),
              ...(intent.intent === undefined ? {} : { intent: intent.intent }),
              ...(intent.chief === true ? { chief: true as const } : {}),
              ...(intent.standUp === undefined ? {} : { standUp: intent.standUp }),
              ...(intent.automated === true ? { automated: true as const } : {}),
              ...(intent.standupPersona === undefined
                ? {}
                : { standupPersona: intent.standupPersona }),
            }),
          ),
          ({ id }) => answered(requestId, id, { birthId: id }),
        );
      case "bind-birth":
        return Effect.as(
          write(() => api.bindBirth(intent.birthId, intent.projectId)),
          answered(requestId, intent.birthId),
        );
      case "delete-birth":
        return Effect.as(
          Effect.tryPromise({
            try: () => api.deleteBirth(intent.birthId),
            catch: (cause) => faultOf(cause, true),
          }),
          answered(requestId, intent.birthId),
        );
      case "claim-birth-attempt":
        return Effect.map(
          write(() => api.claimBirthAttempt(intent.birthId, intent.step)),
          (claim) => answered(requestId, intent.birthId, { claim }),
        );
      case "end-birth-attempt":
        return Effect.as(
          write(() =>
            api.endBirthAttempt(
              intent.birthId,
              intent.step,
              intent.outcome,
              intent.at,
              intent.reason,
            ),
          ),
          answered(requestId, intent.birthId),
        );
      case "attach-project":
        return Effect.as(
          write(() => api.attachProject(intent.appId, intent.attach)),
          answered(requestId, intent.attach.projectId),
        );
      case "create-mate-record":
        return Effect.as(
          doneWhenRefused("conflict", () => api.createMate(intent.mate)),
          answered(requestId, intent.mate.projectId),
        );
      case "keep-deploy-key":
        return Effect.as(keepKey(api, intent), answered(requestId, intent.projectId));
      case "hand-over-mate":
        // Each of its `409`s is HQ's refusal (`owner_not_member`, `handover_unfinished` at a
        // phase), never a write that may have landed elsewhere: its words are the person's, its
        // code HQ's own, so a stop part way says that something was written.
        return Effect.as(
          Effect.tryPromise({
            try: () => api.handOver(intent.projectId, intent.ownerUserId),
            catch: (cause) => {
              const fault = faultOf(cause);
              return cause instanceof HqError && fault.outcome === "definitive-refusal"
                ? { ...fault, code: cause.code }
                : fault;
            },
          }),
          answered(requestId, intent.projectId),
        );
    }
  };

  return {
    cancelGitCandidate,
    hasGitCandidate: (id) => candidates.has(id),
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
    lookupKinds: new Set([
      ...Object.keys(HQ_GIT_OPERATION_VERBS),
      "move-project",
      "remove-production",
      "prepare-mate-deletion",
      "complete-mate-deletion",
      "complete-key-retirement",
    ]),
    lookup: (requestId, intent) =>
      Effect.gen(function* () {
        if (isHqGitTargetIntent(intent)) {
          if (!gitCurrent(intent))
            return yield* Effect.fail(
              gitFault("Return to the original account to check this Git operation."),
            );
          const api = ports.apiOf(intent.orgId);
          if (api?.gitTargetReceipt === undefined)
            return yield* Effect.fail({
              outcome: "transient" as const,
              message: "The original HQ must resolve this Git operation.",
            });
          const said = yield* Effect.tryPromise({
            try: () => api.gitTargetReceipt!(requestId, intent),
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
        }
        if (
          !("orgId" in intent) ||
          !("hqProjectId" in intent) ||
          ports.active?.() !== true ||
          ports.hqProjectIdOf?.(intent.orgId) !== intent.hqProjectId
        )
          return yield* Effect.fail<StreamFault>({
            outcome: "definitive-refusal",
            message: "Return to the original account and HQ to check this operation.",
          });
        const api = ports.apiOf(intent.orgId);
        if (api?.lifecycleReceipt === undefined)
          return yield* Effect.fail<StreamFault>({ outcome: "transient", message: HQ_NOT_OPEN });
        const record = yield* Effect.tryPromise({
          try: () => api.lifecycleReceipt!(requestId),
          catch: (cause): StreamFault => {
            const fault = faultOf(cause, true);
            return fault.outcome === "uncertain-acceptance"
              ? { outcome: "transient", message: fault.message }
              : fault;
          },
        });
        if (
          record !== null &&
          (record.intent.orgId !== intent.orgId ||
            record.intent.hqProjectId !== intent.hqProjectId ||
            !matchingProductionRemoval(intent, record))
        )
          return yield* Effect.fail<StreamFault>({
            outcome: "definitive-refusal",
            message: "HQ did not confirm the original request's owner.",
          });
        return record === null ? null : lifecycleReceipt(record);
      }),
    isCurrent: (intent) =>
      (!isHqGitTargetIntent(intent) || gitCurrent(intent)) &&
      ports.active?.() !== false &&
      (!("hqProjectId" in intent) ||
        (ports.active !== undefined && ports.hqProjectIdOf?.(intent.orgId) === intent.hqProjectId)),
    submit: (requestId, intent: OperationIntent) =>
      Effect.gen(function* () {
        // HQ away: answered at once, nothing sent, the person tries again (`hqLink`).
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
        if (
          intent.kind === "move-project" ||
          intent.kind === "remove-production" ||
          intent.kind === "prepare-mate-deletion" ||
          intent.kind === "complete-mate-deletion" ||
          intent.kind === "complete-key-retirement"
        ) {
          if (
            ports.active === undefined ||
            ports.hqProjectIdOf?.(intent.orgId) !== intent.hqProjectId
          )
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: "The original HQ must be available to finish this operation.",
            });
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          if (api.lifecycleWrite === undefined)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: hqNeedsUpdate("use lifecycle receipts"),
            });
          // Read before the write: once HQ confirms, its navigation no longer names the token.
          const leaving =
            intent.kind === "remove-production"
              ? keptToken(intent.appId, intent.projectId)
              : intent.kind === "move-project" &&
                  ENVIRONMENT_KINDS.has(intent.from.kind) &&
                  !ENVIRONMENT_KINDS.has(intent.to.kind)
                ? keptToken(intent.from.appId, intent.projectId)
                : undefined;
          const record = yield* Effect.tryPromise({
            try: () => api.lifecycleWrite!(requestId, intent),
            catch: (cause) => faultOf(cause, true),
          });
          if (!matchingProductionRemoval(intent, record))
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: "HQ did not confirm the reviewed production target and its fate.",
            });
          yield* retireToken(intent.orgId, leaving);
          return lifecycleReceipt(record);
        }
        if (intent.kind === "complete-project-deletion") {
          const api = ports.apiOf(intent.orgId);
          if (api === null || ports.hqProjectIdOf?.(intent.orgId) !== intent.hqProjectId)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          // HQ's 409 `project_present` or 401 `token_required` ends it, refused: never sent again.
          yield* Effect.tryPromise({
            try: () => api.completeProjectDeletion(intent.projectId),
            catch: (cause) => faultOf(cause, true),
          });
          return {
            ...answered(requestId, intent.projectId),
            affected: [{ family: "placement", id: intent.projectId }],
          };
        }
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
            outcome: { kind: "succeeded", evidence: "HQ answered the kept Git question." },
          };
        }
        if (intent.kind === "save-persona-template" || intent.kind === "delete-persona-template") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          const call: (() => Promise<unknown>) | undefined =
            intent.kind === "save-persona-template"
              ? api.savePersonaTemplate === undefined
                ? undefined
                : () =>
                    api.savePersonaTemplate!(intent.templateId, {
                      name: intent.name,
                      description: intent.description,
                      instructions: intent.instructions,
                      revision: intent.revision,
                    })
              : api.deletePersonaTemplate === undefined
                ? undefined
                : () => api.deletePersonaTemplate!(intent.templateId, intent.revision);
          if (call === undefined)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: hqNeedsUpdate("manage persona templates"),
            });
          // A conflict is HQ's answer that it holds another revision: refused, its code kept.
          yield* Effect.tryPromise({ try: call, catch: (cause) => faultOf(cause, true) });
          return {
            ...answered(requestId, intent.templateId),
            affected: [{ family: "hqPersonaTemplates", id: intent.orgId }],
          };
        }
        if (intent.kind === "rename-app" || intent.kind === "delete-app") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          yield* Effect.tryPromise({
            try: () =>
              intent.kind === "rename-app"
                ? api.renameApp(intent.appId, intent.name)
                : api.deleteApp(intent.appId, { withCode: intent.withCode === true }),
            catch: faultOf,
          });
          return {
            ...answered(requestId, intent.appId),
            affected: [{ family: "hqApp", id: intent.appId }],
            outcome: { kind: "succeeded", evidence: "HQ answered the write." },
          };
        }
        if (intent.kind === "connect-git-remote-via-app") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          if (api.repoRemoteViaApp === undefined)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: hqNeedsUpdate("connect through the organization's GitHub apps"),
            });
          yield* Effect.tryPromise({
            try: () =>
              api.repoRemoteViaApp!(intent.appId, intent.repo, {
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
        if (intent.kind === "follow-github-repository") {
          const api = ports.apiOf(intent.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          if (api.followRepoUpstream === undefined)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: hqNeedsUpdate("follow a GitHub repository whose code it keeps"),
            });
          yield* Effect.tryPromise({
            try: () => api.followRepoUpstream!(intent.appId, intent.repo, { url: intent.url }),
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
          if (api.unfollowRepoUpstream === undefined)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: hqNeedsUpdate("stop following a GitHub repository"),
            });
          yield* Effect.tryPromise({
            try: () => api.unfollowRepoUpstream!(intent.appId, intent.repo),
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
          if (api.deleteRepo === undefined)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: hqNeedsUpdate("delete a repository"),
            });
          yield* Effect.tryPromise({
            try: () => api.deleteRepo!(intent.appId, intent.repo),
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
          if (api.setRepoCap === undefined)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: hqNeedsUpdate("change a repository's storage limit"),
            });
          // HQ's `409 conflict` here is a refusal it names (`cap_below_usage`, `repo_not_moved`).
          const storage = yield* Effect.tryPromise({
            try: () => api.setRepoCap!(intent.appId, intent.repo, intent.capGiB),
            catch: faultOf,
          });
          return answered(requestId, intent.appId, { storage });
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
          intent.kind === "register-birth-chief" ||
          intent.kind === "decide-proposal" ||
          intent.kind === "record-reveal"
        )
          return yield* chiefWrite(requestId, api, intent);
        if (intent.kind === "authorize-observe") {
          const establish = api.establishZcpAuthorization;
          if (establish === undefined)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: hqNeedsUpdate("manage observe authorization"),
            });
          const answer = yield* Effect.tryPromise({
            try: () => establish(intent.projectId, {}),
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
