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
 * (`/api/mate/update/commit|cancel`, `zerops/mateUpdateHttp.ts`) or its record settles on this
 * server's version (`zerops/ZeropsMateUpdate.ts`, read again at an interval while fenced). zcp may still restore the
 * previous version's state and start it, and every effect this boot made outside that state (an HQ
 * frame, a usage row sent, a git change, a relay publish) would then happen twice.
 *
 * zcp copies the state before the boot and drops the copy at its commit, so every write the boot
 * makes to the state, and every step that can fail on it, comes before the readiness proof: the
 * engine's boot (`engine/EngineBoot.ts`) reads, migrates and reconciles there. Only the engine's
 * opening is held; it cannot fail, so nothing after the commit can end the process. zcp's commit
 * has a fixed budget, so the commit answers once the lift has started.
 *
 * The one rule: client and engine admission and new terminals start closed while `pending`, and
 * every root that acts outward awaits `lifted` inside its own fiber. Nothing on the way to command
 * readiness awaits it: zcp commits only after the readiness proof, which needs startup finished.
 *
 * The lift keeps the order of a boot outside an update: the engine opens before admission reopens,
 * and admission reopens before the outward roots run.
 *
 * A switch zcp settled on another version than this process runs (it rolled back or repaired the
 * record while this boot still runs) is refused: work admitted here would be overwritten by the
 * state zcp restores at the next start, so the fence never lifts and the process ends as a failed
 * boot does. The unit then starts the installed version.
 */
export interface MateUpdateBootFenceShape {
  /** This boot started under a switch zcp has not committed or cancelled. */
  readonly pending: boolean;
  /** Resolves once the lift has reopened admission; at once on a boot that is not pending. */
  readonly lifted: Effect.Effect<void>;
  /** The engine's opening: under a pending fence it runs once zcp commits or cancels. */
  readonly holdOpen: (open: Effect.Effect<void>) => Effect.Effect<void>;
  /**
   * Starts the lift and returns at once: releases the held opening, waits for it, runs `reopen`,
   * then resolves `lifted`. It runs in the fence's own scope, so it finishes when its caller goes
   * away and never holds a caller that runs before the engine's opening exists (the update
   * service's first read inside a layer build), nor a commit answering inside zcp's budget.
   * Once lifted, `reopen` runs inline, as on a boot that is not pending; once refused, nothing.
   */
  readonly lift: (reopen: Effect.Effect<void>) => Effect.Effect<void>;
  /**
   * zcp settled this switch on another version: under a pending fence no lift reached first, it
   * never lifts and `ended` fails with `reason`. Otherwise nothing.
   */
  readonly refuse: (reason: string) => Effect.Effect<void>;
  /** Fails once the fence is refused; never otherwise. The server's launch ends on it. */
  readonly ended: Effect.Effect<never>;
}

const openFence: MateUpdateBootFenceShape = {
  pending: false,
  lifted: Effect.void,
  holdOpen: (open) => open,
  lift: (reopen) => reopen,
  refuse: () => Effect.void,
  ended: Effect.never,
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
      const scope = yield* Effect.scope;
      const released = yield* Deferred.make<void>();
      const opened = yield* Deferred.make<void>();
      const lifted = yield* Deferred.make<void>();
      const refused = yield* Deferred.make<never>();
      // The first of a lift and a refusal decides; the other then does nothing.
      const decided = yield* Deferred.make<"lift" | "refuse">();
      const decide = (as: "lift" | "refuse") =>
        Deferred.succeed(decided, as).pipe(Effect.andThen(Deferred.await(decided)));
      return {
        pending: true,
        lifted: Deferred.await(lifted),
        holdOpen: (open) =>
          Deferred.await(released).pipe(
            Effect.andThen(open),
            Effect.andThen(Deferred.succeed(opened, undefined)),
            Effect.asVoid,
          ),
        lift: (reopen) =>
          Effect.gen(function* () {
            if ((yield* decide("lift")) === "refuse") return;
            if (yield* Deferred.isDone(lifted)) return yield* reopen;
            yield* Deferred.succeed(released, undefined).pipe(
              Effect.andThen(Deferred.await(opened)),
              Effect.andThen(reopen),
              Effect.andThen(Deferred.succeed(lifted, undefined)),
              Effect.forkIn(scope),
            );
          }),
        refuse: (reason) =>
          Effect.gen(function* () {
            if ((yield* decide("refuse")) === "lift") return;
            yield* Effect.logError("mate update: the switch settled on another version", {
              reason,
            });
            yield* Deferred.die(refused, new Error(reason));
          }),
        ended: Deferred.await(refused),
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
