/**
 * ZeropsChiefRestart — a moved Chief mark reaches zcp (spec-mate §2.11, §3.11, TC-18).
 *
 * zcp reads the organisation's Chief mark once, when it starts, and runs inside each provider
 * session. So when HQ's `state` names a Chief other than the last one this process heard
 * (`ZeropsHqLink`'s `chief`), every conversation the engine holds is told to rotate its session
 * (`RotateSession{reason:"chief", fresh:false}`, through `MateEngineService.deliver`). The engine
 * closes the session between turns, never under a running one, and opens the next resuming the
 * same thread, with a fresh zcp. A rotation does not wait for the agent's background work: that
 * work ends as lost (`decide.rotate.test.ts`).
 *
 * The first state a process hears restarts nothing: its sessions were spawned after it started.
 * Each delivery carries `chief:<conversation>:<new chief>`, so a delivery told again is answered by
 * its receipt. A conversation that refuses (archived) or cannot record now is passed over.
 *
 * It reads and writes nothing of the engine itself: `ZeropsHqLink`, a wiring file, binds it to the
 * Mate's engine (the engine boundary, `scripts/mate-zone-architecture.test.ts`).
 *
 * @module ZeropsChiefRestart
 */
import {
  CommandId,
  type ConversationId,
  type Principal,
  type RotateSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

/** What the restart reads and does: the Mate engine's `conversations` and `deliver`. */
export interface ChiefRestartDeps {
  /** Every conversation the engine holds, read or not. */
  readonly conversations: Effect.Effect<ReadonlyArray<ConversationId>>;
  /** Delivers one command to a conversation; a failure is one the engine could not record now. */
  readonly deliver: (
    conversationId: ConversationId,
    command: RotateSession,
    commandId: CommandId,
    principal: Principal,
  ) => Effect.Effect<unknown, { readonly message: string }>;
}

export interface ChiefRestart {
  /** The project HQ's Chief mark names in a `state`, or none. */
  readonly heard: (projectId: string | null) => Effect.Effect<void>;
}

export const makeChiefRestart = (deps: ChiefRestartDeps) =>
  Effect.gen(function* () {
    // Per process: none until the first state, which only records.
    const lastChief = yield* Ref.make<Option.Option<string | null>>(Option.none());
    return {
      heard: (projectId) =>
        Effect.gen(function* () {
          const last = yield* Ref.getAndSet(lastChief, Option.some(projectId));
          if (Option.isNone(last) || last.value === projectId) return;
          yield* Effect.logInfo("zerops chief mark moved: every session rotates", {
            from: last.value,
            to: projectId,
          });
          for (const conversationId of yield* deps.conversations) {
            yield* deps
              .deliver(
                conversationId,
                { _tag: "RotateSession", reason: "chief", fresh: false, seed: null },
                CommandId.make(`chief:${conversationId}:${projectId ?? "none"}`),
                { kind: "engine" },
              )
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("zerops chief restart: a rotation was not recorded", {
                    conversationId,
                    message: error.message,
                  }),
                ),
              );
          }
        }),
    } satisfies ChiefRestart;
  });
