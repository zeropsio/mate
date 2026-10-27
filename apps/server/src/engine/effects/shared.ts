/**
 * What every provider handler shares: the live check, the error words, the outcomes.
 *
 * The live check is the rule that keeps ProviderService from acting on its own: it re-creates a
 * dead session silently on a send, a Stop or an answer, so the engine calls it only when
 * `listSessions()` shows the conversation's thread live under the session the engine opened.
 *
 * @module engine/effects/shared
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { EffectOutcome } from "@t3tools/contracts";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { BridgeDriver } from "../bridge/spi3.ts";
import { isBridgeDriver } from "../bridge/capabilities.ts";
import type { HandlerResult } from "../outbox/EffectWorker.ts";
import type { SessionHost } from "../pump/SessionHost.ts";

/** How long a handler waits on one provider call before it settles the effect `timed-out`. */
export const PROVIDER_CALL_BOUND_MS = 60_000;

export const done = (outcome: EffectOutcome): HandlerResult => ({ _tag: "Done", outcome });
export const ok = (value?: unknown): HandlerResult =>
  done(value === undefined ? { kind: "ok" } : { kind: "ok", value });
export const failed = (
  reason: string,
  extra: Omit<Extract<EffectOutcome, { kind: "failed" }>, "kind" | "reason"> = {},
): HandlerResult => done({ kind: "failed", reason, ...extra });

/**
 * One provider call, bounded: its answer, or none when the bound passed (the effect then settles
 * `timed-out`). Interruptible inside the worker's uninterruptible run, so neither the bound nor a
 * server stopping ever waits on a wedged call.
 */
export const bounded = <A, E, R>(call: Effect.Effect<A, E, R>) =>
  Effect.interruptible(Effect.timeoutOption(call, PROVIDER_CALL_BOUND_MS));

export const timedOut: HandlerResult = done({ kind: "timed-out", after: PROVIDER_CALL_BOUND_MS });

/** A driver the bridge can fold. */
export const knownDriver = (driver: string | null): driver is BridgeDriver =>
  driver !== null && isBridgeDriver(driver);

/** ProviderService says the session is gone (the tags V1 reads; its error module is not ours). */
export const isSessionGone = (error: unknown): boolean => {
  const tag = (error as { readonly _tag?: unknown } | null)?._tag;
  return (
    tag === "ProviderAdapterSessionClosedError" || tag === "ProviderAdapterSessionNotFoundError"
  );
};

/**
 * A handler's own failure is its outcome: past the call it is never tried again. An interruption
 * (the server stopping) is no outcome: the next boot cuts the effect.
 */
export const recovering = (cause: Cause.Cause<unknown>): Effect.Effect<HandlerResult> =>
  Cause.hasInterrupts(cause)
    ? Effect.failCause(cause as Cause.Cause<never>)
    : Effect.succeed(failed(wordsOf(cause)));

/** A failure in the words a person reads. */
export const wordsOf = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message !== "") return error.message;
  const message = (error as { readonly message?: unknown } | null)?.message;
  return typeof message === "string" && message !== "" ? message : String(error);
};

/**
 * The host's session, when it is the one the effect was asked for and ProviderService holds its
 * thread live; otherwise none, and nothing may be called.
 */
export const liveHost = Effect.fnUntraced(function* (
  provider: ProviderServiceShape,
  host: SessionHost | undefined,
  session: string | null | undefined,
) {
  if (host === undefined || session == null) return undefined;
  if ((yield* host.current) !== session) return undefined;
  const sessions = yield* provider.listSessions();
  const live = sessions.some(
    (candidate) => String(candidate.threadId) === host.thread && candidate.status !== "closed",
  );
  return live ? host : undefined;
});
