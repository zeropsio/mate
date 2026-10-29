import { ZeropsConnections } from "./ZeropsConnections.ts";
import { ZeropsTicketDoor, type TicketFrame } from "./ZeropsTicketDoor.ts";
// @effect-diagnostics nodeBuiltinImport:off -- the link's socket resolves HQ through `node:dns`.
/**
 * The Mate's link to its HQ (mate-hq `spec/protocol.md`, "Mate link"; `@t3tools/shared/mateLink`, the keys model): one
 * outbound WebSocket, kept open for as long as this server runs.
 *
 * - **Who it is:** the project's key (`ZeropsMateKey`), read afresh before every dial and sent as
 *   the first frame (`hello`, with the service's label); nothing goes in the URL. The HQ is the one
 *   the server was started with (`ZeropsEnvironment.hqOrigin`). While the container holds no key,
 *   nothing is dialled and the link waits as after a failed one.
 * - **Up:** once HQ answered the hello with its first state, the Mate's overview
 *   (`zeropsHqOverview.ts`): the whole of it first on every link, then only the sections that
 *   changed, at most once per `MATE_OVERVIEW_EVERY_MS`, looked at again when something it is made
 *   of moves — a domain event, the crew's snapshot, a login, the update line — and never on a
 *   timer; beside it the Mate's attention (`ZeropsMateAttention`), whole on every link and again at
 *   each new revision; `pong` to each of HQ's pings.
 * - **Down:** the Mate's state as HQ holds it, kept here for whoever asks and handed on to
 *   `ZeropsAutomation` (whether the Mate is automated) and to `ZeropsChiefRestart`, which rotates
 *   every session on a moved Chief mark (`chief`); who its project opens for and lists (`access`), handed on to
 *   `ZeropsMateAccessList`; the Mate's Git credential (`git-credential`), handed on to
 *   `ZeropsGitCredentialFile`, never logged; an automated Mate's keys (`provider-keys`), handed on
 *   to `ZeropsAutomation`, never logged; and the tasks HQ hands an automated Mate (`task`), the
 *   follow-ups people say on them (`task-message`) and their stops (`task-stop`), worked by
 *   `ZeropsTasks`, whose reports go up as `task-state` — the latest task's first on every link —
 *   and only on a link whose HQ said in its state that the Mate is automated. A task's frame told
 *   before HQ's first state on a link is held until it comes ({@link HQ_TASK_HOLD}).
 * - **Closed:** HQ names why (`MateLinkClosed`). A refused key (`4401`) or one HQ does not admit
 *   (`4403`, its code the reason) is the Mate's standing until HQ next sends its state; a link
 *   superseded by the Mate's own newer one (`4409`) is expected.
 *
 * A link that closes or never opens is tried again after a growing wait; one superseded (`4409`)
 * after the shortest. HQ is reached over IPv6 where it answers there ({@link HQ_LINK_ADDRESS_ORDER}):
 * the Zerops L7 cuts a WebSocket on a project's shared IPv4 at 120 s, and not one on its IPv6. A
 * link that went over anything but IPv6 is replaced before that cut ({@link MATE_LINK_ROTATE_MS}):
 * its successor opens beside it, HQ closes the old one `4409` once it admits the new, and the Mate
 * waits on the successor rather than linking anew, so HQ never holds the Mate without a link.
 *
 * @module ZeropsHqLink
 */
import { mateRunsWithoutSignIn } from "@t3tools/shared/zeropsAgentAuth";
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
import { type MateTaskReport, TrimmedNonEmptyString } from "@t3tools/contracts";
import {
  KeyLinkDown,
  KeyLinkUp,
  type KeyLinkAccess,
  type LinkedMate,
  MATE_OVERVIEW_EVERY_MS,
  MateLinkClosed,
  type MateOverview,
  type MateOverviewSections,
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
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
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
import { makeChiefRestart } from "./ZeropsChiefRestart.ts";
import { ZeropsGitCredentialFile } from "./ZeropsGitCredentialFile.ts";
import { ZeropsObserveCredentialFile } from "./ZeropsObserveCredentialFile.ts";
import { ZeropsMateKey } from "./ZeropsMateKey.ts";
import type { ZeropsKeyRefusal } from "./ZeropsKeyRefusal.ts";
import { ZeropsAutomation } from "./ZeropsAutomation.ts";
import { ZeropsTasks } from "./ZeropsTasks.ts";
import { ZEROPS_SUBJECT_PREFIX, zeropsUserIdOf } from "./zeropsSubject.ts";
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
  addEventListener(type: "open" | "error", listener: () => void): void;
  addEventListener(
    type: "close",
    listener: (event: { readonly code: number; readonly reason: unknown }) => void,
  ): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

export type ConnectLinkSocket = (url: string) => LinkSocket;

/** How a link closed: HQ's code and reason, or none where the socket failed without one. */
export interface LinkClose {
  readonly keyChanged?: true;
  readonly code?: number;
  readonly reason?: string;
}

/** Where the Mate stands with its HQ. */
export type HqStanding =
  /**
   * HQ has not sent the Mate yet; or it refused the key, why as HQ's close reason; or the Mate
   * does not dial because it does not know its public origin (`withheld`).
   */
  | {
      readonly kind: "not-linked";
      readonly refusal?: string;
      readonly withheld?: "no_public_origin";
    }
  /** The Mate as HQ last sent it. */
  | { readonly kind: "linked"; readonly mate: LinkedMate };

/** The close code HQ supersedes a link with: the Mate's own newer link took over. */
const SUPERSEDED = 4409;
/** `1001` and `1012`: HQ is going away or restarting (a rolling deploy); the Mate relinks to its other container. */
const PLANNED_HANDOVER: ReadonlyArray<number> = [1001, 1012];

const decodeClosed = Schema.decodeUnknownOption(MateLinkClosed);

/** HQ's refusal of the key a link closed with (`4401`, `4403`): its reason; none for any other. */
export const refusalOf = (close: LinkClose | undefined): string | undefined => {
  const closed = decodeClosed(close);
  return Option.isSome(closed) && "reason" in closed.value ? closed.value.reason : undefined;
};

/**
 * Whether the session's `subject` only reads along in this Mate: a Zerops person other than the
 * owner HQ last named. Nobody does while HQ names no owner, as the client opens its composer then.
 */
export const readsAlongOnly = (standing: HqStanding, subject: string): boolean =>
  standing.kind === "linked" &&
  typeof standing.mate.ownerUserId === "string" &&
  subject.startsWith(ZEROPS_SUBJECT_PREFIX) &&
  zeropsUserIdOf(subject) !== standing.mate.ownerUserId;

export interface ZeropsHqLinkOptions {
  readonly autoUpdatePolicy?: Pick<MateAutoUpdatePolicy["Service"], "open">;
  readonly health?: Stream.Stream<MateHealth>;
  readonly usage?: UsageLink;
  /** The HQ the Mate links to, as `https://host`. */
  readonly hqOrigin: string;
  /** The label HQ shows the link by: this container's service. */
  readonly serviceId: string;
  /** This container's public origin, told to HQ in the hello; none: the Mate does not link. */
  readonly publicOrigin: string | undefined;
  /** The project's key as it stands now, read afresh for every dial; none while there is none. */
  readonly readKey: Effect.Effect<string | undefined>;
  readonly keyRefusal?: ZeropsKeyRefusal;
  readonly connect: ConnectLinkSocket;
  /** The Mate's overview as it stands now; none when it cannot be read, tried again next round. */
  readonly overview: Effect.Effect<Option.Option<MateOverview>>;
  /** Fires whenever the overview may have changed. */
  readonly changes: Stream.Stream<unknown>;
  /** The Mate's attention now, then each new revision (`ZeropsMateAttention.changes`). */
  readonly attention: Stream.Stream<MateAttention>;
  /** Hands on who HQ says the project opens for and lists (`ZeropsMateAccessList`). */
  readonly ticket?: (frame: TicketFrame) => Effect.Effect<void>;
  readonly closeSession?: (sessionId: string) => Effect.Effect<void>;
  readonly access: (frame: KeyLinkAccess) => Effect.Effect<void>;
  /** Hands on the Mate's Git credential, or HQ's revocation of it (`ZeropsGitCredentialFile`). */
  readonly gitCredential: (credential: string | null) => Effect.Effect<void>;
  /** Writes or removes the explicit personal Observe credential, returning its durable receipt. */
  readonly observeCredential?: (credential: string | null) => Effect.Effect<boolean>;
  /** The fingerprint of the Git credential held now, read afresh for every dial; HQ keeps a live one it names. */
  readonly gitFingerprint: Effect.Effect<Option.Option<string>>;
  /** Hands on the project HQ's Chief mark names, or none, with every state HQ sends. */
  readonly chief?: (projectId: string | null) => Effect.Effect<void>;
  /** Hands on HQ's word on the Mate and the organization's keys (`ZeropsAutomation`). */
  readonly automation?: Pick<ZeropsAutomation["Service"], "heard" | "keysHeard">;
  /** Works the tasks HQ hands an automated Mate, and says how each stands (`ZeropsTasks`). */
  readonly tasks?: ZeropsTasks["Service"];
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
 * whatever passes over it (measured on the organization's HQ, F26, 2026-10-03): 100 s leaves the successor
 * 20 s to open and be answered.
 */
export const MATE_LINK_ROTATE_MS = 100_000;

const decodeDown = Schema.decodeUnknownResult(Schema.fromJsonString(KeyLinkDown));
const encodeUp = Schema.encodeSync(Schema.fromJsonString(KeyLinkUp));
/** The task a `task` frame names, read past what of it the Mate cannot decode. */
const decodeNamedTask = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal("task"),
      task: Schema.Struct({ id: TrimmedNonEmptyString }),
    }),
  ),
);
/** What HQ hears of a task the Mate could not read, and passes on to where it came from. */
const UNREAD_TASK = "This Mate could not read the task as HQ sent it.";

type SocketEvent =
  | { readonly _tag: "open" }
  | {
      readonly _tag: "message";
      readonly raw: string;
      readonly frame: ReturnType<typeof decodeDown>;
    }
  | { readonly _tag: "close"; readonly close: LinkClose | undefined };

/** One link while it lives. */
interface Link {
  readonly openedAt: number;
  readonly family: "IPv4" | "IPv6" | undefined;
  /** Completes on HQ's first state over the link. */
  readonly answered: Deferred.Deferred<void>;
  /** How the link closed, once it did. */
  readonly closed: Effect.Effect<LinkClose | undefined>;
  readonly stop: Effect.Effect<void>;
}

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
): Effect.Effect<ZeropsHqLink["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make<Option.Option<LinkedMate>>(Option.none());
    // HQ's refusal of the key on the latest link that closed, until HQ next sends its state.
    const refusal = yield* Ref.make<string | undefined>(undefined);
    let reportedKey: string | undefined;
    // Links are numbered as they open; the current one is the newest HQ answered on. A credential
    // is written only from the current link, one write at a time, so a superseded link's frame
    // neither lands after nor races the current link's.
    let linksOpened = 0;
    let currentLink = 0;
    const credentialWrites = yield* Semaphore.make(1);
    const observeWrites = yield* Semaphore.make(1);
    const delays = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    const overviewEvery = Duration.millis(options.overviewEveryMs ?? MATE_OVERVIEW_EVERY_MS);
    const url = `${options.hqOrigin.replace(/^http/u, "ws").replace(/\/+$/u, "")}/api/mate/link`;

    /**
     * One link, opened with the project's key in its first frame, then relayed in the scope's
     * lifetime until it closes: the overview up once HQ answered, pongs and HQ's frames down.
     * `answered` completes on HQ's first state over it — HQ admitted the key; `stop` closes it.
     * None when there is no key or the socket never opened.
     */
    const openLink = Effect.gen(function* () {
      const key = yield* options.readKey;
      if (key === undefined || key === "" || options.publicOrigin === undefined) {
        return Option.none<Link>();
      }
      const origin = options.publicOrigin;
      const serial = ++linksOpened;
      const events = yield* Queue.unbounded<SocketEvent>();
      const clock = yield* Clock.Clock;
      const pingInterval = yield* Deferred.make<number>();
      let lastInboundAt = clock.monotonicTimeNanosUnsafe();
      const socket = options.connect(url);
      socket.addEventListener("open", () => Queue.offerUnsafe(events, { _tag: "open" }));
      socket.addEventListener("message", (event) => {
        // Ingress is liveness even while a consumer waits, or this build cannot read the frame.
        lastInboundAt = clock.monotonicTimeNanosUnsafe();
        const raw = String(event.data);
        const frame = decodeDown(raw);
        if (
          Result.isSuccess(frame) &&
          frame.success.type === "state" &&
          frame.success.pingIntervalMs !== undefined
        ) {
          // The first announcement owns this generation's cadence; older HQs never arm it.
          Deferred.doneUnsafe(pingInterval, Effect.succeed(frame.success.pingIntervalMs));
        }
        Queue.offerUnsafe(events, { _tag: "message", raw, frame });
      });
      socket.addEventListener("close", (event) =>
        Queue.offerUnsafe(events, {
          _tag: "close",
          close: { code: event.code, reason: String(event.reason ?? "") },
        }),
      );
      socket.addEventListener("error", () =>
        Queue.offerUnsafe(events, { _tag: "close", close: undefined }),
      );
      const send = (message: KeyLinkUp) =>
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
      const silence = Effect.gen(function* () {
        const period = yield* Deferred.await(pingInterval);
        for (;;) {
          const elapsed = Number(clock.monotonicTimeNanosUnsafe() - lastInboundAt) / 1_000_000;
          const remaining = 3 * period - elapsed;
          if (remaining <= 0) {
            yield* quit;
            return undefined;
          }
          yield* Effect.sleep(Duration.millis(remaining));
        }
      });
      const first = yield* Queue.take(events);
      if (first._tag !== "open") {
        yield* quit;
        return Option.none<Link>();
      }
      const gitFingerprint = yield* options.gitFingerprint;
      yield* send({
        type: "hello",
        key,
        serviceId: options.serviceId,
        origin,
        ...(Option.isSome(gitFingerprint) ? { gitFingerprint: gitFingerprint.value } : {}),
      });
      const keyChanged = yield* Deferred.make<LinkClose>();
      let sentKey: string | undefined;
      const keyRefusals = options.keyRefusal
        ? Stream.runForEach(options.keyRefusal.changes, (notice) =>
            Effect.gen(function* () {
              // Notices are retained across reconnects; fence them with the live env value.
              const currentKey = yield* options.readKey;
              if (currentKey !== key) {
                yield* Deferred.succeed(keyChanged, { keyChanged: true });
                return;
              }
              // An old request cannot accuse a newer link's key.
              if (notice.refusedKey !== key || notice.currentKey !== key) return;
              yield* Effect.sync(() => {
                if (reportedKey === key || sentKey === key) return;
                try {
                  socket.send(encodeUp({ type: "key-refused" }));
                  // Delivered only once HQ speaks after it: a send on a closing link is lost.
                  sentKey = key;
                } catch {
                  // A failed send is still owed on the next link.
                }
              });
            }),
          )
        : Effect.never;

      const usage = options.usage ? yield* options.usage.open(send) : undefined;
      // Whether HQ's latest state on this link says the Mate is automated: only then are tasks
      // reported on it.
      const automatedHere = yield* Ref.make(false);
      const reportTask = (report: MateTaskReport) =>
        Effect.flatMap(Ref.get(automatedHere), (automated) =>
          automated ? send({ type: "task-state", report }) : Effect.void,
        );
      const tasks = options.tasks ? yield* options.tasks.open(reportTask) : undefined;
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
      // HQ counts nothing the Mate says before it admitted the key with its first state.
      const onceAnswered = <A, E>(effect: Effect.Effect<A, E>) =>
        Deferred.await(answered).pipe(Effect.andThen(effect));
      // The tasks' reports, from HQ's first state on, on a link whose HQ does automated Mates.
      const reporting =
        tasks === undefined
          ? Effect.never
          : onceAnswered(Ref.get(automatedHere)).pipe(
              Effect.flatMap((automated) => (automated ? tasks.run : Effect.never)),
            );
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
      /**
       * A task's frame (`task`, `task-message`, `task-stop`), held beside the frames that follow,
       * for as long as the link lives, until HQ's first state; HQ tells it again if that never
       * comes.
       */
      const onceStated = (heard: Effect.Effect<void>) =>
        Effect.asVoid(
          Deferred.await(answered).pipe(
            Effect.timeoutOrElse({ duration: HQ_TASK_HOLD, orElse: () => Effect.void }),
            Effect.andThen(Deferred.isDone(answered)),
            Effect.flatMap((stated) => (stated ? heard : Effect.void)),
            Effect.forkChild,
          ),
        );
      const receive = (frame: KeyLinkDown): Effect.Effect<void> => {
        switch (frame.type) {
          case "auto-update-policy": {
            const answer = policyRequests.get(frame.requestId);
            return answer === undefined
              ? Effect.void
              : Deferred.succeed(answer, Option.some(frame.policy));
          }
          case "ping":
            return send({ type: "pong" }).pipe(Effect.andThen(usage?.ping ?? Effect.void));
          case "state":
            if (sentKey !== undefined) reportedKey = sentKey;
            currentLink = Math.max(currentLink, serial);
            return SubscriptionRef.set(state, Option.some(frame.mate)).pipe(
              Effect.andThen(Ref.set(refusal, undefined)),
              Effect.andThen(Ref.set(automatedHere, frame.mate.automated === true)),
              Effect.andThen(options.automation?.heard(frame.mate) ?? Effect.void),
              Effect.andThen(options.chief?.(frame.mate.chief?.projectId ?? null) ?? Effect.void),
              Effect.andThen(
                autoUpdatePolicy?.receive(Option.fromUndefinedOr(frame.autoUpdate)) ?? Effect.void,
              ),
              Effect.andThen(Deferred.succeed(answered, undefined)),
              Effect.andThen(usage?.state(frame) ?? Effect.void),
            );
          case "access":
            return options.access(frame);
          case "git-credential":
            return credentialWrites.withPermits(1)(
              Effect.suspend(() =>
                serial < currentLink ? Effect.void : options.gitCredential(frame.credential),
              ),
            );
          case "observe-credential":
            return observeWrites.withPermits(1)(
              Effect.suspend(() =>
                serial < currentLink
                  ? Effect.succeed(false)
                  : (options.observeCredential?.(frame.credential) ?? Effect.succeed(false)),
              ).pipe(
                Effect.flatMap((ok) => send({ type: "observe-credential-ack", id: frame.id, ok })),
              ),
            );
          case "provider-keys":
            return options.automation?.keysHeard(frame.keys, frame.model) ?? Effect.void;
          case "task":
            return tasks === undefined ? Effect.void : onceStated(tasks.receive(frame.task));
          case "task-message":
            return tasks === undefined
              ? Effect.void
              : onceStated(tasks.message(frame.taskId, frame.message, frame.change));
          case "task-stop":
            return tasks === undefined
              ? Effect.void
              : onceStated(tasks.stop(frame.taskId, frame.reason, frame.requeued === true));
          case "ticket":
            return options.ticket === undefined
              ? Effect.void
              : options
                  .ticket(frame)
                  .pipe(Effect.andThen(send({ type: "ticket-ack", ticket: frame.ticket })));
          case "close-session":
            return options.closeSession?.(frame.sessionId) ?? Effect.void;
          default:
            return usage?.receive(frame) ?? Effect.void;
        }
      };
      /**
       * A frame the Mate cannot decode: one of a newer HQ's it reads past, but a task's is logged
       * with why and answered `failed`, so HQ and the task's source hear it was not worked.
       */
      const undecoded = (raw: string, error: Schema.SchemaError): Effect.Effect<void> => {
        const named = decodeNamedTask(raw);
        if (Option.isNone(named)) return Effect.void;
        const taskId = named.value.task.id;
        return Effect.logWarning("zerops hq link: could not read a task HQ sent", {
          taskId,
          error: error.message,
        }).pipe(
          Effect.andThen(onceStated(reportTask({ taskId, state: "failed", detail: UNREAD_TASK }))),
        );
      };
      const relay = Effect.gen(function* () {
        for (;;) {
          const event = yield* Queue.take(events);
          if (event._tag === "close") return event.close;
          if (event._tag !== "message") continue;
          const frame = event.frame;
          if (Result.isSuccess(frame)) yield* receive(frame.success);
          else yield* undecoded(event.raw, frame.failure);
        }
      });
      const relayed = yield* Effect.forkScoped(
        Effect.raceFirst(
          Effect.raceFirst(Effect.raceFirst(relay, silence), Deferred.await(keyChanged)),
          Effect.all(
            [
              onceAnswered(overviews),
              heard,
              onceAnswered(attention),
              onceAnswered(health),
              ...(usage ? [onceAnswered(usage.run)] : []),
              reporting,
              keyRefusals,
            ],
            { concurrency: "unbounded" },
          ).pipe(Effect.as(undefined)),
        ).pipe(Effect.ensuring(quit), Effect.ensuring(autoUpdatePolicy?.close ?? Effect.void)),
      );
      return Option.some<Link>({
        openedAt,
        family,
        answered,
        closed: Fiber.join(relayed),
        stop: Fiber.interrupt(relayed),
      });
    });

    /**
     * A successor to a link not over IPv6, dialled at its rotation time: it once HQ answered on it,
     * none where it did not open or closed unanswered. `dialing` is set once it is being dialled.
     */
    const successorOf = (current: Link, dialing: Ref.Ref<boolean>) =>
      Effect.gen(function* () {
        const rotateAt = current.openedAt + MATE_LINK_ROTATE_MS;
        yield* Effect.sleep(Duration.millis(rotateAt - (yield* Clock.currentTimeMillis)));
        yield* Ref.set(dialing, true);
        const next = yield* openLink;
        if (Option.isNone(next)) return Option.none<Link>();
        const answered = yield* Effect.raceFirst(
          Deferred.await(next.value.answered).pipe(Effect.as(true)),
          next.value.closed.pipe(Effect.as(false)),
        );
        return answered ? next : Option.none<Link>();
      });

    /**
     * Links, and keeps the Mate linked: each link not over IPv6 is replaced by a successor before
     * the L7's cut, the old one closed once HQ answered on the new. HQ closes the old one `4409` as
     * it admits the new; the Mate then waits on the successor. A successor that does not open or is
     * not answered is let go, and the old link kept until it closes. Whether a link opened, and how
     * the last one closed.
     */
    const runOnce = Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* openLink;
        if (Option.isNone(opened)) return { opened: false } as const;
        let current = opened.value;
        for (;;) {
          // Only the shared IPv4 is cut at 120 s: a link over IPv6 is kept as it is.
          if (current.family === "IPv6") return { opened: true, close: yield* current.closed };
          const dialing = yield* Ref.make(false);
          const successor = yield* Effect.forkScoped(successorOf(current, dialing));
          const ended = yield* Effect.raceFirst(
            current.closed.pipe(Effect.map((close) => ({ _tag: "closed", close }) as const)),
            Fiber.join(successor).pipe(
              Effect.flatMap((next) =>
                Option.isSome(next)
                  ? Effect.succeed({ _tag: "next", link: next.value } as const)
                  : Effect.never,
              ),
            ),
          );
          if (ended._tag === "next") {
            yield* current.stop;
            current = ended.link;
            continue;
          }
          if (ended.close?.code !== SUPERSEDED || !(yield* Ref.get(dialing))) {
            yield* Fiber.interrupt(successor);
            return { opened: true, close: ended.close };
          }
          // Superseded by the successor being dialled: it takes over once HQ answers on it.
          const next = yield* Fiber.join(successor);
          if (Option.isNone(next)) return { opened: true, close: ended.close };
          current = next.value;
        }
      }),
    );

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        let attempt = 0;
        for (;;) {
          // A link that failed, whatever failed in it, is tried again after a growing wait: the loop
          // never ends.
          const began = yield* Clock.currentTimeMillis;
          const ran = yield* runOnce.pipe(
            Effect.catchCause(() => Effect.succeed({ opened: false } as const)),
          );
          const close = "close" in ran ? ran.close : undefined;
          if (close?.keyChanged) {
            attempt = 0;
            continue;
          }
          const refused = refusalOf(close);
          if (refused !== undefined) yield* Ref.set(refusal, refused);
          // Only a link that stayed up, one the Mate's own newer link superseded, or one HQ handed
          // over on purpose resets the wait; one HQ closes at once is a failure too.
          const lived = (yield* Clock.currentTimeMillis) - began;
          const planned =
            close?.code === SUPERSEDED ||
            (close?.code !== undefined && PLANNED_HANDOVER.includes(close.code));
          attempt = planned || (ran.opened && lived >= LINK_STABLE_MS) ? 0 : attempt + 1;
          const delay = delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)] ?? 1_000;
          // Up to a quarter more, so Mates that lost one HQ do not all knock on the next at once.
          const spread = yield* Random.nextIntBetween(0, Math.floor(delay / 4) + 1);
          yield* Effect.sleep(Duration.millis(delay + spread));
        }
      }),
    );

    return ZeropsHqLink.of({
      standing: Effect.gen(function* () {
        if (options.publicOrigin === undefined) {
          return { kind: "not-linked", withheld: "no_public_origin" } as const;
        }
        const refused = yield* Ref.get(refusal);
        if (refused !== undefined) return { kind: "not-linked", refusal: refused } as const;
        const held = yield* SubscriptionRef.get(state);
        return Option.isSome(held)
          ? ({ kind: "linked", mate: held.value } as const)
          : ({ kind: "not-linked" } as const);
      }),
    });
  });

/** How long a link must stay up before the next reconnect starts from the shortest wait. */
const LINK_STABLE_MS = 30_000;
/**
 * How long a task told before HQ's first state on a link waits for it; HQ tells a task again
 * when the Mate has not answered it.
 */
export const HQ_TASK_HOLD = Duration.seconds(30);
/** A missing correlated answer withholds permission; the deadline never substitutes a policy. */
export const HQ_AUTO_UPDATE_VERIFY_BUDGET = Duration.seconds(5);

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
                runsWithoutSignIn: mateRunsWithoutSignIn(
                  yield* sources.providers.latest,
                  snapshot.agents,
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
 * The link inside a Zerops container; elsewhere, none: the Mate is never linked. The overview is of the project at the workspace root (the threads the
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
      const providers = yield* ProviderInstances;
      // Separate home database: capture IO cannot lock the orchestration event store.
      // Admission waits for a subscribed capture service, including across storage recovery.
      const usage = yield* makeUsageCapture(paths.join(config.stateDir, "usage.sqlite"));
      const zerops = config.zerops;
      if (zerops === undefined) {
        return ZeropsHqLink.of({ standing: Effect.succeed({ kind: "not-linked" }) });
      }
      const key = yield* ZeropsMateKey;
      const connections = yield* ZeropsConnections;
      const tickets = yield* ZeropsTicketDoor;
      const credential = yield* ZeropsGitCredentialFile;
      const observeCredential = yield* ZeropsObserveCredentialFile;
      // The engine's conversations are the chats: V1's projections (a thread left running at the
      // flip among them) are never read.
      const attention = yield* ZeropsMateAttention;
      const engine = yield* MateEngine;
      const chats = chatsSource(
        engine,
        // The revision an engine row carries: the attention's source, as the engine wire's.
        Effect.map(attention.current, ({ source }) => source),
      );
      const descriptor = yield* (yield* ServerEnvironment).getDescriptor;
      const feed = yield* mateOverviewFeed({
        providers: { latest: providers.providers, changes: providers.changes },
        environmentId: descriptor.environmentId,
        serverVersion: descriptor.serverVersion,
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
        hqOrigin: zerops.hqOrigin,
        serviceId: zerops.serviceId ?? zerops.hostname ?? "",
        publicOrigin: zerops.publicOrigin,
        // Read past the cache on every dial: a key zcp rewrote is the one the next link presents.
        readKey: Effect.andThen(key.invalidate, key.read),
        ...(key.refusal === undefined ? {} : { keyRefusal: key.refusal }),
        connect: connectLinkSocket,
        access: connections.heard,
        ticket: tickets.heard,
        closeSession: connections.closeSession,
        gitCredential: credential.write,
        observeCredential: observeCredential.write,
        gitFingerprint: credential.fingerprint,
        // A moved Chief mark rotates every session on this engine, so each runs a fresh zcp.
        chief: (yield* makeChiefRestart({
          conversations: Effect.map(engine.conversations, (list) => [
            ...list.views.map((view) => view.conversationId),
            ...list.unread,
          ]),
          deliver: engine.deliver,
        })).heard,
        automation: yield* ZeropsAutomation,
        tasks: yield* ZeropsTasks,
        autoUpdatePolicy: yield* MateAutoUpdatePolicy,
        attention: attention.changes,
        health: attention.healthChanges,
        usage,
        ...feed,
      });
    }),
  );
