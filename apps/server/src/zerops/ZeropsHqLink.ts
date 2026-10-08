// @effect-diagnostics nodeBuiltinImport:off -- the link's socket resolves HQ through `node:dns`.
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
 * - **Up:** the Mate's overview (`zeropsHqOverview.ts`): the whole of it first on every link, then
 *   only the sections that changed, at most once per `MATE_OVERVIEW_EVERY_MS`, looked at again when
 *   something it is made of moves — a domain event, the crew's snapshot, a login, the update line —
 *   and never on a timer; beside it the Mate's attention (`ZeropsMateAttention`), whole on every
 *   link and again at each new revision; `pong` to each of HQ's pings.
 * - **Down:** the Mate's state as HQ holds it (its record, its birth), kept here for whoever asks;
 *   and who its project lets in (`access`), handed on to `ZeropsProjectAccess` with its age.
 *
 * A link that closes or never opens is tried again after a growing wait. HQ is reached over IPv6
 * where it answers there ({@link HQ_LINK_ADDRESS_ORDER}): the Zerops L7 cuts a WebSocket on a
 * project's shared IPv4 at 120 s, and not one on its IPv6. A link that went over anything but IPv6
 * is replaced before that cut ({@link MATE_LINK_ROTATE_MS}): its successor opens beside it, and the
 * old one closes only once HQ answered on the new one, so HQ never holds the Mate without a link.
 *
 * @module ZeropsHqLink
 */
import { isAgentWithoutSignInReady } from "@t3tools/shared/zeropsAgentAuth";
import type { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import { ProviderInstances } from "../spi/providerInstances.ts";
import * as NodeDns from "node:dns";
import type * as NodeNet from "node:net";

import { NodeWS } from "@effect/platform-node/NodeSocket";
import type {
  ConversationRow,
  CrewSnapshot,
  MateAttention,
  MateHealth,
  OrchestrationThreadShell,
  ServerProvider,
} from "@t3tools/contracts";
import {
  MATE_OVERVIEW_EVERY_MS,
  MateLinkDown,
  MateLinkUp,
  type MateOverview,
  type MateOverviewSections,
  type MateState,
  type OverviewIdentity,
} from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
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
import { HttpClient, HttpClientRequest } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ZeropsAgentAuth } from "./ZeropsAgentAuth.ts";
import { combineAgentAuth, ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { ZeropsSignIns } from "./zeropsSignIns.ts";
import { mateOverviewOf } from "./zeropsHqOverview.ts";
import { MateEngine } from "../engine/MateEngine.ts";
import { chatsSource } from "./engineOverview.ts";
import { ZeropsLogins } from "./ZeropsLogins.ts";
import { ZeropsMateAttention } from "./ZeropsMateAttention.ts";
import { ZeropsMateUpdate } from "./ZeropsMateUpdate.ts";
import { ZeropsProjectAccess } from "./ZeropsProjectAccess.ts";
import { MateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";
import type { UsageLink } from "../usage/UsageLink.ts";
import { makeUsageCapture } from "../usage/UsageCapture.ts";

/** The part of a WebSocket the link uses; the global `WebSocket` is one. */
export interface LinkSocket {
  send(data: string): void;
  close(): void;
  /**
   * The address family it went over, once open. Unknown is taken as a path the L7 may cut at 120 s
   * ({@link MATE_LINK_ROTATE_MS}).
   */
  family?(): "IPv4" | "IPv6" | undefined;
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
  readonly autoUpdatePolicy?: Pick<MateAutoUpdatePolicy["Service"], "open">;
  readonly health?: Stream.Stream<MateHealth>;
  readonly usage?: UsageLink;
  /** The enrollment as it stands now; none until zcp has enrolled. */
  readonly readEnrollment: Effect.Effect<Option.Option<HqEnrollment>>;
  /** zcp's last word on enrolling; none when it said nothing this build reads. */
  readonly readOutcome: Effect.Effect<Option.Option<HqOutcome>>;
  readonly connect: ConnectLinkSocket;
  /** The Mate's overview as it stands now; none when it cannot be read, tried again next round. */
  readonly overview: Effect.Effect<Option.Option<MateOverview>>;
  /** Fires whenever the overview may have changed. */
  readonly changes: Stream.Stream<unknown>;
  /** The Mate's attention now, then each new revision (`ZeropsMateAttention.changes`). */
  readonly attention: Stream.Stream<MateAttention>;
  /** Hands on who HQ says the project lets in, and how old HQ's read of Zerops is. */
  readonly relayAccess: ZeropsProjectAccess["Service"]["relayed"];
  /** The waits before each next attempt; the last one repeats. */
  readonly reconnectDelaysMs?: ReadonlyArray<number>;
  /** The least time between two frames of the overview (`MATE_OVERVIEW_EVERY_MS`). */
  readonly overviewEveryMs?: number;
}

export class ZeropsHqLink extends Context.Service<
  ZeropsHqLink,
  {
    /** Where the Mate stands with its HQ now. */
    readonly standing: Effect.Effect<HqStanding>;
  }
>()("t3/zerops/ZeropsHqLink") {}

const DEFAULT_RECONNECT_DELAYS_MS: ReadonlyArray<number> = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * The order the link resolves HQ's addresses in. The Zerops L7 cuts a WebSocket on a project's shared
 * IPv4 120 s after it opened, and not one on the project's IPv6 (verified.md, 2026-10-03): a Mate
 * container has IPv6, so its link normally holds and never rotates. IPv4 is still tried should IPv6
 * not answer (Node's `autoSelectFamily`, on by default), and rotation covers that case.
 */
export const HQ_LINK_ADDRESS_ORDER = "ipv6first";

/** `lookup`, resolving in {@link HQ_LINK_ADDRESS_ORDER} whatever else a connection asks of it. */
export const preferringIpv6 =
  (lookup: NodeNet.LookupFunction): NodeNet.LookupFunction =>
  (hostname, options, callback) =>
    lookup(hostname, { ...options, order: HQ_LINK_ADDRESS_ORDER }, callback);

/**
 * The link's socket (`ws`): HQ resolved {@link HQ_LINK_ADDRESS_ORDER}, and the family it went over
 * said once it opened.
 */
export const connectLinkSocket: ConnectLinkSocket = (url) => {
  const socket = new NodeWS.WebSocket(url, { lookup: preferringIpv6(NodeDns.lookup) });
  let family: string | undefined;
  socket.once("upgrade", (response) => {
    family = response.socket.remoteFamily;
  });
  return Object.assign(socket, {
    family: () => (family === "IPv4" || family === "IPv6" ? family : undefined),
  }) as unknown as LinkSocket;
};

/**
 * How long a link that did not go over IPv6 is kept before its successor opens. The Zerops L7
 * closes a WebSocket on a project's shared IPv4 120 s after it opened, with no close frame,
 * whatever passes over it (measured on KRLS's HQ, F26, 2026-10-03): 100 s leaves the successor
 * 20 s to open and be answered.
 */
export const MATE_LINK_ROTATE_MS = 100_000;

const decodeDown = Schema.decodeUnknownOption(Schema.fromJsonString(MateLinkDown));
const encodeUp = Schema.encodeSync(Schema.fromJsonString(MateLinkUp));

type SocketEvent =
  | { readonly _tag: "open" }
  | { readonly _tag: "message"; readonly raw: string }
  | { readonly _tag: "close" };

const ticketResponse = Schema.Struct({ ticket: Schema.String });

/** An overview's sections, each sent whole when it changed. */
const SECTIONS = ["identity", "main", "threads", "logins", "crew", "conversations"] as const;

/**
 * The sections of `overview` whose JSON differs from what `sent` holds, which then holds them as
 * sent: none when nothing changed.
 */
function changedSections(
  overview: MateOverview,
  sent: Map<string, string>,
): MateOverviewSections | undefined {
  const changed: { -readonly [K in keyof MateOverview]?: MateOverview[K] } = {};
  let any = false;
  const take = <K extends keyof MateOverview>(key: K) => {
    const encoded = JSON.stringify(overview[key]);
    if (sent.get(key) === encoded) return;
    sent.set(key, encoded);
    changed[key] = overview[key];
    any = true;
  };
  for (const key of SECTIONS) take(key);
  return any ? changed : undefined;
}

export const makeZeropsHqLink = (
  options: ZeropsHqLinkOptions,
): Effect.Effect<ZeropsHqLink["Service"], never, HttpClient.HttpClient | Scope.Scope> =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const state = yield* SubscriptionRef.make<Option.Option<MateState>>(Option.none());
    const delays = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    const overviewEvery = Duration.millis(options.overviewEveryMs ?? MATE_OVERVIEW_EVERY_MS);

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

    /**
     * One link opened with a fresh ticket, then relayed in the scope's lifetime until it closes: the
     * overview up, pongs and HQ's state down. `answered` completes on HQ's first state over it — HQ
     * counts the link from before it sends one; `stop` closes it. None when there is no ticket or
     * the socket never opened.
     */
    const openLink = (enrollment: HqEnrollment) =>
      Effect.gen(function* () {
        const ticket = yield* ticketFor(enrollment);
        if (Option.isNone(ticket)) return Option.none();
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
          return Option.none();
        }

        const usage = options.usage ? yield* options.usage.open(send) : undefined;
        let requestSerial = 0;
        const policyRequests = new Map<
          string,
          Deferred.Deferred<Option.Option<HqAutoUpdatePolicy>>
        >();
        const verifyPolicy = Effect.gen(function* () {
          const requestId = String(++requestSerial);
          const answer = yield* Deferred.make<Option.Option<HqAutoUpdatePolicy>>();
          policyRequests.set(requestId, answer);
          return yield* send({ type: "auto-update-policy", requestId }).pipe(
            Effect.andThen(Deferred.await(answer)),
            Effect.timeoutOrElse({
              duration: HQ_AUTO_UPDATE_VERIFY_BUDGET,
              orElse: () => Effect.succeedNone,
            }),
            Effect.ensuring(Effect.sync(() => policyRequests.delete(requestId))),
          );
        });
        const autoUpdatePolicy = options.autoUpdatePolicy
          ? yield* options.autoUpdatePolicy.open(verifyPolicy)
          : undefined;

        const openedAt = yield* Clock.currentTimeMillis;
        const family = socket.family?.();
        const answered = yield* Deferred.make<void>();
        const dirty = yield* Ref.make(true);
        // What this link sent of each section, as JSON: a new link starts with nothing sent.
        const sent = new Map<string, string>();
        const overviews = Effect.forever(
          Effect.gen(function* () {
            if (yield* Ref.getAndSet(dirty, false)) {
              const overview = yield* options.overview;
              if (Option.isNone(overview)) yield* Ref.set(dirty, true);
              else if (sent.size === 0) {
                changedSections(overview.value, sent);
                yield* send({ type: "overview", full: true, overview: overview.value });
              } else {
                const sections = changedSections(overview.value, sent);
                if (sections !== undefined) {
                  yield* send({ type: "overview", full: false, sections });
                }
              }
            }
            yield* Effect.sleep(overviewEvery);
          }),
        );
        const heard = Stream.runForEach(options.changes, () => Ref.set(dirty, true));
        const health =
          options.health === undefined
            ? Effect.never
            : Stream.runForEach(options.health, (value) => send({ type: "health", health: value }));
        const attention = Stream.runForEach(options.attention, (value) =>
          send({ type: "attention", attention: value }),
        );
        const relay = Stream.fromQueue(events).pipe(
          Stream.takeWhile((event) => event._tag === "message"),
          Stream.runForEach((event) => {
            if (event._tag !== "message") return Effect.void;
            const message = decodeDown(event.raw);
            if (Option.isNone(message)) return Effect.void;
            switch (message.value.type) {
              case "auto-update-policy": {
                const answer = policyRequests.get(message.value.requestId);
                return answer === undefined
                  ? Effect.void
                  : Deferred.succeed(answer, Option.some(message.value.policy));
              }
              case "ping":
                return send({ type: "pong" }).pipe(Effect.andThen(usage?.ping ?? Effect.void));
              case "state":
                return SubscriptionRef.set(state, Option.some(message.value.mate)).pipe(
                  Effect.andThen(
                    autoUpdatePolicy?.receive(Option.fromUndefinedOr(message.value.autoUpdate)) ??
                      Effect.void,
                  ),
                  Effect.andThen(Deferred.succeed(answered, undefined)),
                  Effect.andThen(usage?.state(message.value) ?? Effect.void),
                );
              case "access":
                return options.relayAccess({
                  members: message.value.members,
                  ageMs: message.value.ageMs,
                });
              default:
                return usage?.receive(message.value) ?? Effect.void;
            }
          }),
        );
        const relayed = yield* Effect.forkScoped(
          Effect.raceFirst(
            relay,
            Effect.all([overviews, heard, attention, health, ...(usage ? [usage.run] : [])], {
              concurrency: "unbounded",
            }),
          ).pipe(Effect.ensuring(quit), Effect.ensuring(autoUpdatePolicy?.close ?? Effect.void)),
        );
        return Option.some({
          openedAt,
          family,
          answered,
          closed: Fiber.join(relayed),
          stop: Fiber.interrupt(relayed),
        });
      });

    /**
     * Links, and keeps the Mate linked: each link is replaced by a successor before the L7's cut,
     * the old one closed once HQ answered on the new. A successor that does not open or is not
     * answered is let go, and the old link kept until it closes. Whether a link opened.
     */
    const runOnce = (enrollment: HqEnrollment) =>
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* openLink(enrollment);
          if (Option.isNone(opened)) return false;
          let current = opened.value;
          for (;;) {
            // Only the shared IPv4 is cut at 120 s: a link over IPv6 is kept as it is.
            if (current.family === "IPv6") {
              yield* current.closed;
              return true;
            }
            const rotateAt = current.openedAt + MATE_LINK_ROTATE_MS;
            const successor = Effect.gen(function* () {
              yield* Effect.sleep(Duration.millis(rotateAt - (yield* Clock.currentTimeMillis)));
              const now = yield* options.readEnrollment;
              const next = Option.isSome(now) ? yield* openLink(now.value) : Option.none();
              if (Option.isNone(next)) return yield* Effect.never;
              const answered = yield* Effect.raceFirst(
                Deferred.await(next.value.answered).pipe(Effect.as(true)),
                next.value.closed.pipe(Effect.as(false)),
              );
              if (!answered) return yield* Effect.never;
              return next.value;
            });
            const ended = yield* Effect.raceFirst(
              current.closed.pipe(Effect.as(Option.none())),
              successor.pipe(Effect.map(Option.some)),
            );
            if (Option.isNone(ended)) return true;
            yield* current.stop;
            current = ended.value;
          }
        }),
      );

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        let attempt = 0;
        for (;;) {
          const enrollment = yield* options.readEnrollment;
          // A link that failed, whatever failed in it, is tried again after a growing wait: the loop
          // never ends.
          const began = yield* Clock.currentTimeMillis;
          const opened = Option.isSome(enrollment)
            ? yield* runOnce(enrollment.value).pipe(Effect.catchCause(() => Effect.succeed(false)))
            : false;
          // Only a link that stayed up resets the wait; one HQ closes at once is a failure too.
          const lived = (yield* Clock.currentTimeMillis) - began;
          attempt = opened && lived >= LINK_STABLE_MS ? 0 : attempt + 1;
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

/** How long a link must stay up before the next reconnect starts from the shortest wait. */
const LINK_STABLE_MS = 30_000;
/** A missing correlated answer withholds permission; the deadline never substitutes a policy. */
export const HQ_AUTO_UPDATE_VERIFY_BUDGET = Duration.seconds(5);

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

/** Where a Mate's overview is read from: the services the link's layer finds, by what it reads. */
export interface OverviewSources {
  readonly lastSigners?: Effect.Effect<Readonly<Record<string, string>>>;
  readonly environmentId: OverviewIdentity["environmentId"];
  readonly serverVersion: string;
  readonly providers?: {
    readonly latest: Effect.Effect<ReadonlyArray<ServerProvider>>;
    readonly changes: Stream.Stream<unknown>;
  };
  /** The thread shells of the project at the workspace root. */
  readonly threads: Effect.Effect<
    ReadonlyArray<OrchestrationThreadShell>,
    ProjectionRepositoryError
  >;
  /** The crew engine's snapshot now, then one per change (`CrewEngine`). */
  readonly crew: { readonly snapshot: Stream.Stream<CrewSnapshot> };
  /** The three feeds the client's agent-auth stream combines: who signed each login in, too. */
  readonly agentAuth: Pick<ZeropsAgentAuth["Service"], "latest" | "changes">;
  readonly agentLogin: Pick<ZeropsAgentLogin["Service"], "latest" | "changes">;
  readonly logins: Pick<ZeropsLogins["Service"], "latest" | "changes">;
  /** The update line, and when it moves (`ZeropsMateUpdate`). */
  readonly update: Pick<ZeropsMateUpdate["Service"], "current" | "changes">;
  /** Every orchestration domain event. */
  readonly domainEvents: Stream.Stream<unknown>;
  /** An engine Mate's own rows, sent beside the threads' shell fields; none on a V1 Mate. */
  readonly conversations?: Effect.Effect<ReadonlyArray<ConversationRow>, ProjectionRepositoryError>;
  /** The engine its conversation runs on, by the protocol its rows speak; none on a V1 Mate. */
  readonly engine?: { readonly protocol: number };
}

/**
 * The overview as it stands, read from `sources`, and when it may have changed. The crew's
 * snapshot comes as a stream only, so the last one is held for as long as the scope lasts — the
 * first overview of every link already carries it, once the engine has said anything.
 */
export const mateOverviewFeed = (
  sources: OverviewSources,
): Effect.Effect<Pick<ZeropsHqLinkOptions, "overview" | "changes">, never, Scope.Scope> =>
  Effect.gen(function* () {
    const crew = yield* Ref.make<CrewSnapshot | undefined>(undefined);
    // Told only once the snapshot is held, so the overview it wakes reads it.
    const crewMoved = yield* PubSub.unbounded<void>();
    yield* Effect.forkScoped(
      Stream.runForEach(sources.crew.snapshot, (snapshot) =>
        Ref.set(crew, snapshot).pipe(Effect.andThen(PubSub.publish(crewMoved, undefined))),
      ),
    );
    const overview = Effect.gen(function* () {
      const [snapshot, extras, logins] = yield* Effect.all([
        sources.agentAuth.latest,
        sources.logins.latest,
        sources.agentLogin.latest,
      ]);
      return mateOverviewOf({
        identity: {
          environmentId: sources.environmentId,
          serverVersion: sources.serverVersion,
          update: (yield* sources.update.current) ?? null,
          ...(sources.engine === undefined ? {} : { engine: sources.engine }),
          ...(sources.providers === undefined
            ? {}
            : {
                runsWithoutSignIn: (yield* sources.providers.latest).some(
                  isAgentWithoutSignInReady,
                ),
              }),
        },
        threads: yield* sources.threads,
        auth: combineAgentAuth(snapshot, extras, logins),
        ...(sources.lastSigners === undefined ? {} : { lastSigners: yield* sources.lastSigners }),
        crew: yield* Ref.get(crew),
        ...(sources.conversations === undefined
          ? {}
          : { conversations: yield* sources.conversations }),
      });
    }).pipe(Effect.option);
    return {
      overview,
      changes: Stream.mergeAll(
        [
          sources.domainEvents,
          ...(sources.providers === undefined ? [] : [sources.providers.changes]),
          Stream.fromPubSub(crewMoved),
          sources.agentAuth.changes,
          sources.agentLogin.changes,
          sources.logins.changes,
          sources.update.changes,
        ],
        { concurrency: "unbounded" },
      ),
    };
  });

/**
 * The link inside a Zerops container whose zcp keeps an enrollment; elsewhere, none: the Mate's
 * state stays unknown. The overview is of the project at the workspace root (the threads the
 * stand-up and every client open the Mate to), looked at again whenever one of its feeds moves. The crew
 * engine's snapshot is handed in by the layer that composes crew mode (`zeropsFeedsLayer.ts`): only
 * the wiring reaches into `zerops/crew`.
 */
export const layer = (crew: OverviewSources["crew"]) =>
  Layer.effect(
    ZeropsHqLink,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const paths = yield* Path.Path;
      const projection = yield* ProjectionSnapshotQuery;
      const engine = yield* OrchestrationEngineService;
      const providers = yield* ProviderInstances;
      // Separate home database: capture IO cannot lock the orchestration event store.
      // Admission waits for a subscribed capture service, including across storage recovery.
      const usage = yield* makeUsageCapture(paths.join(config.stateDir, "usage.sqlite"));
      const path = config.zerops?.hqEnrollmentPath;
      if (path === undefined) {
        return ZeropsHqLink.of({
          standing: Effect.succeed({ kind: "not-enrolled", outcome: Option.none() }),
        });
      }
      const fs = yield* FileSystem.FileSystem;
      // While the Mate engine owns the conversation, its conversations are the chats: V1's
      // projections (a thread left running at the flip among them) are never read.
      const attention = yield* ZeropsMateAttention;
      const chats = chatsSource(
        yield* MateEngine,
        {
          threads: Effect.gen(function* () {
            const project = Option.getOrUndefined(
              yield* projection.getActiveProjectByWorkspaceRoot(config.cwd),
            );
            return project === undefined
              ? []
              : (yield* projection.getShellSnapshot()).threads.filter(
                  (thread) => thread.projectId === project.id,
                );
          }),
          domainEvents: engine.streamDomainEvents,
        },
        // The revision an engine row carries: the attention's source, as the engine wire's.
        Effect.map(attention.current, ({ source }) => source),
      );
      const feed = yield* mateOverviewFeed({
        providers: { latest: providers.providers, changes: providers.changes },
        environmentId: yield* (yield* ServerEnvironment).getEnvironmentId,
        serverVersion: packageJson.version,
        threads: chats.threads,
        crew,
        agentAuth: yield* ZeropsAgentAuth,
        agentLogin: yield* ZeropsAgentLogin,
        lastSigners: (yield* ZeropsSignIns).lastSigners,
        logins: yield* ZeropsLogins,
        update: yield* ZeropsMateUpdate,
        domainEvents: chats.domainEvents,
        ...(chats.conversations === undefined ? {} : { conversations: chats.conversations }),
        ...(chats.engine === undefined ? {} : { engine: chats.engine }),
      });
      return yield* makeZeropsHqLink({
        readEnrollment: fs
          .readFileString(path)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(EnrollmentFile)), Effect.option),
        // Beside the enrollment; a missing, unreadable or unknown document says nothing.
        readOutcome: fs
          .readFileString(paths.join(paths.dirname(path), "outcome.json"))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(OutcomeFile)), Effect.option),
        connect: connectLinkSocket,
        relayAccess: (yield* ZeropsProjectAccess).relayed,
        autoUpdatePolicy: yield* MateAutoUpdatePolicy,
        attention: attention.changes,
        health: attention.healthChanges,
        usage,
        ...feed,
      });
    }),
  );
