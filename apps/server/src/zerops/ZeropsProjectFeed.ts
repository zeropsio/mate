/**
 * ZeropsProjectFeed — the Mate's one interface to its own project at Zerops: the project document
 * (its name and organisation) and the live frames of the project's processes.
 *
 * Usage (`UsageLink`), the restart read (`ZeropsRestartRead`), agent sign-in (`ZeropsAgentFlag`)
 * and the crew's platform processes read this, never the source behind it. Today the source is
 * the Mate's access list ({@link derivedLayer}); fixture scenes and dev answer {@link emptyLayer}.
 *
 * @module ZeropsProjectFeed
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { OwnProject } from "./ZeropsAccessRead.ts";
import type { ProcessLiveEvent } from "./ZeropsAccessSocket.ts";
import { ZeropsMateAccessList } from "./ZeropsMateAccessList.ts";

export class ZeropsProjectFeed extends Context.Service<
  ZeropsProjectFeed,
  {
    /**
     * The Mate's own project — its name and organisation — as the last own read and frames left
     * it. While no read has landed it joins the read in flight (or starts one); none where there
     * is no own project or no read landed.
     */
    readonly ownProject: Effect.Effect<Option.Option<OwnProject>>;
    /**
     * The project's processes as Zerops pushes them from the moment this runs: `connected` after
     * each (re)connect, then each frame's own-project processes. Nothing without an own project.
     */
    readonly processes: Effect.Effect<Stream.Stream<ProcessLiveEvent>, never, Scope.Scope>;
  }
>()("t3/zerops/ZeropsProjectFeed") {}

/** The feed as the Mate's access list holds it: its own project read and its socket's frames. */
export const derivedLayer = Layer.effect(
  ZeropsProjectFeed,
  Effect.gen(function* () {
    const { ownProject, processes } = yield* ZeropsMateAccessList;
    return ZeropsProjectFeed.of({ ownProject, processes });
  }),
);

/** No project and no process frames: where there is no platform to read (fixture scenes, dev). */
export const emptyLayer = Layer.succeed(
  ZeropsProjectFeed,
  ZeropsProjectFeed.of({
    ownProject: Effect.succeed(Option.none()),
    processes: Effect.succeed(Stream.empty),
  }),
);
