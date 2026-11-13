/**
 * ZeropsProjectFeed — the Mate's one interface to its own project at Zerops: the project document
 * (its name and organisation) and the live frames of the project's processes.
 *
 * Usage (`UsageLink`), the restart read (`ZeropsRestartRead`), agent sign-in (`ZeropsAgentFlag`)
 * and the crew's platform processes read this, never the source behind it. In a Zerops container
 * the source is the Mate's own project key ({@link layer}): `GET /project/{own}` for the document,
 * and the Zerops websocket's process frames (`ZeropsProjectSocket`). The document is read when
 * first asked and again before each socket connection; a read that fails keeps the last one that
 * landed. Elsewhere (fixture scenes, dev) the feed knows no project and hears no frames.
 *
 * @module ZeropsProjectFeed
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";

import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { requestWithMateKey, ZeropsMateKey } from "./ZeropsMateKey.ts";
import {
  connectProjectSocket,
  type ProcessLiveEvent,
  processEvents,
} from "./ZeropsProjectSocket.ts";
import { readJson, zeropsGet } from "./zeropsApiRead.ts";

/** The Mate's own project as its read carries it: its organisation and its name. */
export interface OwnProject {
  readonly clientId: string;
  readonly name?: string;
}

/** One read of the own project: the document, or why there is none. */
export type OwnProjectRead =
  | { readonly kind: "read"; readonly project: OwnProject }
  | { readonly kind: "failed"; readonly reason: string };

/** The longest one read waits on Zerops before it counts as failed. */
export const PROJECT_READ_BUDGET = Duration.seconds(15);

export class ZeropsProjectFeed extends Context.Service<
  ZeropsProjectFeed,
  {
    /**
     * The Mate's own project — its name and organisation — as the last read that landed left it.
     * While none has landed it joins the read in flight (or starts one); none where there is no
     * own project or no read landed.
     */
    readonly ownProject: Effect.Effect<Option.Option<OwnProject>>;
    /**
     * The project's processes as Zerops pushes them from the moment this runs: `connected` after
     * each (re)connect, then each frame's own-project processes. Nothing without an own project.
     */
    readonly processes: Effect.Effect<Stream.Stream<ProcessLiveEvent>, never, Scope.Scope>;
  }
>()("t3/zerops/ZeropsProjectFeed") {}

/** The own project in a `GET /project/{id}` body, if it names its organisation. */
export const ownProjectOf = (body: unknown): OwnProject | undefined => {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const clientId = record["clientId"];
  if (typeof clientId !== "string" || clientId.length === 0) return undefined;
  const name = record["name"];
  return {
    clientId,
    ...(typeof name === "string" && name.trim().length > 0 ? { name: name.trim() } : {}),
  };
};

/**
 * The feed over `own`: `read` reads the own project, `live` streams its process frames, asking
 * the organisation of whoever it is handed before each connection. Without `own`, a feed that
 * knows no project and hears no frames.
 */
export const make = (own?: {
  readonly read: Effect.Effect<OwnProjectRead>;
  readonly live?: (
    organisation: Effect.Effect<string | undefined>,
  ) => Stream.Stream<ProcessLiveEvent>;
}) =>
  Effect.gen(function* () {
    const held = yield* Ref.make<OwnProject | undefined>(undefined);
    const processes = yield* PubSub.unbounded<ProcessLiveEvent>();
    const scope = yield* Effect.scope;
    /** The read in flight: whoever asks joins it rather than starting a read of its own. */
    const inFlight = yield* Ref.make<Deferred.Deferred<OwnProject | undefined> | undefined>(
      undefined,
    );

    const readOnce = (from: NonNullable<typeof own>) =>
      from.read.pipe(
        Effect.timeoutOrElse({
          duration: PROJECT_READ_BUDGET,
          orElse: () => Effect.succeed<OwnProjectRead>({ kind: "failed", reason: "timeout" }),
        }),
        Effect.flatMap((read) =>
          read.kind === "read"
            ? Effect.as(Ref.set(held, read.project), read.project)
            : Effect.logWarning("zerops project feed: the own project read failed", {
                reason: read.reason,
              }).pipe(Effect.andThen(Ref.get(held))),
        ),
      );

    /**
     * A fresh read, or the one in flight; the last landed project where it fails. The read runs in
     * the feed's scope, so a waiter that goes away leaves it to the others.
     */
    const reread =
      own === undefined
        ? Effect.succeed<OwnProject | undefined>(undefined)
        : Effect.gen(function* () {
            const fresh = yield* Deferred.make<OwnProject | undefined>();
            const running = yield* Ref.modify(
              inFlight,
              (
                current,
              ): [
                Deferred.Deferred<OwnProject | undefined> | undefined,
                Deferred.Deferred<OwnProject | undefined>,
              ] => (current === undefined ? [undefined, fresh] : [current, current]),
            );
            if (running !== undefined) return yield* Deferred.await(running);
            yield* readOnce(own).pipe(
              Effect.ensuring(Ref.set(inFlight, undefined)),
              Deferred.into(fresh),
              Effect.forkIn(scope, { startImmediately: true }),
            );
            return yield* Deferred.await(fresh);
          });

    if (own?.live !== undefined) {
      yield* Effect.forkScoped(
        Stream.runForEach(own.live(Effect.map(reread, (project) => project?.clientId)), (event) =>
          PubSub.publish(processes, event),
        ),
      );
    }

    return ZeropsProjectFeed.of({
      ownProject: Effect.gen(function* () {
        const known = yield* Ref.get(held);
        return Option.fromUndefinedOr(known ?? (yield* reread));
      }),
      processes: Effect.map(PubSub.subscribe(processes), Stream.fromSubscription),
    });
  });

/** A feed that knows no project: where there is no platform to read (fixture scenes, dev). */
export const emptyLayer = Layer.effect(ZeropsProjectFeed, make());

/**
 * The feed of the Mate's own project, read with its project key: `GET /project/{own}` and the
 * Zerops websocket's process frames.
 */
export const layer = (environment: Pick<ZeropsEnvironment, "apiBaseUrl" | "projectId">) =>
  Layer.effect(
    ZeropsProjectFeed,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const mateKey = yield* ZeropsMateKey;
      const read: Effect.Effect<OwnProjectRead> = requestWithMateKey(mateKey, (token) =>
        zeropsGet({
          url: `${environment.apiBaseUrl}/project/${encodeURIComponent(environment.projectId)}`,
          token,
        }),
      ).pipe(
        Effect.flatMap(({ response }) => {
          if (response === undefined)
            return Effect.succeed<OwnProjectRead>({ kind: "failed", reason: "no-key" });
          if (response.status !== 200)
            return Effect.succeed<OwnProjectRead>({
              kind: "failed",
              reason: `status ${response.status}`,
            });
          return Effect.map(readJson(response), (body): OwnProjectRead => {
            const project = ownProjectOf(body);
            return project === undefined
              ? { kind: "failed", reason: "the project read names no organisation" }
              : { kind: "read", project };
          });
        }),
        Effect.catchTags({
          ZeropsApiUnavailableError: (error) =>
            Effect.succeed<OwnProjectRead>({ kind: "failed", reason: error.reason }),
        }),
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
      return yield* make({
        read,
        live: (organisation) =>
          processEvents({
            ...environment,
            organisation,
            mateKey,
            connect: connectProjectSocket,
          }).pipe(Stream.provideService(HttpClient.HttpClient, httpClient)),
      });
    }),
  );
