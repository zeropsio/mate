import type { HqLifecycleRecord } from "@t3tools/shared/hqLifecycle";
import type { HqDeliveryAnswer } from "@t3tools/shared/hqDeploys";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { canonicalHqNavigation } from "../../projections/hqNavigation.ts";
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
import { HQ_NOT_OPEN } from "../../../zerops/hq/refusals.ts";
import { discussionId } from "../../families/hqDiscussion.ts";
import type { OperationIntent, OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationExecutor, UncertainAcceptance } from "../coordinator.ts";
import { PROPOSAL_DECIDED_ELSEWHERE, type HqChiefIntent } from "../hqChief.ts";
import type { HqWriteIntent } from "../hqWrites.ts";

import {
  changeHandle,
  environmentHandle,
  FLOW_WRITE_KINDS,
  type FlowWriteIntent,
} from "../flowWrites.ts";

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
  | "createApp"
  | "recordBirth"
  | "bindBirth"
  | "attachProject"
  | "createMate"
  | "recordClosedOff"
  | "keepDeployToken"
  | "setChief"
  | "decideProposal"
> &
  Partial<Pick<HqApi, "repoRemoteViaApp" | "followRepoUpstream">> &
  FlowWrites &
  Partial<HqGitWrites> &
  Partial<
    Pick<HqApi, "lifecycleWrite" | "lifecycleReceipt" | "updateMate" | "setAutoUpdatePolicy">
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
        ({ deploys }) => receipt(requestId, changeHandle(intent.link), { deploys }, PENDING),
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
      ...(keepCode ? { code: cause.reason ?? cause.code } : {}),
    };
  return { outcome: "transient", message };
}

const write = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof HqError && cause.code === "conflict"
        ? { outcome: "uncertain-acceptance" as const, message: cause.message }
        : faultOf(cause),
  });

/**
 * A write HQ refuses with `code` as done already: a Mate's record it holds (`conflict`), a close-off
 * of a Mate it holds no record of, which has nothing to mark (`mate_not_found`) — Finish setup,
 * which writes the record first, marks it at its own close-off.
 */
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
  /** The person's Zerops client, which mints an environment's deploy key. */
  readonly zerops: Pick<ZeropsApiClient, "mintIntegrationToken" | "deleteIntegrationToken">;
  /** Captured account lifetime; lifecycle writes require it. */
  readonly active?: () => boolean;
  /** Required for Git: offers and candidate cleanup share the account store lifetime. */
  readonly gitStore?: AccountStore;
  readonly hqProjectIdOf?: (orgId: string) => string | null;
  /**
   * Handed what a Chief's record answered for its project: the credential its zcp reaches the
   * organization with, and the proxy. Told once, at HQ's answer; the receipt never holds it.
   */
  readonly chiefAccess?: (
    projectId: string,
    access: { readonly credential: string; readonly proxyUrl: string },
  ) => void;
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
      let can = app.value.can;
      if ("environmentId" in intent) {
        const environments = app.value.environments;
        can =
          environments === undefined || "refused" in environments
            ? undefined
            : environments.find((environment) => environment.id === intent.environmentId)?.can;
      }
      const offer = hqOffer(can, HQ_GIT_OPERATION_VERBS[intent.kind], {
        current: nav.live,
        unavailableSince: nav.downSince ?? null,
      });
      if (offer.kind !== "allowed")
        return yield* Effect.fail(
          gitFault(
            offer.kind === "refused" ? offer.reason : "HQ has not offered this Git operation.",
          ),
        );
      const api = ports.apiOf(intent.orgId);
      if (api?.gitTargetWrite === undefined)
        return yield* Effect.fail(
          gitFault("Update HQ and the client to use Git target operations."),
        );
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

  /** The environment's own token minted, then kept by HQ; a refused one taken back. */
  const keepKey = (
    api: HqWrites,
    intent: Extract<HqWriteIntent, { readonly kind: "keep-deploy-key" }>,
  ) =>
    Effect.gen(function* () {
      const minted = yield* write(() =>
        ports.zerops.mintIntegrationToken({
          clientId: intent.orgId,
          ...deployTokenMint({
            projectId: intent.projectId,
            environmentName: intent.environmentName,
          }),
        }),
      );
      return yield* write(() =>
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
    });

  /** A Chief's record and a proposal's decision: HQ's answer is their end. */
  const chiefWrite = (requestId: string, api: HqWrites, intent: HqChiefIntent) => {
    switch (intent.kind) {
      case "set-chief":
        return Effect.map(
          Effect.tryPromise({ try: () => api.setChief(intent.projectId), catch: faultOf }),
          ({ chief, credential, proxyUrl }) => {
            ports.chiefAccess?.(intent.projectId, { credential, proxyUrl });
            return answered(requestId, intent.projectId, { chief });
          },
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
                message: "Update HQ to change automatic updates.",
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
              face: intent.face,
              ...(intent.standUp === undefined ? {} : { standUp: intent.standUp }),
              ...(intent.automated === true ? { automated: true as const } : {}),
            }),
          ),
          ({ id }) => answered(requestId, id, { birthId: id }),
        );
      case "bind-birth":
        return Effect.as(
          write(() => api.bindBirth(intent.birthId, intent.projectId)),
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
      case "mark-closed-off":
        return Effect.as(
          doneWhenRefused("mate_not_found", () => api.recordClosedOff(intent.projectId)),
          answered(requestId, intent.projectId),
        );
      case "keep-deploy-key":
        return Effect.as(keepKey(api, intent), answered(requestId, intent.projectId));
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
              message: "Update HQ to use lifecycle receipts.",
            });
          const record = yield* Effect.tryPromise({
            try: () => api.lifecycleWrite!(requestId, intent),
            catch: (cause) => faultOf(cause, true),
          });
          if (!matchingProductionRemoval(intent, record))
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: "HQ did not confirm the reviewed production target and its fate.",
            });
          return lifecycleReceipt(record);
        }
        if (FLOW_KINDS.has(intent.kind)) {
          const flow = intent as FlowWriteIntent;
          const api = ports.apiOf(flow.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          return yield* flowWrite(requestId, api, flow, (call) =>
            Effect.tryPromise({ try: call, catch: faultOf }),
          );
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
              message: "Update HQ to mirror through the organization's GitHub app.",
            });
          yield* Effect.tryPromise({
            try: () =>
              api.repoRemoteViaApp!(intent.appId, intent.repo, { repository: intent.repository }),
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
              message: "Update HQ to follow a GitHub repository whose code it keeps.",
            });
          yield* Effect.tryPromise({
            try: () => api.followRepoUpstream!(intent.appId, intent.repo, { url: intent.url }),
            catch: faultOf,
          });
          return {
            ...answered(requestId, intent.appId),
            outcome: { kind: "succeeded", evidence: "HQ answered the write." },
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
        if (intent.kind === "set-chief" || intent.kind === "decide-proposal")
          return yield* chiefWrite(requestId, api, intent);
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
