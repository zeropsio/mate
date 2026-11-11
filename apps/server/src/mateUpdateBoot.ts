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
 */
export interface MateUpdateBootFenceShape {
  /** This boot started under a switch zcp has not committed or cancelled. */
  readonly pending: boolean;
  /** Resolves once zcp commits or cancels; at once on a boot that is not pending. */
  readonly lifted: Effect.Effect<void>;
  /** Called by the commit and cancel routes; idempotent. */
  readonly lift: Effect.Effect<void>;
}

const openFence: MateUpdateBootFenceShape = {
  pending: false,
  lifted: Effect.void,
  lift: Effect.void,
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
      const lifted = yield* Deferred.make<void>();
      return {
        pending: true,
        lifted: Deferred.await(lifted),
        lift: Deferred.succeed(lifted, undefined).pipe(Effect.asVoid),
      };
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
