/**
 * ZeropsSignerStanding — whether a person who signed a provider login in here may still run turns
 * on it: their signer standing, as HQ answers it.
 *
 * HQ answers it as each person, with the token it keeps for them, for every person it records as
 * a signer of this Mate (the link's `signers` frame): `GET {hqOrigin}/api/mate/signers/standing`
 * under the Mate's own key. Each turn start that runs for somebody away from the keyboard on a login
 * that person signed asks it once (`ZeropsTurnAdmission`); nothing asks on a timer and nothing
 * retries inside a turn start — the next turn start asks again. Offboarding signs out whoever it hears has lost the project
 * (`ZeropsOffboarding`), from {@link ZeropsSignerStanding.heard}.
 *
 * HQ silent for a person — no key, no answer within {@link STANDING_WAIT}, anything but a `200`,
 * `unknown` for them, or no verdict for them at all (HQ has not taken the `signers` frame yet) —
 * leaves the last answer heard for them deciding while it is at most {@link LAST_STANDING_HOLDS}
 * old, and cannot say past that. The last answers live in memory only: a restart forgets them and
 * the first turn after it asks HQ. Silence is never published: a read that cannot say signs
 * nobody out.
 *
 * @module ZeropsSignerStanding
 */
import type { ZeropsUserId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";

import * as ServerConfig from "../config.ts";
import { ZeropsMateKey } from "./ZeropsMateKey.ts";

/**
 * A person's signer standing as HQ says it: `may` run turns here now; `no_access` (an active
 * member this project does not open for); `left` (not a member of the organization any more);
 * `sign_in_needed` (HQ keeps no working token for them: they open Mate once).
 */
export type SignerStanding = "may" | "no_access" | "left" | "sign_in_needed";

/** One answer HQ gave: the standing of each person it spoke for, by Zerops user id. */
export type SignerStandings = Readonly<Record<string, SignerStanding>>;

/** How long one ask waits on HQ. */
export const STANDING_WAIT = Duration.seconds(10);
/** How long the last answer heard for a person decides while HQ is silent. */
export const LAST_STANDING_HOLDS = Duration.minutes(15);

const SPOKEN: ReadonlySet<string> = new Set<SignerStanding>([
  "may",
  "no_access",
  "left",
  "sign_in_needed",
]);

/** HQ's `200` body; a verdict this server does not know (`unknown` among them) cannot say. */
const StandingAnswer = Schema.Struct({ signers: Schema.Record(Schema.String, Schema.String) });
const decodeStandingAnswer = Schema.decodeUnknownOption(StandingAnswer);

export class ZeropsSignerStanding extends Context.Service<
  ZeropsSignerStanding,
  {
    /**
     * `userId`'s signer standing: HQ asked now, or while it is silent the last answer heard for
     * them at most {@link LAST_STANDING_HOLDS} ago; `undefined` when neither can say.
     */
    readonly standing: (userId: ZeropsUserId) => Effect.Effect<SignerStanding | undefined>;
    /** Every answer HQ gives, as it is heard. */
    readonly heard: Stream.Stream<SignerStandings>;
  }
>()("t3/zerops/ZeropsSignerStanding") {}

interface HeardStanding {
  readonly standing: SignerStanding;
  readonly heardAtMs: number;
}

type Asked =
  | { readonly kind: "answer"; readonly verdicts: Readonly<Record<string, string>> }
  | { readonly kind: "silent"; readonly why: string };

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const mateKey = yield* ZeropsMateKey;
  const httpClient = yield* HttpClient.HttpClient;
  const last = yield* Ref.make<ReadonlyMap<string, HeardStanding>>(new Map());
  const heard = yield* PubSub.unbounded<SignerStandings>();

  /** HQ's answer now: every person's verdict as HQ worded it, or why HQ is silent. */
  const askHq = Effect.gen(function* () {
    const environment = config.zerops;
    if (environment === undefined) return { kind: "silent", why: "not a Zerops project" } as const;
    const key = yield* mateKey.read;
    if (key === undefined) return { kind: "silent", why: "no Mate key" } as const;
    return yield* httpClient
      .get(`${environment.hqOrigin}/api/mate/signers/standing`, {
        headers: { authorization: `Project ${key}`, accept: "application/json" },
      })
      .pipe(
        Effect.flatMap((response): Effect.Effect<Asked, unknown> =>
          response.status !== 200
            ? Effect.succeed({ kind: "silent", why: `status ${response.status}` })
            : response.json.pipe(
                Effect.map((body) =>
                  Option.match(decodeStandingAnswer(body), {
                    onNone: (): Asked => ({ kind: "silent", why: "unreadable answer" }),
                    onSome: (answer): Asked => ({ kind: "answer", verdicts: answer.signers }),
                  }),
                ),
              ),
        ),
        Effect.orElseSucceed((): Asked => ({ kind: "silent", why: "unreachable" })),
        Effect.timeoutOrElse({
          duration: STANDING_WAIT,
          orElse: () => Effect.succeed<Asked>({ kind: "silent", why: "timed out" }),
        }),
      );
  });

  /** Asks HQ once, keeps and publishes what it said, and answers the standings it spoke. */
  const ask = Effect.gen(function* () {
    const startedAtMs = yield* Clock.currentTimeMillis;
    const asked: Asked = yield* askHq;
    const heardAtMs = yield* Clock.currentTimeMillis;
    const durationMs = heardAtMs - startedAtMs;
    if (asked.kind === "silent") {
      yield* Effect.logWarning("zerops signer standing: HQ did not answer", {
        why: asked.why,
        durationMs,
      });
      return undefined;
    }
    const counts: Record<string, number> = {};
    const standings: Record<string, SignerStanding> = {};
    for (const [userId, verdict] of Object.entries(asked.verdicts)) {
      const spoken = SPOKEN.has(verdict) ? (verdict as SignerStanding) : undefined;
      const counted = spoken ?? "unknown";
      counts[counted] = (counts[counted] ?? 0) + 1;
      if (spoken !== undefined) standings[userId] = spoken;
    }
    yield* Effect.logInfo("zerops signer standing: HQ answered", { ...counts, durationMs });
    // Two asks at once both write: the later heard wins.
    yield* Ref.update(last, (kept) => {
      const next = new Map(kept);
      for (const [userId, standing] of Object.entries(standings)) {
        if ((next.get(userId)?.heardAtMs ?? -Infinity) <= heardAtMs) {
          next.set(userId, { standing, heardAtMs });
        }
      }
      return next;
    });
    yield* PubSub.publish(heard, standings);
    return standings as SignerStandings;
  });

  const standing: ZeropsSignerStanding["Service"]["standing"] = (userId) =>
    Effect.gen(function* () {
      const spoken = (yield* ask)?.[userId];
      if (spoken !== undefined) return spoken;
      const kept = (yield* Ref.get(last)).get(userId);
      const now = yield* Clock.currentTimeMillis;
      return kept !== undefined && now - kept.heardAtMs <= Duration.toMillis(LAST_STANDING_HOLDS)
        ? kept.standing
        : undefined;
    });

  return ZeropsSignerStanding.of({ standing, heard: Stream.fromPubSub(heard) });
});

export const layer = Layer.effect(ZeropsSignerStanding, make);
