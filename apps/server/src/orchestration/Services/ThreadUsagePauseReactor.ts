/**
 * ThreadUsagePauseReactor - follows each thread's provider usage limit: pauses
 * the thread while a window refuses requests, counts the background results
 * the pause holds, and resumes the thread's work at the reset
 * (`orchestration/usagePause.ts` decides; this service reads and dispatches).
 *
 * @module ThreadUsagePauseReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface ThreadUsagePauseReactorShape {
  /**
   * Re-arm the resets of pauses that outlived a restart, then follow provider
   * runtime events. Must run in a scope so its fibers end with it.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /** Resolves once every event received and every reset fired so far is handled. */
  readonly drain: Effect.Effect<void>;
}

export class ThreadUsagePauseReactor extends Context.Service<
  ThreadUsagePauseReactor,
  ThreadUsagePauseReactorShape
>()("t3/orchestration/Services/ThreadUsagePauseReactor") {}
