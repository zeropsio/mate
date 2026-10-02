/**
 * HQ's side of a Mate's link (SPEC §3.4, `@t3tools/shared/mateLink`). A Mate server opens it with a
 * ticket minted for its Mate credential (`POST /api/mate/link-ticket`) and keeps it open:
 *
 * - **down**, the Mate's state (`state`) at once and after every change of its record or birth, and
 *   `ping` every 20 s;
 * - **up**, `pong`, and its summary (`summary`), kept in memory (`mateLive.ts`) for whoever may
 *   operate the Mate to follow on their structure socket.
 *
 * Closes with `4401` once the credential is revoked (enroll again), `1001` when this Core stops
 * leading or shuts down (reconnect: another Core leads), `4408` after three silent pings, `1007` for a
 * frame that is no link message, `1009` for one past {@link MATE_LINK_FRAME_MAX}, `1011` when HQ
 * cannot read the Mate's state.
 *
 * @module link
 */
import { MATE_LINK_FRAME_MAX, type MateLinkDown, MateLinkUp } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Socket from "effect/unstable/socket/Socket";

import { Leader } from "./leader.ts";
import { MateCredentials } from "./mateCredentials.ts";
import { MateLive } from "./mateLive.ts";
import { LiveSockets } from "./stream.ts";
import { Structure } from "./structure.ts";

export interface LinkOptions {
  /** How often HQ pings; 20 s. */
  readonly pingEvery?: Duration.Duration;
  /** How often HQ checks that it still leads and the credential still holds; 30 s. */
  readonly recheck?: Duration.Duration;
}

const decodeUp = Schema.decodeUnknownEffect(Schema.fromJsonString(MateLinkUp));
const encodeDown = (message: MateLinkDown) => JSON.stringify(message);

/** Serves the link of the Mate `projectId` holds `credential` for, until either side ends it. */
export const serveMateLink = (
  socket: Socket.Socket,
  projectId: string,
  credential: string,
  options: LinkOptions,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const writer = yield* socket.writer;
      const pull = yield* Socket.readerString(socket);
      const live = yield* MateLive;
      const structure = yield* Structure;
      const credentials = yield* MateCredentials;
      const leader = yield* Leader;
      const pingEvery = options.pingEvery ?? Duration.seconds(20);
      const close = (code: number, reason: string) =>
        writer.write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore);
      yield* (yield* LiveSockets).track(close);
      yield* live.connect(projectId);

      const sendState = Effect.flatMap(structure.mateState(projectId), (state) =>
        Option.isSome(state)
          ? writer.write(encodeDown({ type: "state", mate: state.value }))
          : Effect.void,
      );
      const heard = yield* Ref.make(yield* Clock.currentTimeMillis);

      const states = Effect.andThen(
        sendState,
        Stream.runForEach(
          Stream.filter(structure.mateChanges, (changed) => changed === projectId),
          () => sendState,
        ),
      ).pipe(Effect.catch(() => close(1011, "the Mate's state could not be read")));

      const listen = Effect.gen(function* () {
        for (;;) {
          const frames = yield* pull;
          yield* Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(heard, now));
          for (const frame of frames) {
            if (frame.length > MATE_LINK_FRAME_MAX) return yield* close(1009, "frame too big");
            const message = yield* Effect.option(decodeUp(frame));
            if (Option.isNone(message)) return yield* close(1007, "no link message");
            if (message.value.type === "summary") {
              yield* live.report(projectId, message.value.summary);
            }
          }
        }
      }).pipe(Effect.ignore);

      const ping = Effect.gen(function* () {
        for (;;) {
          yield* Effect.sleep(pingEvery);
          const silentFor = (yield* Clock.currentTimeMillis) - (yield* Ref.get(heard));
          if (silentFor > 3 * Duration.toMillis(pingEvery)) return yield* close(4408, "no pong");
          yield* writer.write(encodeDown({ type: "ping" }));
        }
      }).pipe(Effect.ignore);

      const recheck = Effect.gen(function* () {
        for (;;) {
          yield* Effect.sleep(options.recheck ?? Duration.seconds(30));
          if ((yield* leader.status).state !== "active") return yield* close(1001, "going away");
          const holder = yield* credentials.whoami(credential);
          if (Option.isNone(holder) || holder.value.projectId !== projectId) {
            return yield* close(4401, "credential revoked");
          }
        }
      }).pipe(Effect.ignore);

      yield* Effect.raceAll([listen, ping, states, recheck]);
    }),
  );
