/**
 * What GitHub tells the organization's app (`githubApp.ts` checks its webhook's signature), handed
 * to whoever listens for that event: the intake for issues and their comments, the pull requests
 * for reviews, checks and merges, the mirror for pushes to any branch or tag. A listener's failure
 * is logged and never stops the others.
 *
 * @module githubEvents
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

/** One delivery of the app's webhook, its signature already checked. */
export interface GithubEvent {
  /** `X-GitHub-Event`: `issues`, `issue_comment`, `pull_request`, `pull_request_review`, … */
  readonly name: string;
  /** `X-GitHub-Delivery`. */
  readonly deliveryId: string;
  /** `repository.full_name`, where the event names one. */
  readonly repository: string | undefined;
  readonly payload: unknown;
}

export type GithubEventListener = (event: GithubEvent) => Effect.Effect<void>;

export class GithubEvents extends Context.Service<
  GithubEvents,
  {
    /** Listen for `name`; for the life of the listener's scope. */
    readonly on: (name: string, listener: GithubEventListener) => Effect.Effect<void>;
    /** Hand an event to every listener for its name, one after another. */
    readonly dispatch: (event: GithubEvent) => Effect.Effect<void>;
  }
>()("@t3tools/hq/githubEvents") {}

export const githubEventsLayer = Layer.effect(
  GithubEvents,
  Effect.gen(function* () {
    const listeners = yield* Ref.make(new Map<string, ReadonlyArray<GithubEventListener>>());
    return GithubEvents.of({
      on: (name, listener) =>
        Ref.update(listeners, (current) => {
          const next = new Map(current);
          next.set(name, [...(current.get(name) ?? []), listener]);
          return next;
        }),
      dispatch: (event) =>
        Effect.gen(function* () {
          for (const listener of (yield* Ref.get(listeners)).get(event.name) ?? []) {
            yield* listener(event).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("a GitHub event's listener failed", {
                  event: event.name,
                  deliveryId: event.deliveryId,
                  cause,
                }),
              ),
            );
          }
        }),
    });
  }),
);
