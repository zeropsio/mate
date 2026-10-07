import { mateAction } from "../mateActions.ts";
import { readsOfState } from "../../store.ts";
import { mateSetupOwner } from "../../families/mateSetup.ts";
import { workspaceFailure } from "../../adapters/mateWorkspace.ts";
/** The single Mate command I/O boundary. A lost answer stays uncertain and is never re-sent. */
import {
  WS_METHODS,
  CrewCommandError,
  ZeropsAgentLoginError,
  TerminalError,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { EnvironmentRpcInput } from "../../../rpc/client.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  EnvironmentNotRegisteredError,
  type EnvironmentRegistry,
} from "../../../connection/registry.ts";
import { EnvironmentRpcUnavailableError, request } from "../../../rpc/client.ts";
import {
  MATE_ACTIONS,
  type MateAction,
  type MateActionInput,
  type MateActionResult,
} from "../mateActions.ts";
import { Atom } from "effect/unstable/reactivity";
import * as Clock from "effect/Clock";
import { mateActionRequestId, mateActionRequestScope } from "../../families/mateActionRequest.ts";
import { streamOf } from "../../reducer.ts";
import type { AccountStore } from "../../store.ts";
export class MateActionUnavailable extends Schema.TaggedError<MateActionUnavailable>()(
  "MateActionUnavailable",
  { message: Schema.String },
) {}
const isUnavailable = Schema.is(EnvironmentRpcUnavailableError);
const isUnregistered = Schema.is(EnvironmentNotRegisteredError);
const isCrewCommandError = Schema.is(CrewCommandError);
const isLoginError = Schema.is(ZeropsAgentLoginError);
const isTerminalError = Schema.is(TerminalError);
/** Values named here identify the action without retaining credentials or editor text. */
export const mateActionTarget = (input: unknown): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {};
  if (typeof input !== "object" || input === null) return result;
  for (const name of ["agentId", "loginId", "threadId", "terminalId", "id", "_tag"]) {
    if (name in input && typeof (input as Record<string, unknown>)[name] === "string")
      result[name] = (input as Record<string, string>)[name]!;
  }
  return result;
};
export function makeMateActions(options: {
  readonly makeId: () => string;
  readonly store: AccountStore;
  readonly registry: EnvironmentRegistry["Service"];
  readonly setup?: ReturnType<typeof import("../../adapters/mateSetup.ts").makeMateSetupDemand>;
  readonly revalidate: (action: MateAction | "agentAuthCheck", environmentId: string) => void;
}) {
  let closed = false;
  const observing = new Map<string, () => void>();
  const unlisten = options.store.subscribe(() => {
    if (closed) return;
    const read = readsOfState(options.store.state());
    for (const [requestId, release] of [...observing]) {
      const record = options.store.state().operations.get(requestId);
      if (record?.intent.kind !== "mate-action" || record.receipt === null) continue;
      const settled = mateAction.settledBy?.(read, record.intent, record.receipt);
      if (settled == null) continue;
      observing.delete(requestId);
      options.store.dispatch({
        kind: "operation-receipt",
        receipt: {
          ...record.receipt,
          outcome:
            settled.kind === "succeeded"
              ? { kind: "succeeded", evidence: "The Mate's setup reported completion." }
              : { kind: "failed", evidence: settled.reason },
        },
      });
      release();
    }
  });
  const execute = <A extends MateAction>(
    action: A,
    environmentId: EnvironmentId,
    input: MateActionInput<A>,
    setupContext?: { readonly orgId: string; readonly origin: string },
  ) =>
    Effect.gen(function* () {
      if (closed)
        return yield* Effect.fail(
          new MateActionUnavailable({ message: "This account has closed." }),
        );
      const requestId = options.makeId();
      const setupOwner =
        setupContext === undefined
          ? undefined
          : mateSetupOwner(setupContext.orgId, setupContext.origin);
      const revision =
        setupOwner === undefined
          ? undefined
          : options.store.state().facts.get(`mateSetup:${setupOwner}`)?.revision;
      const target = {
        ...mateActionTarget(input),
        ...(setupOwner === undefined
          ? {}
          : {
              setupOwner,
              setupRevision: String(revision?.kind === "mate-link" ? revision.sequence : 0),
            }),
      };
      const intent = { environmentId, action, target };
      const scope = mateActionRequestScope(environmentId);
      const now = yield* Clock.currentTimeMillis;
      Atom.batch(() => {
        options.store.dispatch({
          kind: "operation-recorded",
          requestId,
          intent: { kind: "mate-action", ...intent },
        });
        const ordinal = options.store.state().operations.size;
        for (const event of [
          { kind: "demand", demanded: true },
          { kind: "attempt" },
          { kind: "handshake" },
        ] as const)
          options.store.dispatch({ kind: "stream", key: scope, now, event });
        const generation = streamOf(options.store.state(), scope).generation;
        const id = mateActionRequestId(intent);
        options.store.dispatch({
          kind: "rows",
          scope,
          generation,
          method: "read",
          via: "mate-direct",
          rows: [
            {
              family: "mateActionRequest",
              id,
              value: { ...intent, requestId, ordinal },
              revision: { kind: "mate-link", sequence: ordinal },
            },
          ],
        });
        options.store.dispatch({
          kind: "stream",
          key: scope,
          now,
          event: { kind: "baseline-committed" },
        });
      });
      const answer = yield* Effect.exit(
        options.registry.run(environmentId, request(MATE_ACTIONS[action], input)),
      );
      if (closed)
        return yield* Effect.fail(
          new MateActionUnavailable({ message: "This account has closed." }),
        );
      if (Exit.isFailure(answer)) {
        const sourceError = Cause.findErrorOption(answer.cause);
        if (
          Option.isSome(sourceError) &&
          (isUnavailable(sourceError.value) || isUnregistered(sourceError.value))
        ) {
          options.store.dispatch({
            kind: "operation-unsent",
            requestId,
            reason: sourceError.value.message,
          });
          return yield* Effect.failCause(answer.cause);
        }
        const refused =
          Option.isSome(sourceError) &&
          (isCrewCommandError(sourceError.value) ||
            isLoginError(sourceError.value) ||
            isTerminalError(sourceError.value));
        const fault = refused
          ? {
              outcome: "definitive-refusal" as const,
              message:
                sourceError.value instanceof Error
                  ? sourceError.value.message
                  : String(sourceError.value),
            }
          : workspaceFailure(Cause.squash(answer.cause));
        if (fault.outcome !== "definitive-refusal") {
          options.store.dispatch({ kind: "operation-uncertain", requestId, reason: fault.message });
          options.store.dispatch({
            kind: "operation-exhausted",
            requestId,
            unobservable: {
              nextActor: "person",
              nextAction: "Check the Mate before trying this action again.",
              reason: "The Mate does not retain this request id.",
            },
          });
        } else
          options.store.dispatch({
            kind: "operation-receipt",
            receipt: {
              requestId,
              operationId: requestId,
              executor: "mate",
              affected: [],
              handles: [],
              acceptance: { kind: "refused", reason: fault.message },
              outcome: { kind: "pending" },
            },
          });
        return yield* Effect.failCause(answer.cause);
      }
      const value = answer.value;
      const handles =
        typeof value === "object" &&
        value !== null &&
        "terminalId" in value &&
        typeof value.terminalId === "string"
          ? [value.terminalId]
          : [];
      options.store.dispatch({
        kind: "operation-receipt",
        receipt: {
          requestId,
          operationId: requestId,
          executor: "mate",
          affected: [],
          handles,
          acceptance: {
            kind: "accepted",
            result: { value: value as MateActionResult<MateAction> },
          },
          outcome:
            action === "standUpRetry" && setupContext !== undefined && value === true
              ? { kind: "pending" }
              : { kind: "succeeded", evidence: "The Mate answered this command." },
        },
      });
      if (
        action === "standUpRetry" &&
        setupContext !== undefined &&
        value === true &&
        options.setup !== undefined
      ) {
        const release = options.setup.demand(setupContext.orgId, setupContext.origin);
        observing.set(requestId, release);
        options.setup.refresh(setupContext.origin);
      }
      options.revalidate(action, environmentId);
      return value;
    });
  return {
    execute,
    check: (
      environmentId: EnvironmentId,
      input: EnvironmentRpcInput<typeof WS_METHODS.zeropsAgentAuthCheck>,
    ) =>
      Effect.gen(function* () {
        if (closed)
          return yield* Effect.fail(
            new MateActionUnavailable({ message: "This account has closed." }),
          );
        const answer = yield* options.registry.run(
          environmentId,
          request(WS_METHODS.zeropsAgentAuthCheck, input),
        );
        if (closed)
          return yield* Effect.fail(
            new MateActionUnavailable({ message: "This account has closed." }),
          );
        options.revalidate("agentAuthCheck", environmentId);
        return answer;
      }),
    close: () => {
      closed = true;
      unlisten();
      for (const release of observing.values()) release();
      observing.clear();
    },
  };
}
