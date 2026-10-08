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
  "release" | "rollback" | "redeploy" | "addService" | "mergeChange" | "closeChange"
>;

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
> &
  FlowWrites &
  Partial<
    Pick<HqApi, "lifecycleWrite" | "lifecycleReceipt" | "updateMate" | "setAutoUpdatePolicy">
  >;

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
          }),
        ),
        ({ made, deploys }) => receipt(requestId, made.tag, { tag: made.tag, deploys }, PENDING),
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

export function makeHqExecutor(ports: {
  /** The organization's official HQ, once known; `null` while none is. */
  readonly apiOf: (orgId: string) => HqWrites | null;
  /** The person's Zerops client, which mints an environment's deploy key. */
  readonly zerops: Pick<ZeropsApiClient, "mintIntegrationToken" | "deleteIntegrationToken">;
  /** Captured account lifetime; lifecycle writes require it. */
  readonly active?: () => boolean;
  readonly hqProjectIdOf?: (orgId: string) => string | null;
}): OperationExecutor {
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
    lookupKinds: new Set([
      "move-project",
      "prepare-mate-deletion",
      "complete-mate-deletion",
      "complete-key-retirement",
    ]),
    lookup: (requestId, intent) =>
      Effect.gen(function* () {
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
          (record.intent.orgId !== intent.orgId || record.intent.hqProjectId !== intent.hqProjectId)
        )
          return yield* Effect.fail<StreamFault>({
            outcome: "definitive-refusal",
            message: "HQ did not confirm the original request's owner.",
          });
        return record === null ? null : lifecycleReceipt(record);
      }),
    isCurrent: (intent) =>
      ports.active?.() !== false &&
      (!("hqProjectId" in intent) ||
        (ports.active !== undefined && ports.hqProjectIdOf?.(intent.orgId) === intent.hqProjectId)),
    submit: (requestId, intent: OperationIntent) =>
      Effect.gen(function* () {
        if (ports.active?.() === false)
          return yield* Effect.fail<StreamFault>({
            outcome: "definitive-refusal",
            message: "This Zerops sign-in has ended.",
          });
        if (
          intent.kind === "move-project" ||
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
                : api.deleteApp(intent.appId),
            catch: faultOf,
          });
          return {
            ...answered(requestId, intent.appId),
            affected: [{ family: "hqApp", id: intent.appId }],
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
