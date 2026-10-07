/** Mate workspace samples share account demand and the common retry/refusal supervisor. */
import { EnvironmentAuthorizationError } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { workspaceReading } from "../projections/mateWorkspace.ts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Cause from "effect/Cause";
import * as Queue from "effect/Queue";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { request } from "../../rpc/client.ts";
import {
  WORKSPACE_READS,
  workspaceId,
  workspaceScope,
  type WorkspaceRead,
  type WorkspaceTarget,
  type WorkspaceValue,
} from "../families/mateWorkspace.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { streamOf } from "../reducer.ts";
import { superviseLink, type LinkSupervisor } from "../supervisor.ts";
import type { LinkKey } from "../model.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";

const denied = Schema.is(EnvironmentAuthorizationError);
export function workspaceFailure(cause: unknown): StreamFault {
  const message =
    cause instanceof Error ? cause.message : "The Mate could not read this workspace detail.";
  if (
    typeof cause === "object" &&
    cause !== null &&
    "outcome" in cause &&
    "message" in cause &&
    typeof cause.message === "string" &&
    [
      "transient",
      "definitive-refusal",
      "authoritative-denial",
      "recoverable-session",
      "access-unverified",
    ].includes(String(cause.outcome))
  )
    return cause as StreamFault;
  if (denied(cause)) return { outcome: "authoritative-denial", message };
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    typeof cause._tag === "string" &&
    ![
      "RpcClientError",
      "EnvironmentRpcUnavailableError",
      "EnvironmentNotRegisteredError",
      "TimeoutError",
      "TimeoutException",
    ].includes(cause._tag)
  )
    return {
      outcome: "definitive-refusal",
      message,
      code:
        "failure" in cause && typeof cause.failure === "string"
          ? `${cause._tag}:${cause.failure}`
          : cause._tag,
    };
  return { outcome: "transient", message };
}
export interface WorkspaceWire {
  readonly read: <K extends WorkspaceRead>(
    kind: K,
    target: WorkspaceTarget<K>,
  ) => Effect.Effect<WorkspaceValue<K>, StreamFault>;
}
export const makeWorkspaceWire = (registry: EnvironmentRegistry["Service"]): WorkspaceWire => ({
  read: (kind, target) =>
    registry
      .run(target.environmentId, request(WORKSPACE_READS[kind].tag, target.input))
      .pipe(
        Effect.catchCause((cause) => Effect.fail(workspaceFailure(Cause.squash(cause)))),
      ) as Effect.Effect<WorkspaceValue<typeof kind>, StreamFault>,
});
interface Entry {
  count: number;
  kind: WorkspaceRead;
  environmentId: string;
  cwd?: string;
  wake?: () => void;
  supervisor?: LinkSupervisor;
  fiber?: Fiber.Fiber<never>;
  expiry?: Fiber.Fiber<void>;
}
export function makeWorkspaceReads(store: AccountStore, wire: WorkspaceWire) {
  let closed = false;
  const active = new Map<string, Entry>();
  const pending = new Set<() => void>();
  const signal = (key: LinkKey | import("../model.ts").ScopeKey, event: StreamEvent) =>
    Effect.map(Clock.currentTimeMillis, (now) =>
      store.dispatch({ kind: "stream", key, now, event }),
    );
  const demand = <K extends WorkspaceRead>(kind: K, target: WorkspaceTarget<K>, manual = false) => {
    if (closed) return () => {};
    const scope = workspaceScope(kind, target);
    const key: LinkKey = `mate:workspace-${encodeURIComponent(scope)}`;
    const id = workspaceId(target);
    const family = WORKSPACE_READS[kind].family;
    // A released URL may expire with no view present; its next demand cannot reuse it.
    if (kind === "assetUrl") {
      const fact = store.state().facts.get(`mateAssetUrl:${id}`);
      const now = Effect.runSync(Clock.currentTimeMillis);
      if (
        fact?.content.kind === "value" &&
        fact.access === "allowed" &&
        typeof fact.content.value === "object" &&
        fact.content.value !== null &&
        "expiresAt" in fact.content.value &&
        typeof fact.content.value.expiresAt === "number" &&
        fact.content.value.expiresAt <= now &&
        fact.revision.kind === "mate-link"
      ) {
        store.dispatch({
          kind: "rows",
          scope,
          generation: streamOf(store.state(), scope).generation,
          via: "mate-direct",
          method: "read",
          rows: [
            {
              family: "mateAssetUrl",
              id,
              value: { ...(fact.content.value as WorkspaceValue<"assetUrl">), expired: true },
              revision: { kind: "mate-link", sequence: fact.revision.sequence + 1 },
            },
          ],
        });
      }
    }
    let entry = active.get(scope);
    if (entry !== undefined) {
      entry.count++;
      if (manual) entry.wake?.();
    } else {
      if (manual) {
        Effect.runSync(signal(key, { kind: "manual-retry" }));
        Effect.runSync(signal(scope, { kind: "manual-retry" }));
      }
      const made: Entry = {
        count: 1,
        kind,
        environmentId: target.environmentId,
        ...("cwd" in target.input && typeof target.input.cwd === "string"
          ? { cwd: target.input.cwd }
          : {}),
      };
      active.set(scope, made);
      made.fiber = Effect.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const changes = yield* Queue.unbounded<void>();
            const supervisor: LinkSupervisor = yield* superviseLink({
              store,
              key,
              scopes: [scope],
              repairSession: Effect.fail({
                outcome: "definitive-refusal",
                message: "Reconnect to this Mate.",
              } satisfies StreamFault),
              attempt: () =>
                Effect.gen(function* () {
                  yield* Queue.clear(changes);
                  yield* signal(key, { kind: "handshake" });
                  while (true) {
                    yield* signal(scope, { kind: "attempt" });
                    yield* signal(scope, { kind: "handshake" });
                    const generation = streamOf(store.state(), scope).generation;
                    const answer = yield* Effect.result(wire.read(kind, target));
                    if (closed || active.get(scope) !== made) return yield* Effect.never;
                    if (streamOf(store.state(), scope).generation !== generation) {
                      yield* Queue.take(changes);
                      continue;
                    }
                    if (Result.isFailure(answer)) {
                      if (answer.failure.outcome === "authoritative-denial")
                        store.dispatch({ kind: "access", family, id, access: "denied" });
                      return yield* Effect.fail(answer.failure);
                    }
                    const value = answer.success;
                    if (made.expiry) {
                      yield* Fiber.interrupt(made.expiry);
                      delete made.expiry;
                    }
                    if (
                      kind === "assetUrl" &&
                      typeof value === "object" &&
                      value !== null &&
                      "expiresAt" in value &&
                      (typeof value.expiresAt !== "number" ||
                        !Number.isFinite(value.expiresAt) ||
                        value.expiresAt <= (yield* Clock.currentTimeMillis))
                    )
                      return yield* Effect.fail({
                        outcome: "transient",
                        message: "The Mate returned an expired signing.",
                      } satisfies StreamFault);
                    const prior = store.state().facts.get(`${family}:${id}`)?.revision;
                    const sequence = prior?.kind === "mate-link" ? prior.sequence + 1 : 1;
                    const partial =
                      typeof value === "object" &&
                      value !== null &&
                      "truncated" in value &&
                      value.truncated === true;
                    store.dispatch({ kind: "baseline-begin", scope, generation });
                    store.dispatch({
                      kind: "baseline-commit",
                      scope,
                      generation,
                      via: "mate-direct",
                      partial,
                      members: [id],
                      rows: [
                        {
                          family,
                          id,
                          value,
                          revision: { kind: "mate-link", sequence },
                        } as import("../reducer.ts").Row,
                      ],
                    });
                    yield* signal(scope, { kind: "baseline-committed" });
                    yield* signal(key, { kind: "baseline-committed" });
                    // URL lifetime belongs to the owner, never to a screen cache window.
                    if (
                      kind === "assetUrl" &&
                      typeof value === "object" &&
                      value !== null &&
                      "expiresAt" in value &&
                      typeof value.expiresAt === "number"
                    ) {
                      const expiresAt = value.expiresAt;
                      const now = yield* Clock.currentTimeMillis;
                      if (Number.isFinite(expiresAt) && expiresAt > now) {
                        made.expiry = Effect.runFork(
                          Effect.sleep(expiresAt - now).pipe(
                            Effect.andThen(
                              Effect.gen(function* () {
                                if (closed || active.get(scope) !== made) return;
                                const current = store.state().facts.get(`${family}:${id}`);
                                if (
                                  current?.content.kind !== "value" ||
                                  current.access !== "allowed" ||
                                  current.revision.kind !== "mate-link" ||
                                  current.revision.sequence !== sequence
                                )
                                  return;
                                store.dispatch({
                                  kind: "rows",
                                  scope,
                                  generation: streamOf(store.state(), scope).generation,
                                  method: "read",
                                  via: "mate-direct",
                                  rows: [
                                    {
                                      family: "mateAssetUrl",
                                      id,
                                      value: {
                                        ...(value as unknown as WorkspaceValue<"assetUrl">),
                                        expired: true,
                                      },
                                      revision: { kind: "mate-link", sequence: sequence + 1 },
                                    },
                                  ],
                                });
                                if (
                                  streamOf(store.state(), key).phase === "live" &&
                                  streamOf(store.state(), scope).phase === "live"
                                ) {
                                  yield* signal(scope, { kind: "attempt" });
                                  yield* Queue.offer(changes, undefined);
                                }
                              }),
                            ),
                          ),
                        );
                      }
                    }
                    yield* Queue.take(changes);
                  }
                }),
            });
            made.supervisor = supervisor;
            made.wake = () => {
              const phase = streamOf(store.state(), key).phase;
              if (["refused", "recovering", "paused"].includes(phase))
                Effect.runFork(supervisor.signal("manual-retry"));
              else {
                Effect.runSync(signal(scope, { kind: "attempt" }));
                Queue.offerUnsafe(changes, undefined);
              }
            };
            return yield* supervisor.run;
          }),
        ),
      );
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = active.get(scope);
      if (held === undefined || --held.count > 0) return;
      active.delete(scope);
      if (held.supervisor) Effect.runSync(held.supervisor.release);
      if (held.fiber) Effect.runFork(Fiber.interrupt(held.fiber));
      if (held.expiry) Effect.runFork(Fiber.interrupt(held.expiry));
    };
  };
  const sample = <K extends WorkspaceRead>(kind: K, target: WorkspaceTarget<K>) =>
    new Promise<
      | AsyncResult.Success<WorkspaceValue<K>, StreamFault>
      | AsyncResult.Failure<WorkspaceValue<K>, StreamFault>
    >((resolve) => {
      const scope = workspaceScope(kind, target);
      const before = streamOf(store.state(), scope).generation;
      let release = () => {};
      const stop = store.subscribe(() => check());
      const projection = workspaceReading(kind);
      const check = () => {
        if (closed) {
          pending.delete(check);
          stop();
          release();
          resolve(
            AsyncResult.fail({
              outcome: "definitive-refusal",
              message: "This account is no longer active.",
            }),
          );
          return;
        }
        const state = streamOf(store.state(), scope);
        if (state.generation <= before || !["live", "recovering", "refused"].includes(state.phase))
          return;
        const result = projection.derive(readsOfState(store.state()), target).result;
        if (result._tag === "Initial" || result.waiting) return;
        pending.delete(check);
        stop();
        release();
        resolve(result);
      };
      pending.add(check);
      release = demand(kind, target, true);
      check();
    });
  return {
    demand,
    sample,
    invalidateRefs: (environmentId: string, cwd: string) => {
      for (const entry of active.values())
        if (entry.kind === "refs" && entry.environmentId === environmentId && entry.cwd === cwd)
          entry.wake?.();
    },
    mcpAnswer: (target: WorkspaceTarget<"mcp">, value: WorkspaceValue<"mcp">) => {
      if (closed) return;
      const scope = workspaceScope("mcp", target);
      const id = workspaceId(target);
      Effect.runSync(signal(scope, { kind: "demand", demanded: true }));
      Effect.runSync(signal(scope, { kind: "input-changed" }));
      Effect.runSync(signal(scope, { kind: "attempt" }));
      Effect.runSync(signal(scope, { kind: "handshake" }));
      const generation = streamOf(store.state(), scope).generation;
      const prior = store.state().facts.get(`mateMcpServers:${id}`)?.revision;
      const sequence = prior?.kind === "mate-link" ? prior.sequence + 1 : 1;
      store.dispatch({ kind: "baseline-begin", scope, generation });
      store.dispatch({
        kind: "baseline-commit",
        scope,
        generation,
        via: "mate-direct",
        members: [id],
        rows: [{ family: "mateMcpServers", id, value, revision: { kind: "mate-link", sequence } }],
      });
      Effect.runSync(signal(scope, { kind: "baseline-committed" }));
    },
    again: <K extends WorkspaceRead>(kind: K, target: WorkspaceTarget<K>) => {
      const held = active.get(workspaceScope(kind, target));
      held?.wake?.();
    },
    close: () => {
      closed = true;
      for (const check of pending) check();
      for (const held of active.values()) {
        if (held.supervisor) Effect.runSync(held.supervisor.release);
        if (held.fiber) Effect.runFork(Fiber.interrupt(held.fiber));
        if (held.expiry) Effect.runFork(Fiber.interrupt(held.expiry));
      }
      active.clear();
    },
  };
}
