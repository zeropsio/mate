/**
 * A setting HQ answers in one read — the organization's keys, its Slack app, an application's
 * webhooks — read while a screen demands it, supervised by the common retry and refusal policy, and
 * read again when asked (`again`, after a write of ours). Each read started has its number, which
 * the committed value's revision carries: a write's answer names the last read started before it
 * (`started`), so whoever waits for the write to show knows the read that can show it.
 *
 * An HQ with no such address (`404`), or a client whose HQ has no such call, keeps no such setting:
 * the read is refused with `SETTING_UNSUPPORTED`, which nothing retries.
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import { HqError } from "../../zerops/hq/client.ts";
import { SETTING_UNSUPPORTED } from "../families/hqAutomation.ts";
import type { Family, FamilyValues, LinkKey, ScopeKey } from "../model.ts";
import { streamOf } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink, type LinkSupervisor } from "../supervisor.ts";
import { credentialFailure } from "./hqGitCredentialReads.ts";

export interface SettingRead<F extends Family> {
  readonly family: F;
  readonly id: string;
  readonly scope: ScopeKey;
  readonly link: LinkKey;
  /** HQ's answer; `undefined` where this client's HQ has no such call. */
  readonly read: () => Promise<FamilyValues[F]> | undefined;
  /** What the refusal says where HQ keeps no such setting. */
  readonly unsupported: string;
}

interface Reading {
  count: number;
  /** Read again at the next turn: set by `again`, cleared as a read starts. */
  again: boolean;
  /** Reads started, the last one's number: the revision its value commits with. */
  started: number;
  wake?: () => void;
  supervisor?: LinkSupervisor;
  fiber?: Fiber.Fiber<never>;
}

export function makeSettingsReads(store: AccountStore) {
  let closed = false;
  const signal = (key: LinkKey | ScopeKey, event: StreamEvent) =>
    Effect.map(Clock.currentTimeMillis, (at) =>
      store.dispatch({ kind: "stream", key, now: at, event }),
    );
  const readings = new Map<string, Reading>();
  const factOf = (spec: SettingRead<Family>) =>
    store.state().facts.get(`${spec.family}:${spec.id}`);
  const keyOf = (spec: SettingRead<Family>) => `${spec.family}:${spec.id}`;
  /** The number of the last read committed, or started before this lifetime's first. */
  const committed = (spec: SettingRead<Family>): number => {
    const revision = factOf(spec)?.revision;
    return revision?.kind === "mate-link" ? revision.sequence : 0;
  };

  const demand = <F extends Family>(spec: SettingRead<F>): (() => void) => {
    if (closed) return () => {};
    const key = keyOf(spec);
    let entry = readings.get(key);
    if (entry !== undefined) entry.count++;
    else {
      const made: Reading = { count: 1, again: true, started: committed(spec) };
      made.fiber = Effect.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const changes = yield* Queue.unbounded<void>();
            const supervisor = yield* superviseLink({
              store,
              key: spec.link,
              scopes: [spec.scope],
              repairSession: Effect.fail({
                outcome: "definitive-refusal",
                message: "Sign in to HQ again.",
              } satisfies StreamFault),
              attempt: () =>
                Effect.gen(function* () {
                  yield* Queue.clear(changes);
                  yield* signal(spec.link, { kind: "handshake" });
                  while (true) {
                    yield* signal(spec.scope, { kind: "attempt" });
                    yield* signal(spec.scope, { kind: "handshake" });
                    const generation = streamOf(store.state(), spec.scope).generation;
                    if (factOf(spec)?.content.kind !== "value" || made.again) {
                      made.again = false;
                      const number = ++made.started;
                      const unsupported = new HqError({
                        kind: "refused",
                        code: SETTING_UNSUPPORTED,
                        message: spec.unsupported,
                      });
                      const answer = yield* Effect.result(
                        Effect.tryPromise({
                          try: () => spec.read() ?? Promise.reject(unsupported),
                          catch: (cause) =>
                            cause === unsupported ||
                            (cause instanceof HqError && cause.status === 404)
                              ? ({
                                  outcome: "definitive-refusal",
                                  message: spec.unsupported,
                                  code: SETTING_UNSUPPORTED,
                                } satisfies StreamFault)
                              : credentialFailure(cause),
                        }),
                      );
                      if (closed || readings.get(key) !== made) return yield* Effect.never;
                      if (streamOf(store.state(), spec.scope).generation !== generation) {
                        yield* Queue.take(changes);
                        continue;
                      }
                      if (Result.isFailure(answer)) {
                        if (answer.failure.outcome === "authoritative-denial")
                          store.dispatch({
                            kind: "access",
                            family: spec.family,
                            id: spec.id,
                            access: "denied",
                          });
                        return yield* Effect.fail(answer.failure);
                      }
                      store.dispatch({ kind: "baseline-begin", scope: spec.scope, generation });
                      store.dispatch({
                        kind: "baseline-commit",
                        scope: spec.scope,
                        generation,
                        via: "hq-stream",
                        members: [spec.id],
                        rows: [
                          {
                            family: spec.family,
                            id: spec.id,
                            value: answer.success,
                            revision: { kind: "mate-link", sequence: number },
                          } as never,
                        ],
                      });
                    }
                    yield* signal(spec.scope, { kind: "baseline-committed" });
                    yield* signal(spec.link, { kind: "baseline-committed" });
                    // Asked again while reading: read once more before resting.
                    if (!made.again) yield* Queue.take(changes);
                  }
                }),
            });
            made.supervisor = supervisor;
            made.wake = () => {
              const phase = streamOf(store.state(), spec.link).phase;
              if (["refused", "recovering", "paused"].includes(phase))
                Effect.runFork(supervisor.signal("manual-retry"));
              else {
                Effect.runSync(signal(spec.scope, { kind: "attempt" }));
                Queue.offerUnsafe(changes, undefined);
              }
            };
            return yield* supervisor.run;
          }),
        ),
      );
      entry = made;
      readings.set(key, made);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = readings.get(key);
      if (held === undefined || --held.count > 0) return;
      readings.delete(key);
      if (held.supervisor) Effect.runSync(held.supervisor.release);
      if (held.fiber) Effect.runFork(Fiber.interrupt(held.fiber));
    };
  };

  const again = <F extends Family>(spec: SettingRead<F>) => {
    const entry = readings.get(keyOf(spec));
    if (entry === undefined || closed) return;
    entry.again = true;
    entry.wake?.();
  };

  return {
    demand,
    again,
    /**
     * The last read started of a setting: one that lands with a greater number started after
     * now. Taken before `readAfterWrite`, it names the reads a write's answer may predate.
     */
    started: <F extends Family>(spec: SettingRead<F>): number =>
      readings.get(keyOf(spec))?.started ?? committed(spec),
    /**
     * Our own write's effect is read from HQ: the setting is held and read again until it
     * answers, then let go unless a screen still demands it.
     */
    readAfterWrite: <F extends Family>(spec: SettingRead<F>) => {
      if (closed) return;
      const release = demand(spec);
      again(spec);
      const stop = store.subscribe(() => {
        const phase = streamOf(store.state(), spec.scope).phase;
        if (!["live", "refused", "recovering"].includes(phase)) return;
        stop();
        release();
      });
    },
    close: () => {
      closed = true;
      for (const entry of readings.values()) {
        if (entry.supervisor) Effect.runSync(entry.supervisor.release);
        if (entry.fiber) Effect.runFork(Fiber.interrupt(entry.fiber));
      }
      readings.clear();
    },
  };
}

export type SettingsReads = ReturnType<typeof makeSettingsReads>;

/**
 * One value of a screen's own — a write's request, what HQ answered it — committed whole under its
 * own scope: no read can fail or be refused, so its absence is that nothing was written from here.
 */
export function commitOwn<F extends Family>(
  store: AccountStore,
  family: F,
  scope: ScopeKey,
  id: string,
  value: FamilyValues[F],
): void {
  const at = Effect.runSync(Clock.currentTimeMillis);
  for (const event of [
    { kind: "demand", demanded: true },
    { kind: "attempt" },
    { kind: "handshake" },
  ] as const)
    store.dispatch({ kind: "stream", key: scope, now: at, event });
  const generation = streamOf(store.state(), scope).generation;
  const prior = store.state().facts.get(`${family}:${id}`)?.revision;
  const sequence = prior?.kind === "mate-link" ? prior.sequence + 1 : 1;
  store.dispatch({ kind: "baseline-begin", scope, generation });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation,
    via: "hq-stream",
    members: [id],
    rows: [{ family, id, value, revision: { kind: "mate-link", sequence } } as never],
  });
  store.dispatch({ kind: "stream", key: scope, now: at, event: { kind: "baseline-committed" } });
}
