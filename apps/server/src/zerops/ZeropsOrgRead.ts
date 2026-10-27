/**
 * ZeropsOrgRead — this Mate's project, shared by restart and usage reads.
 * A usable answer is kept for 30 seconds; concurrent readers share one request.
 * Failed reads are not cached.
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/http/HttpClient";

import { requestWithMateKey, ZeropsMateKey } from "./ZeropsMateKey.ts";
import { readJson, zeropsGet } from "./zeropsApiRead.ts";

/** How old a kept answer may be and still be the answer. */
export const ORG_READ_MAX_AGE = Duration.seconds(30);

/** One read with the Mate's own key, as its callers tell the outcomes apart. */
export type OwnKeyRead =
  /** The platform answered: `body` is a `200`'s parsed body, and `undefined` for any other status. */
  | { readonly kind: "answered"; readonly status: number; readonly body: unknown }
  /** This Mate holds no key to read with. */
  | { readonly kind: "no-key" }
  /** The platform could not be reached, or its `200` carried no JSON. */
  | { readonly kind: "unreachable"; readonly reason: string };

/** A project read worth keeping: one that names the org it belongs to. */
const namesItsOrg = (read: OwnKeyRead): boolean => {
  if (read.kind !== "answered" || read.status !== 200) return false;
  if (typeof read.body !== "object" || read.body === null) return false;
  const clientId = (read.body as Record<string, unknown>)["clientId"];
  return typeof clientId === "string" && clientId.length > 0;
};

export class ZeropsOrgRead extends Context.Service<
  ZeropsOrgRead,
  {
    /** `GET /project/{projectId}` with the Mate's own key, shared as the module says. */
    readonly project: (input: {
      readonly apiBaseUrl: string;
      readonly projectId: string;
    }) => Effect.Effect<OwnKeyRead>;
  }
>()("t3/zerops/ZeropsOrgRead") {}

interface Shared {
  /** The last usable answer of each read, and when it was asked. */
  readonly kept: ReadonlyMap<string, { readonly askedAtMs: number; readonly read: OwnKeyRead }>;
  /** The reads under way, which an asker joins. */
  readonly running: ReadonlyMap<string, Deferred.Deferred<OwnKeyRead>>;
}

/** What an asker does: take the kept answer, join the read under way, or start one. */
type Step =
  | { readonly kind: "kept"; readonly read: OwnKeyRead }
  | { readonly kind: "join" | "start"; readonly deferred: Deferred.Deferred<OwnKeyRead> };

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const mateKey = yield* ZeropsMateKey;
  const maxAgeMs = Duration.toMillis(ORG_READ_MAX_AGE);
  const shared = yield* Ref.make<Shared>({ kept: new Map(), running: new Map() });

  const readOnce = (url: string): Effect.Effect<OwnKeyRead> =>
    requestWithMateKey(mateKey, (token) => zeropsGet({ url, token })).pipe(
      Effect.flatMap(({ response }) => {
        if (response === undefined) return Effect.succeed<OwnKeyRead>({ kind: "no-key" });
        if (response.status !== 200) {
          return Effect.succeed<OwnKeyRead>({
            kind: "answered",
            status: response.status,
            body: undefined,
          });
        }
        return readJson(response).pipe(
          Effect.map((body): OwnKeyRead => ({ kind: "answered", status: 200, body })),
        );
      }),
      Effect.catchTags({
        ZeropsApiUnavailableError: (error) =>
          Effect.succeed<OwnKeyRead>({ kind: "unreachable", reason: error.reason }),
      }),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  const read = (url: string, usable: (read: OwnKeyRead) => boolean) =>
    Effect.gen(function* () {
      const askedAtMs = yield* Clock.currentTimeMillis;
      const mine = yield* Deferred.make<OwnKeyRead>();
      const step = yield* Ref.modify(shared, (current): readonly [Step, Shared] => {
        const held = current.kept.get(url);
        if (held !== undefined && askedAtMs - held.askedAtMs < maxAgeMs) {
          return [{ kind: "kept", read: held.read }, current];
        }
        const running = current.running.get(url);
        if (running !== undefined) return [{ kind: "join", deferred: running }, current];
        return [
          { kind: "start", deferred: mine },
          { ...current, running: new Map(current.running).set(url, mine) },
        ];
      });
      if (step.kind === "kept") return step.read;
      // A read outlives its first caller so other readers keep their shared answer.
      if (step.kind === "start") {
        yield* readOnce(url).pipe(
          Effect.onExit((exit) =>
            Ref.update(shared, (current) => {
              const running = new Map(current.running);
              running.delete(url);
              const answered = exit._tag === "Success" ? exit.value : undefined;
              return {
                running,
                kept:
                  answered !== undefined && usable(answered)
                    ? new Map(current.kept).set(url, { askedAtMs, read: answered })
                    : current.kept,
              };
            }).pipe(Effect.andThen(Deferred.done(mine, exit))),
          ),
          Effect.forkDetach({ startImmediately: true }),
        );
      }
      return yield* Deferred.await(step.deferred);
    });

  return ZeropsOrgRead.of({
    project: ({ apiBaseUrl, projectId }) =>
      read(`${apiBaseUrl}/project/${encodeURIComponent(projectId)}`, namesItsOrg),
  });
});

export const layer = Layer.effect(ZeropsOrgRead, make);
