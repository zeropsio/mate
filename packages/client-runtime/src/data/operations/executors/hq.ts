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
import type { OperationIntent, OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationExecutor, UncertainAcceptance } from "../coordinator.ts";
import type { HqWriteIntent } from "../hqWrites.ts";

/** The writes HQ executes, as its client sends them. */
export type HqWrites = Pick<
  HqApi,
  | "commentOnChange"
  | "createApp"
  | "recordBirth"
  | "bindBirth"
  | "attachProject"
  | "createMate"
  | "recordClosedOff"
  | "keepDeployToken"
>;

function faultOf(cause: unknown): StreamFault | UncertainAcceptance {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (!(cause instanceof HqError) || cause.kind === "uncertain" || cause.code === "conflict")
    return { outcome: "uncertain-acceptance", message };
  if (cause.kind === "refused") return { outcome: "definitive-refusal", message };
  return { outcome: "transient", message };
}

const write = <A>(call: () => Promise<A>) => Effect.tryPromise({ try: call, catch: faultOf });

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
    submit: (requestId, intent: OperationIntent) =>
      Effect.gen(function* () {
        const hqWrite = intent as HqWriteIntent;
        const api = ports.apiOf(hqWrite.orgId);
        // No HQ to send it to: nothing was sent, and nothing will be until one is named.
        if (api === null)
          return yield* Effect.fail<StreamFault>({
            outcome: "definitive-refusal",
            message: HQ_NOT_OPEN,
          });
        return yield* creationWrite(requestId, api, hqWrite);
      }),
  };
}
