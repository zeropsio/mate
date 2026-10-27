import {
  EnvironmentAuthorizationError,
  ZeropsMateUpdateError,
  WS_METHODS,
  type EnvironmentId,
  type ExecutionEnvironmentUpdate,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import { request } from "../../rpc/client.ts";
import { updateAvailabilityScope, updateRequestScope } from "../families/mateUpdate.ts";
import { streamOf, type Row } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { STREAM_POLICY, type StreamEvent } from "../streamMachine.ts";
import { makeOperations } from "../operations/coordinator.ts";
import { makeMateUpdateExecutor } from "../operations/executors/mateUpdate.ts";
import { updateOutcome, updateServer, type UpdateServer } from "../operations/mateUpdate.ts";

const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);
const isUpdateError = Schema.is(ZeropsMateUpdateError);

/**
 * How long a press waits for its Mate's link before it is not sent: twice the p90 of an open as
 * measured (15 s), the bound every Mate action's lease waits (`MATE_HOLD_WAIT_MS`).
 */
export const MATE_UPDATE_CONNECT_WAIT_MS = 30_000;

/** Waits, bounded, until the held Mate's link is up; a press made outside its view finds it down. */
const linkUp = (waitMs: number) =>
  Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor;
    yield* SubscriptionRef.changes(supervisor.session).pipe(
      Stream.filter(Option.isSome),
      Stream.take(1),
      Stream.runDrain,
      Effect.timeoutOption(waitMs),
    );
  });

export const makeMateUpdateWire = (
  registry: EnvironmentRegistry["Service"],
  options: { readonly connectWaitMs?: number } = {},
) => ({
  update: (environmentId: EnvironmentId) =>
    registry.run(
      environmentId,
      linkUp(options.connectWaitMs ?? MATE_UPDATE_CONNECT_WAIT_MS).pipe(
        Effect.andThen(
          request(WS_METHODS.zeropsMateUpdate, {}).pipe(
            Effect.timeout(STREAM_POLICY.baselineTimeoutMs),
          ),
        ),
      ),
    ),
  check: (environmentId: EnvironmentId) =>
    registry
      .run(environmentId, request(WS_METHODS.zeropsMateCheckUpdate, {}))
      .pipe(Effect.timeout(STREAM_POLICY.baselineTimeoutMs)),
});
export interface MateUpdateHost {
  readonly update: (
    environmentId: EnvironmentId,
    server: UpdateServer,
    to: string,
    containerKey: string | null,
  ) => Promise<void>;
  readonly check: (
    environmentId: EnvironmentId,
  ) => Promise<ExecutionEnvironmentUpdate | null | undefined>;
  readonly observe: (environmentId: EnvironmentId, server: UpdateServer | null) => void;
  readonly close: () => void;
}
export function makeMateUpdates(options: {
  readonly store: AccountStore;
  readonly wire: ReturnType<typeof makeMateUpdateWire>;
  readonly isCurrent: () => boolean;
  readonly demand?: (environmentId: EnvironmentId) => () => void;
  readonly makeId: () => string;
}): MateUpdateHost {
  const { store, wire } = options;
  let closed = false;
  const current = () => !closed && options.isCurrent();
  const signal = (scope: ReturnType<typeof updateAvailabilityScope>, event: StreamEvent) =>
    store.dispatch({
      kind: "stream",
      key: scope,
      event,
      now: Effect.runSync(Clock.currentTimeMillis),
    });
  const publish = (scope: ReturnType<typeof updateAvailabilityScope>, row: Row) => {
    signal(scope, { kind: "demand", demanded: true });
    signal(scope, { kind: "attempt" });
    signal(scope, { kind: "handshake" });
    const generation = streamOf(store.state(), scope).generation;
    store.dispatch({ kind: "baseline-begin", scope, generation });
    store.dispatch({
      kind: "baseline-commit",
      scope,
      generation,
      via: "mate-direct",
      members: [row.id],
      rows: [row],
    });
    signal(scope, { kind: "baseline-committed" });
  };
  const revision = (family: Row["family"], id: string) => {
    const prior = store.state().facts.get(`${family}:${id}`)?.revision;
    return {
      kind: "mate-link" as const,
      sequence: prior?.kind === "mate-link" ? prior.sequence + 1 : 1,
    };
  };
  const observe = (environmentId: string, server: UpdateServer | null) => {
    if (!current()) return;
    const ref = readsOfState(store.state()).fact("mateUpdateRequest", environmentId);
    if (ref.kind !== "known" || ref.value.requestId === null) return;
    const record = store.state().operations.get(ref.value.requestId);
    if (
      record?.intent.kind !== "mate-update" ||
      record.receipt?.acceptance.kind === "refused" ||
      (record.receipt !== null && record.receipt.outcome.kind !== "pending")
    )
      return;
    // While the send is pending, a different version may predate this press. Owner
    // acceptance, or a lost answer, is needed before its return can settle the receipt.
    if (
      record.receipt === null &&
      record.submission !== "uncertain" &&
      record.submission !== "uncertain-unasked"
    )
      return;
    const end = updateOutcome(record.intent, server);
    if (end === null) return;
    store.dispatch({
      kind: "operation-receipt",
      receipt: {
        requestId: record.requestId,
        operationId: record.requestId,
        executor: "mate",
        affected: [],
        handles: [],
        acceptance: {
          kind: "accepted",
          result: { alreadyCurrent: false, version: server!.serverVersion },
        },
        outcome:
          end.kind === "failed"
            ? { kind: "failed", evidence: end.reason }
            : { kind: "succeeded", evidence: `Mate returned on ${server!.serverVersion}.` },
      },
    });
  };
  const demands = new Map<string, () => void>();
  const stop = store.subscribe(() => {
    const reads = readsOfState(store.state());
    for (const environmentId of reads.index("mateUpdateRequests", "all"))
      observe(environmentId, updateServer(reads, environmentId));
    for (const [requestId, release] of demands) {
      const record = store.state().operations.get(requestId);
      if (
        record?.receipt !== null &&
        record?.receipt !== undefined &&
        (record.receipt.acceptance.kind === "refused" || record.receipt.outcome.kind !== "pending")
      ) {
        demands.delete(requestId);
        release();
      }
    }
  });
  const operations = makeOperations({
    store,
    makeId: options.makeId,
    executors: { mate: makeMateUpdateExecutor({ call: wire.update, isCurrent: current }) },
  });
  const checks = new Map<EnvironmentId, Promise<ExecutionEnvironmentUpdate | null | undefined>>();
  return {
    observe,
    async update(environmentId, server, to, containerKey) {
      if (!current()) return;
      const previous = readsOfState(store.state()).fact("mateUpdateRequest", environmentId);
      if (previous.kind === "known" && previous.value.requestId !== null) {
        const record = store.state().operations.get(previous.value.requestId);
        if (
          record === undefined ||
          (record.receipt?.acceptance.kind !== "refused" &&
            (record.receipt === null || record.receipt.outcome.kind === "pending"))
        )
          return;
      }
      if (checks.has(environmentId)) return;
      const requestId = options.makeId();
      publish(updateRequestScope(environmentId), {
        family: "mateUpdateRequest",
        id: environmentId,
        value: { requestId, containerKey },
        revision: revision("mateUpdateRequest", environmentId),
      });
      // Observation starts before the call: the restart may lose the answer entirely.
      if (options.demand !== undefined) demands.set(requestId, options.demand(environmentId));
      await Effect.runPromise(
        operations.submit(
          {
            kind: "mate-update",
            environmentId,
            from: server.serverVersion,
            bootId: server.bootId,
            to,
          },
          requestId,
        ),
      );
    },
    check(environmentId) {
      if (!current()) return Promise.resolve(undefined);
      const prior = checks.get(environmentId);
      if (prior !== undefined) return prior;
      const latest = readsOfState(store.state()).fact("mateUpdateRequest", environmentId);
      if (latest.kind === "known" && latest.value.requestId !== null) {
        const record = store.state().operations.get(latest.value.requestId);
        if (
          record === undefined ||
          record.receipt === null ||
          record.receipt.outcome.kind === "pending"
        )
          return Promise.resolve(undefined);
        publish(updateRequestScope(environmentId), {
          family: "mateUpdateRequest",
          id: environmentId,
          value: { ...latest.value, requestId: null },
          revision: revision("mateUpdateRequest", environmentId),
        });
      }
      const scope = updateAvailabilityScope(environmentId);
      signal(scope, { kind: "demand", demanded: true });
      signal(scope, { kind: "manual-retry" });
      signal(scope, { kind: "handshake" });
      const read = Effect.runPromise(
        wire.check(environmentId).pipe(
          Effect.matchCause({
            onFailure: (cause) => {
              if (!current()) return undefined;
              const error = Cause.squash(cause);
              const authoritative = isAuthorizationError(error);
              signal(scope, {
                kind: "fault",
                jitter: 0,
                fault: {
                  outcome: authoritative
                    ? "authoritative-denial"
                    : isUpdateError(error)
                      ? "definitive-refusal"
                      : "transient",
                  message:
                    error instanceof Error && !/SocketCloseError|1006/.test(error.message)
                      ? error.message
                      : "This Mate is not reachable right now. Check the connection again.",
                },
              });
              if (authoritative)
                store.dispatch({
                  kind: "access",
                  family: "mateUpdateAvailability",
                  id: environmentId,
                  access: "denied",
                });
              return undefined;
            },
            onSuccess: (value) => {
              if (!current()) return undefined;
              publish(scope, {
                family: "mateUpdateAvailability",
                id: environmentId,
                value,
                revision: revision("mateUpdateAvailability", environmentId),
              });
              return value;
            },
          }),
        ),
      ).finally(() => checks.delete(environmentId));
      checks.set(environmentId, read);
      return read;
    },
    close() {
      closed = true;
      stop();
      for (const release of demands.values()) release();
      demands.clear();
    },
  };
}
