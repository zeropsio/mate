// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "./config.ts";

/**
 * The boot fence of an automatic update: a server zcp starts while its update record says a switch
 * is in progress has no effect outside its state directory until zcp commits or cancels
 * (`/api/mate/update/commit|cancel`, `zerops/mateUpdateHttp.ts`). zcp may still restore the
 * previous version's state and start it, and every effect this boot made outside that state (an HQ
 * frame, a usage row sent, a git change, a relay publish) would then happen twice.
 *
 * The one rule: client and engine admission and new terminals start closed while `pending`, and
 * every root that acts outward awaits `lifted` inside its own fiber. Nothing on the way to command
 * readiness awaits it: zcp commits only after the readiness proof, which needs startup finished.
 *
 * The lift keeps the order of a boot outside an update: the engine's start (its boot reconcile
 * cuts whatever a restart left running) finishes before admission reopens, and admission reopens
 * before the outward roots run, so nothing admitted at the commit is taken for restart debris.
 */
export interface MateUpdateBootFenceShape {
  /** This boot started under a switch zcp has not committed or cancelled. */
  readonly pending: boolean;
  /** Resolves once the lift has reopened admission; at once on a boot that is not pending. */
  readonly lifted: Effect.Effect<void>;
  /** The engine's start: under a pending fence it runs once zcp commits or cancels. */
  readonly holdStart: (start: Effect.Effect<void>) => Effect.Effect<void>;
  /**
   * The commit and cancel routes: releases the held start, waits for it, runs `reopen`, then
   * lifts. Idempotent, and it finishes even when its caller goes away.
   */
  readonly lift: (reopen: Effect.Effect<void>) => Effect.Effect<void>;
}

const openFence: MateUpdateBootFenceShape = {
  pending: false,
  lifted: Effect.void,
  holdStart: (start) => start,
  lift: (reopen) => reopen,
};

/** Open unless the server layer provides the fence its update record asks for. */
export class MateUpdateBootFence extends Context.Reference<MateUpdateBootFenceShape>(
  "t3/MateUpdateBootFence",
  { defaultValue: () => openFence },
) {
  static readonly layer = Layer.effect(
    MateUpdateBootFence,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      if (!mateUpdateBootPending(config.zerops?.mateUpdateStateFile)) return openFence;
      const released = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const lifted = yield* Deferred.make<void>();
      return {
        pending: true,
        lifted: Deferred.await(lifted),
        holdStart: (start) =>
          Deferred.await(released).pipe(
            Effect.andThen(start),
            Effect.ensuring(Deferred.succeed(started, undefined)),
          ),
        lift: (reopen) =>
          Deferred.succeed(released, undefined).pipe(
            Effect.andThen(Deferred.await(started)),
            Effect.andThen(reopen),
            Effect.andThen(Deferred.succeed(lifted, undefined)),
            Effect.asVoid,
            Effect.uninterruptible,
          ),
      } satisfies MateUpdateBootFenceShape;
    }),
  );
}

/**
 * zcp writes this file (`ServerConfig.zerops.mateUpdateStateFile`) atomically before switching.
 * A damaged marker fails closed.
 */
function mateUpdateBootPending(path: string | undefined): boolean {
  if (path === undefined) return false;
  let text: string;
  try {
    text = NodeFS.readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  return updateBootPending(JSON.parse(text));
}

export function updateBootPending(state: unknown): boolean {
  if (
    typeof state !== "object" ||
    state === null ||
    !("protocol" in state) ||
    state.protocol !== 1 ||
    !("phase" in state) ||
    typeof state.phase !== "string" ||
    ![
      "idle",
      "staging",
      "draining",
      "switching",
      "verifying",
      "updated",
      "postponed",
      "failed",
    ].includes(state.phase)
  )
    throw new Error("Mate update state is unreadable; zcp must recover the last-good version.");
  const pending = state.phase === "switching" || state.phase === "verifying";
  if (
    pending &&
    (!("candidate" in state) ||
      typeof state.candidate !== "string" ||
      state.candidate.trim() === "" ||
      !("previous" in state) ||
      typeof state.previous !== "string" ||
      state.previous.trim() === "")
  )
    throw new Error(
      "Mate update switch identities are unreadable; zcp must recover the last-good version.",
    );
  return pending;
}
