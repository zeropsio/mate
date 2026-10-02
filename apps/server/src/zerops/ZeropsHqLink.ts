/**
 * The Mate's link to its HQ (SPEC §3.4, `@t3tools/shared/mateLink`): one outbound WebSocket, kept
 * open for as long as this server runs.
 *
 * - **Who it is:** zcp enrolls the Mate with its org's official HQ and keeps the enrollment — HQ's
 *   address and the Mate credential — in a file only this container's user reads
 *   (`T3CODE_ZEROPS_HQ_ENROLLMENT`, `ZeropsEnvironment.hqEnrollmentPath`). It is read again before
 *   every connect, so a re-enrollment (a revoked credential, another official HQ) is picked up
 *   without a restart; until it exists, the link waits.
 * - **How it opens:** a ticket minted with `Authorization: Mate <credential>`
 *   (`POST /api/mate/link-ticket`), then `wss://<hq>/api/mate/link?ticket=`. A refused ticket
 *   opens nothing and is asked for again later — zcp enrolls anew meanwhile.
 * - **Up:** the Mate's summary at once and whenever it changed, at most once per
 *   `MATE_SUMMARY_EVERY_MS`; `pong` to each of HQ's pings.
 * - **Down:** the Mate's state as HQ holds it (its record, its birth), kept here for whoever asks.
 *
 * A link that closes or never opens is tried again after a growing wait.
 *
 * @module ZeropsHqLink
 */
import {
  MATE_SUMMARY_EVERY_MS,
  MateLinkDown,
  MateLinkUp,
  type MateState,
  type MateSummary,
} from "@t3tools/shared/mateLink";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ZeropsProjectSigners } from "./ZeropsProjectSigners.ts";
import { mateSummaryOf } from "./zeropsHqSummary.ts";

/** The part of a WebSocket the link uses; the global `WebSocket` is one. */
export interface LinkSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

export type ConnectLinkSocket = (url: string) => LinkSocket;

/** What zcp keeps of the Mate's enrollment, as far as the link needs it. */
export interface HqEnrollment {
  readonly hq: string;
  readonly credential: string;
}

/**
 * zcp's last word on enrolling, where it says why there is no enrollment
 * (`~/.zcp/hq/outcome.json`, spec-mate §2.8): no official HQ in the org, or
 * HQ's own refusal with its code.
 */
export interface HqOutcome {
  readonly state: "no_hq" | "refused";
  readonly code?: string | undefined;
}

/** Where the Mate stands with its HQ. */
export type HqStanding =
  /** zcp keeps no enrollment yet; why, where zcp said. */
  | { readonly kind: "not-enrolled"; readonly outcome: Option.Option<HqOutcome> }
  /** Enrolled, and HQ has not sent the Mate yet. */
  | { readonly kind: "not-linked" }
  /** The Mate as HQ last sent it. */
  | { readonly kind: "linked"; readonly mate: MateState };

export interface ZeropsHqLinkOptions {
  /** The enrollment as it stands now; none until zcp has enrolled. */
  readonly readEnrollment: Effect.Effect<Option.Option<HqEnrollment>>;
  /** zcp's last word on enrolling; none when it said nothing this build reads. */
  readonly readOutcome: Effect.Effect<Option.Option<HqOutcome>>;
  readonly connect: ConnectLinkSocket;
  /** The Mate's summary as it stands now; none when it cannot be read, tried again next round. */
  readonly summary: Effect.Effect<Option.Option<MateSummary>>;
  /** Fires whenever the summary may have changed. */
  readonly changes: Stream.Stream<unknown>;
  /** The waits before each next attempt; the last one repeats. */
  readonly reconnectDelaysMs?: ReadonlyArray<number>;
  readonly summaryEveryMs?: number;
  /** How often the summary is looked at with no change heard (the clock moves a live step). */
  readonly refreshEveryMs?: number;
}

export class ZeropsHqLink extends Context.Service<
  ZeropsHqLink,
  {
    /** Where the Mate stands with its HQ now. */
    readonly standing: Effect.Effect<HqStanding>;
  }
>()("t3/zerops/ZeropsHqLink") {}

const DEFAULT_RECONNECT_DELAYS_MS: ReadonlyArray<number> = [1_000, 2_000, 5_000, 10_000, 30_000];

const decodeDown = Schema.decodeUnknownOption(Schema.fromJsonString(MateLinkDown));
const encodeUp = Schema.encodeSync(Schema.fromJsonString(MateLinkUp));

type SocketEvent =
  | { readonly _tag: "open" }
  | { readonly _tag: "message"; readonly raw: string }
  | { readonly _tag: "close" };

const ticketResponse = Schema.Struct({ ticket: Schema.String });

export const makeZeropsHqLink = (
  options: ZeropsHqLinkOptions,
): Effect.Effect<ZeropsHqLink["Service"], never, HttpClient.HttpClient | Scope.Scope> =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const state = yield* SubscriptionRef.make<Option.Option<MateState>>(Option.none());
    const delays = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    const summaryEvery = Duration.millis(options.summaryEveryMs ?? MATE_SUMMARY_EVERY_MS);
    const refreshEvery = Duration.millis(options.refreshEveryMs ?? 30_000);

    /** A ticket for the link, minted with the Mate's credential; none when HQ refuses or is away. */
    const ticketFor = (enrollment: HqEnrollment) =>
      Effect.gen(function* () {
        const response = yield* http.execute(
          HttpClientRequest.post(`${enrollment.hq.replace(/\/+$/u, "")}/api/mate/link-ticket`, {
            headers: { authorization: `Mate ${enrollment.credential}`, accept: "application/json" },
          }),
        );
        if (response.status !== 200) return Option.none<string>();
        const body = yield* Schema.decodeUnknownEffect(ticketResponse)(yield* response.json);
        return Option.some(body.ticket);
      }).pipe(Effect.catch(() => Effect.succeed(Option.none<string>())));

    /** One link: open, relayed until it closes. Whether it opened. */
    const runOnce = (enrollment: HqEnrollment) =>
      Effect.gen(function* () {
        const ticket = yield* ticketFor(enrollment);
        if (Option.isNone(ticket)) return false;
        const url = `${enrollment.hq.replace(/^http/u, "ws").replace(/\/+$/u, "")}/api/mate/link?ticket=${encodeURIComponent(ticket.value)}`;
        const events = yield* Queue.unbounded<SocketEvent>();
        const socket = options.connect(url);
        socket.addEventListener("open", () => Queue.offerUnsafe(events, { _tag: "open" }));
        socket.addEventListener("message", (event) =>
          Queue.offerUnsafe(events, { _tag: "message", raw: String(event.data) }),
        );
        socket.addEventListener("close", () => Queue.offerUnsafe(events, { _tag: "close" }));
        socket.addEventListener("error", () => Queue.offerUnsafe(events, { _tag: "close" }));
        const send = (message: MateLinkUp) =>
          Effect.sync(() => {
            try {
              socket.send(encodeUp(message));
            } catch {
              // A socket going away: its close is on its way.
            }
          });
        const quit = Effect.sync(() => {
          try {
            socket.close();
          } catch {
            // Gone already.
          }
        });
        const first = yield* Queue.take(events);
        if (first._tag !== "open") {
          yield* quit;
          return false;
        }

        const dirty = yield* Ref.make(true);
        const sent = yield* Ref.make("");
        const summaries = Effect.forever(
          Effect.gen(function* () {
            if (yield* Ref.getAndSet(dirty, false)) {
              const summary = yield* options.summary;
              if (Option.isNone(summary)) yield* Ref.set(dirty, true);
              else {
                const message: MateLinkUp = { type: "summary", summary: summary.value };
                const encoded = encodeUp(message);
                if (encoded !== (yield* Ref.get(sent))) {
                  yield* Ref.set(sent, encoded);
                  yield* send(message);
                }
              }
            }
            yield* Effect.sleep(summaryEvery);
          }),
        );
        const heard = Stream.runForEach(options.changes, () => Ref.set(dirty, true));
        const refresh = Effect.forever(
          Effect.andThen(Effect.sleep(refreshEvery), Ref.set(dirty, true)),
        );
        const relay = Stream.fromQueue(events).pipe(
          Stream.takeWhile((event) => event._tag === "message"),
          Stream.runForEach((event) => {
            if (event._tag !== "message") return Effect.void;
            const message = decodeDown(event.raw);
            if (Option.isNone(message)) return Effect.void;
            return message.value.type === "ping"
              ? send({ type: "pong" })
              : SubscriptionRef.set(state, Option.some(message.value.mate));
          }),
        );
        yield* Effect.raceFirst(relay, Effect.all([summaries, heard, refresh], { concurrency: 3 }));
        yield* quit;
        return true;
      });

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        let attempt = 0;
        for (;;) {
          const enrollment = yield* options.readEnrollment;
          const opened = Option.isSome(enrollment) ? yield* runOnce(enrollment.value) : false;
          attempt = opened ? 0 : attempt + 1;
          const delay = delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)] ?? 1_000;
          // Up to a quarter more, so Mates that lost one HQ do not all knock on the next at once.
          const spread = yield* Random.nextIntBetween(0, Math.floor(delay / 4) + 1);
          yield* Effect.sleep(Duration.millis(delay + spread));
        }
      }),
    );

    return ZeropsHqLink.of({
      standing: Effect.gen(function* () {
        const held = yield* SubscriptionRef.get(state);
        if (Option.isSome(held)) return { kind: "linked", mate: held.value } as const;
        if (Option.isSome(yield* options.readEnrollment)) return { kind: "not-linked" } as const;
        return { kind: "not-enrolled", outcome: yield* options.readOutcome } as const;
      }),
    });
  });

const EnrollmentFile = Schema.fromJsonString(
  Schema.Struct({ hq: Schema.String, credential: Schema.String }),
);

/** zcp's outcome document: only a state this build can say something of is read. */
const OutcomeFile = Schema.fromJsonString(
  Schema.Struct({
    state: Schema.Literals(["no_hq", "refused"]),
    code: Schema.optional(Schema.String),
  }),
);

/**
 * The link inside a Zerops container whose zcp keeps an enrollment; elsewhere, none: the Mate's
 * state stays unknown. The summary is of the project at the workspace root (the threads the stand-up
 * and every client open the Mate to), looked at again after every domain event.
 */
export const layer = Layer.effect(
  ZeropsHqLink,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = config.zerops?.hqEnrollmentPath;
    if (path === undefined) {
      return ZeropsHqLink.of({
        standing: Effect.succeed({ kind: "not-enrolled", outcome: Option.none() }),
      });
    }
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const projection = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    const signers = yield* ZeropsProjectSigners;
    return yield* makeZeropsHqLink({
      readEnrollment: fs
        .readFileString(path)
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(EnrollmentFile)), Effect.option),
      // Beside the enrollment; a missing, unreadable or unknown document says nothing.
      readOutcome: fs
        .readFileString(paths.join(paths.dirname(path), "outcome.json"))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(OutcomeFile)), Effect.option),
      connect: (url) => new WebSocket(url) as unknown as LinkSocket,
      summary: Effect.gen(function* () {
        const project = Option.getOrUndefined(
          yield* projection.getActiveProjectByWorkspaceRoot(config.cwd),
        );
        const threads =
          project === undefined
            ? []
            : (yield* projection.getShellSnapshot()).threads.filter(
                (thread) => thread.projectId === project.id,
              );
        return mateSummaryOf(threads, yield* signers.signers);
      }).pipe(Effect.option),
      changes: engine.streamDomainEvents,
    });
  }),
);
