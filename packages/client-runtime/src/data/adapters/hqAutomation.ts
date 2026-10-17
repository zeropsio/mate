/**
 * The settings for automated Mates, as the account holds them: the organization's API keys, read
 * while a screen demands them (supervised by the common retry and refusal policy) and again after
 * each write of ours; the writes themselves, through their own coordinator; and an application's
 * intake answer, held while the screen that set it is open — a secret to paste is shown once, so
 * closing that screen forgets it, and nothing else ever holds it.
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import type { HqIntakeView } from "@t3tools/shared/hqIntake";
import { HqError, type HqApi } from "../../zerops/hq/client.ts";
import {
  AI_KEYS_UNSUPPORTED,
  aiKeyRequestScope,
  aiKeysId,
  aiKeysLink,
  aiKeysScope,
  intakeId,
  intakeRevealScope,
  type AiKeysKey,
  type IntakeKey,
} from "../families/hqAutomation.ts";
import type { LinkKey } from "../model.ts";
import { makeOperations } from "../operations/coordinator.ts";
import {
  makeAutomationExecutor,
  type AutomationWrites,
} from "../operations/executors/hqAutomation.ts";
import { streamOf } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink, type LinkSupervisor } from "../supervisor.ts";
import { credentialFailure } from "./hqGitCredentialReads.ts";

type AutomationApi = AutomationWrites & Pick<HqApi, "aiKeys">;

const UNSUPPORTED = new HqError({
  kind: "refused",
  code: AI_KEYS_UNSUPPORTED,
  message: "Update HQ to set up automated Mates.",
});

interface KeyReads {
  count: number;
  again: boolean;
  wake?: () => void;
  supervisor?: LinkSupervisor;
  fiber?: Fiber.Fiber<never>;
}

export function makeAutomationSettings(options: {
  readonly store: AccountStore;
  readonly api: AutomationApi;
  readonly makeId: () => string;
}) {
  const { store, api } = options;
  let closed = false;
  const now = () => Effect.runSync(Clock.currentTimeMillis);
  const signal = (key: LinkKey | ReturnType<typeof aiKeysScope>, event: StreamEvent) =>
    Effect.map(Clock.currentTimeMillis, (at) =>
      store.dispatch({ kind: "stream", key, now: at, event }),
    );

  // ── the organization's keys, read on demand ────────────────────────────────────────────────
  const reads = new Map<string, KeyReads>();
  const demandKeys = (key: AiKeysKey): (() => void) => {
    if (closed) return () => {};
    const id = aiKeysId(key);
    let entry = reads.get(id);
    if (entry !== undefined) entry.count++;
    else {
      const made: KeyReads = { count: 1, again: true };
      const scope = aiKeysScope(key);
      const link = aiKeysLink(key);
      const prior = store.state().facts.get(`hqAiKeys:${id}`)?.revision;
      let sequence = prior?.kind === "mate-link" ? prior.sequence : 0;
      made.fiber = Effect.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const changes = yield* Queue.unbounded<void>();
            const supervisor = yield* superviseLink({
              store,
              key: link,
              scopes: [scope],
              repairSession: Effect.fail({
                outcome: "definitive-refusal",
                message: "Sign in to HQ again.",
              } satisfies StreamFault),
              attempt: () =>
                Effect.gen(function* () {
                  yield* Queue.clear(changes);
                  yield* signal(link, { kind: "handshake" });
                  while (true) {
                    yield* signal(scope, { kind: "attempt" });
                    yield* signal(scope, { kind: "handshake" });
                    const generation = streamOf(store.state(), scope).generation;
                    const held = store.state().facts.get(`hqAiKeys:${id}`);
                    if (held?.content.kind !== "value" || made.again) {
                      const answer = yield* Effect.result(
                        Effect.tryPromise({
                          try: () =>
                            api.aiKeys === undefined ? Promise.reject(UNSUPPORTED) : api.aiKeys(),
                          catch: (cause) =>
                            // An HQ with no such address keeps no organization keys: it predates
                            // automated Mates, which nothing then offers.
                            cause === UNSUPPORTED ||
                            (cause instanceof HqError && cause.status === 404)
                              ? ({
                                  outcome: "definitive-refusal",
                                  message: UNSUPPORTED.message,
                                  code: AI_KEYS_UNSUPPORTED,
                                } satisfies StreamFault)
                              : credentialFailure(cause),
                        }),
                      );
                      if (closed || reads.get(id) !== made) return yield* Effect.never;
                      if (streamOf(store.state(), scope).generation !== generation) {
                        yield* Queue.take(changes);
                        continue;
                      }
                      if (Result.isFailure(answer)) {
                        if (answer.failure.outcome === "authoritative-denial")
                          store.dispatch({
                            kind: "access",
                            family: "hqAiKeys",
                            id,
                            access: "denied",
                          });
                        return yield* Effect.fail(answer.failure);
                      }
                      made.again = false;
                      store.dispatch({ kind: "baseline-begin", scope, generation });
                      store.dispatch({
                        kind: "baseline-commit",
                        scope,
                        generation,
                        via: "hq-stream",
                        members: [id],
                        rows: [
                          {
                            family: "hqAiKeys",
                            id,
                            value: answer.success,
                            revision: { kind: "mate-link", sequence: ++sequence },
                          },
                        ],
                      });
                    }
                    yield* signal(scope, { kind: "baseline-committed" });
                    yield* signal(link, { kind: "baseline-committed" });
                    yield* Queue.take(changes);
                  }
                }),
            });
            made.supervisor = supervisor;
            made.wake = () => {
              const phase = streamOf(store.state(), link).phase;
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
      entry = made;
      reads.set(id, made);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = reads.get(id);
      if (held === undefined || --held.count > 0) return;
      reads.delete(id);
      if (held.supervisor) Effect.runSync(held.supervisor.release);
      if (held.fiber) Effect.runFork(Fiber.interrupt(held.fiber));
    };
  };
  const againKeys = (key: AiKeysKey) => {
    const entry = reads.get(aiKeysId(key));
    if (entry === undefined || closed) return;
    entry.again = true;
    entry.wake?.();
  };
  /** Our own write's effect is read from HQ: the list is held and read again until it answers. */
  const readAfterWrite = (key: AiKeysKey) => {
    const release = demandKeys(key);
    againKeys(key);
    const scope = aiKeysScope(key);
    const stop = store.subscribe(() => {
      const phase = streamOf(store.state(), scope).phase;
      if (!["live", "refused", "recovering"].includes(phase)) return;
      stop();
      release();
    });
  };

  // ── an intake's answer, held while its screen is open ─────────────────────────────────────
  const views = new Map<string, number>();
  const epochs = new Map<string, number>();
  const revealedFor = new Map<string, { readonly key: IntakeKey; readonly epoch: number }>();
  /** One value of this screen's own, committed whole under its own scope. */
  const commit = <F extends "hqIntakeReveal" | "hqAiKeyRequest">(
    family: F,
    scope: ReturnType<typeof intakeRevealScope>,
    id: string,
    value: import("../model.ts").FamilyValues[F],
  ) => {
    if (closed) return;
    const at = now();
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
  };
  const publish = (key: IntakeKey, requestId: string, view: HqIntakeView | null) =>
    commit("hqIntakeReveal", intakeRevealScope(key), intakeId(key), { requestId, view });
  // ── the writes ────────────────────────────────────────────────────────────────────────────
  const values = new Map<string, string>();
  const operations = makeOperations({
    store,
    makeId: options.makeId,
    executors: {
      hq: makeAutomationExecutor({
        api,
        current: () => !closed,
        takeValue: (requestId) => {
          const value = values.get(requestId);
          values.delete(requestId);
          return value;
        },
        revealed: (requestId, view) => {
          const held = revealedFor.get(requestId);
          if (
            held !== undefined &&
            (views.get(intakeId(held.key)) ?? 0) > 0 &&
            held.epoch === (epochs.get(intakeId(held.key)) ?? 0)
          )
            publish(held.key, requestId, view);
        },
      }),
    },
  });
  const run = (intent: Parameters<typeof operations.submit>[0], requestId: string) =>
    Effect.runPromise(operations.submit(intent, requestId)).then(() => requestId);

  return {
    demandKeys,
    againKeys,
    /** Keeps the organization's key for a provider; its value goes to the executor alone. */
    setKey: async (key: AiKeysKey, provider: string, value: string): Promise<string> => {
      const requestId = options.makeId();
      values.set(requestId, value);
      commit("hqAiKeyRequest", aiKeyRequestScope(key), aiKeysId(key), { requestId });
      try {
        return await run({ kind: "set-ai-key", orgId: key.orgId, provider }, requestId);
      } finally {
        values.delete(requestId);
        if (!closed) readAfterWrite(key);
      }
    },
    removeKey: async (key: AiKeysKey, provider: string): Promise<string> => {
      const requestId = options.makeId();
      commit("hqAiKeyRequest", aiKeyRequestScope(key), aiKeysId(key), { requestId });
      try {
        return await run({ kind: "remove-ai-key", orgId: key.orgId, provider }, requestId);
      } finally {
        if (!closed) readAfterWrite(key);
      }
    },
    /** While a screen shows an application's intake: what HQ answered from it stays shown. */
    holdIntake: (key: IntakeKey): (() => void) => {
      const id = intakeId(key);
      views.set(id, (views.get(id) ?? 0) + 1);
      return () => {
        const count = (views.get(id) ?? 1) - 1;
        views.set(id, count);
        if (count > 0 || closed) return;
        epochs.set(id, (epochs.get(id) ?? 0) + 1);
        const fact = store.state().facts.get(`hqIntakeReveal:${id}`);
        if (fact?.content.kind === "value") {
          const held = fact.content.value as { readonly requestId: string };
          publish(key, held.requestId, null);
        }
      };
    },
    setIntake: async (key: IntakeKey, repo: string, label: string): Promise<string> => {
      const requestId = options.makeId();
      const id = intakeId(key);
      revealedFor.set(requestId, { key, epoch: epochs.get(id) ?? 0 });
      publish(key, requestId, null);
      try {
        return await run({ kind: "set-intake", ...key, repo, label }, requestId);
      } finally {
        revealedFor.delete(requestId);
      }
    },
    stopIntake: async (key: IntakeKey): Promise<string> => {
      const requestId = options.makeId();
      publish(key, requestId, null);
      return run({ kind: "stop-intake", ...key }, requestId);
    },
    close: () => {
      if (closed) return;
      for (const id of views.keys()) {
        const fact = store.state().facts.get(`hqIntakeReveal:${id}`);
        if (fact?.content.kind === "value") {
          const [orgId, appId] = JSON.parse(id) as [string, string];
          const held = fact.content.value as { readonly requestId: string };
          publish({ orgId, appId }, held.requestId, null);
        }
      }
      closed = true;
      values.clear();
      revealedFor.clear();
      views.clear();
      epochs.clear();
      for (const entry of reads.values()) {
        if (entry.supervisor) Effect.runSync(entry.supervisor.release);
        if (entry.fiber) Effect.runFork(Fiber.interrupt(entry.fiber));
      }
      reads.clear();
    },
  };
}

export type AutomationSettings = ReturnType<typeof makeAutomationSettings>;
