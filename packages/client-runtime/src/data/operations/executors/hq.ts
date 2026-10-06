/**
 * HQ as an operation's owner, over the organization's HQ the intent names: each write HQ answers
 * at once. HQ keeps no request id for these, so a lost answer is resolved by the kind's effect
 * handles in HQ's navigation, never by sending again. An environment's deploy key is minted by
 * the person's own Zerops client and handed to HQ, which keeps it; a key HQ refused is taken back.
 *
 * @module data/operations/executors/hq
 */
import * as Effect from "effect/Effect";

import type { ZeropsApiClient } from "../../../zerops/api.ts";
import { deployTokenMint } from "../../../zerops/deployToken.ts";
import { HqError, type HqApi, type HqEndpoint } from "../../../zerops/hq/client.ts";
import type { OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationExecutor, UncertainAcceptance } from "../coordinator.ts";
import type { HqWriteIntent } from "../hqWrites.ts";

export type HqWritesApi = Pick<
  HqApi,
  | "createApp"
  | "recordBirth"
  | "bindBirth"
  | "attachProject"
  | "createMate"
  | "recordClosedOff"
  | "keepDeployToken"
>;

/**
 * An HQ write's failure, classified: a lost answer may have landed; an HQ out of reach did not
 * take it; a refusal keeps HQ's words. A conflict says a record is there already — perhaps this
 * very write's — so it is read in HQ's facts as a lost answer is.
 */
function hqFault(cause: unknown): StreamFault | UncertainAcceptance {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (!(cause instanceof HqError)) return { outcome: "uncertain-acceptance", message };
  if (cause.kind === "uncertain" || cause.code === "conflict")
    return { outcome: "uncertain-acceptance", message };
  if (cause.kind === "unavailable") return { outcome: "transient", message };
  return cause.code === "forbidden"
    ? { outcome: "authoritative-denial", message }
    : { outcome: "definitive-refusal", message };
}

const write = <A>(call: () => Promise<A>) => Effect.tryPromise({ try: call, catch: hqFault });

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

export function makeHqExecutor(input: {
  /** The organization's HQ, reached as the person. */
  readonly hqOf: (orgId: string, hq: HqEndpoint) => HqWritesApi;
  readonly zerops: Pick<ZeropsApiClient, "mintIntegrationToken" | "deleteIntegrationToken">;
}): OperationExecutor {
  /** The environment's own token minted, then kept by HQ; a refused one taken back. */
  const keepKey = (intent: Extract<HqWriteIntent, { readonly kind: "keep-deploy-key" }>) =>
    Effect.gen(function* () {
      const minted = yield* write(() =>
        input.zerops.mintIntegrationToken({
          clientId: intent.orgId,
          ...deployTokenMint({
            projectId: intent.projectId,
            environmentName: intent.environmentName,
          }),
        }),
      );
      return yield* write(() =>
        input
          .hqOf(intent.orgId, intent.hq)
          .keepDeployToken(intent.appId, intent.environmentName, minted.token)
          .catch(async (cause: unknown) => {
            // A key HQ refused is a key nobody needs: no orphan of a write that failed stays.
            if (cause instanceof HqError && cause.kind === "refused" && cause.code !== "conflict")
              await input.zerops
                .deleteIntegrationToken({ clientId: intent.orgId, tokenId: minted.id })
                .catch(() => undefined);
            throw cause;
          }),
      );
    });
  return {
    submit: (requestId, intent) => {
      const hqWrite = intent as HqWriteIntent;
      const hq = () => input.hqOf(hqWrite.orgId, hqWrite.hq);
      switch (hqWrite.kind) {
        case "create-app":
          return Effect.map(
            write(() => hq().createApp(hqWrite.name)),
            ({ id }) => answered(requestId, id, { appId: id }),
          );
        case "record-birth":
          return Effect.map(
            write(() =>
              hq().recordBirth({
                appId: hqWrite.appId,
                face: hqWrite.face,
                ...(hqWrite.standUp === undefined ? {} : { standUp: hqWrite.standUp }),
              }),
            ),
            ({ id }) => answered(requestId, id, { birthId: id }),
          );
        case "bind-birth":
          return Effect.as(
            write(() => hq().bindBirth(hqWrite.birthId, hqWrite.projectId)),
            answered(requestId, hqWrite.birthId),
          );
        case "attach-project":
          return Effect.as(
            write(() => hq().attachProject(hqWrite.appId, hqWrite.attach)),
            answered(requestId, hqWrite.attach.projectId),
          );
        case "create-mate-record":
          return Effect.as(
            doneWhenRefused("conflict", () => hq().createMate(hqWrite.mate)),
            answered(requestId, hqWrite.mate.projectId),
          );
        case "mark-closed-off":
          return Effect.as(
            doneWhenRefused("mate_not_found", () => hq().recordClosedOff(hqWrite.projectId)),
            answered(requestId, hqWrite.projectId),
          );
        case "keep-deploy-key":
          return Effect.as(keepKey(hqWrite), answered(requestId, hqWrite.projectId));
      }
    },
  };
}
