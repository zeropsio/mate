/**
 * HQ's side of a Mate's link (SPEC §3.4, `@t3tools/shared/mateLink`). A Mate server opens it with a
 * ticket minted for its Mate credential (`POST /api/mate/link-ticket`) and keeps it open:
 *
 * - **down**, the Mate's state (`state`) at once and after every change of its record, its birth or
 *   its changes (`changes.ts`), and `ping` every 20 s;
 * - **up**, `pong`, and its overview (`overview`): the whole of it first, then the sections that
 *   changed, kept by `mateOverviews.ts` for whoever may observe the Mate on their structure socket.
 *   A frame whose type HQ does not know is passed by — an older Mate's `summary` among them.
 *
 * Closes with `4401` once the credential is revoked (enroll again), `1001` when this Core stops
 * leading or shuts down (reconnect: another Core leads), `4408` after three silent pings, `1007` for a
 * frame that is no link message, `1009` for one past {@link MATE_LINK_FRAME_MAX}, `1011` when HQ
 * cannot read the Mate's state. A frame's size is counted in UTF-8 bytes.
 *
 * @module link
 */
import {
  MATE_LINK_FRAME_MAX,
  type MateLinkDown,
  type MateState,
  linkFrameBytes,
  readLinkUp,
} from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as Socket from "effect/unstable/socket/Socket";

import { Changes } from "./changes.ts";
import { Leader } from "./leader.ts";
import { MateCredentials } from "./mateCredentials.ts";
import { MateOverviews } from "./mateOverviews.ts";
import { LiveSockets, socketEnding } from "./stream.ts";
import { Structure } from "./structure.ts";

export interface LinkOptions {
  /** How often HQ pings; 20 s. */
  readonly pingEvery?: Duration.Duration;
  /** How often HQ checks that it still leads and the credential still holds; 30 s. */
  readonly recheck?: Duration.Duration;
}

const encodeDown = (message: MateLinkDown) => JSON.stringify(message);

/**
 * Serves the link of the Mate `projectId` holds `credential` for, until either side ends it; says
 * which side ended it.
 */
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
      const overviews = yield* MateOverviews;
      const structure = yield* Structure;
      const changes = yield* Changes;
      const credentials = yield* MateCredentials;
      const leader = yield* Leader;
      const pingEvery = options.pingEvery ?? Duration.seconds(20);
      const { close, heardClose, ending } = yield* socketEnding(writer);
      yield* (yield* LiveSockets).track(close);
      const link = yield* overviews.connect(projectId);

      const sent = yield* Ref.make<string | undefined>(undefined);
      /** The Mate's state now — its record and its changes — when it differs from the last sent. */
      const sendState = Effect.gen(function* () {
        const record = yield* structure.mateState(projectId);
        if (Option.isNone(record)) return;
        const mate: MateState = { ...record.value, ...(yield* changes.mateChanges(projectId)) };
        const frame = encodeDown({ type: "state", mate });
        if ((yield* Ref.getAndSet(sent, frame)) !== frame) yield* writer.write(frame);
      });
      const heard = yield* Ref.make(yield* Clock.currentTimeMillis);

      // Every change's tick, starting with the current one: its state at once, then as it moves.
      const states = Stream.runForEach(
        Stream.merge(
          Stream.filter(structure.mateChanges, (changed) => changed === projectId),
          changes.changes,
        ),
        () => sendState,
      ).pipe(Effect.catch(() => close(1011, "the Mate's state could not be read")));

      const listen = Effect.gen(function* () {
        for (;;) {
          const frames = yield* pull;
          yield* Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(heard, now));
          for (const frame of frames) {
            if (linkFrameBytes(frame) > MATE_LINK_FRAME_MAX) {
              return yield* close(1009, "frame too big");
            }
            const read = readLinkUp(frame);
            if (read.kind === "invalid") return yield* close(1007, "no link message");
            if (read.kind === "message" && read.message.type === "overview") {
              yield* overviews.report(projectId, link, read.message);
            }
          }
        }
      }).pipe(Effect.catchTag("SocketError", heardClose), Effect.ignore);

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
      return yield* ending;
    }),
  );
