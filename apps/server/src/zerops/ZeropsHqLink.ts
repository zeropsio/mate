import {
  type ConnectionSubject,
  type TicketAnswer,
  ZeropsConnections,
} from "./ZeropsConnections.ts";
import type { AdmissionLive, TicketFrame } from "./ZeropsTicketDoor.ts";
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
 *   each new revision; `pong` to each of HQ's pings. The Mate's own access list stays in
 *   the Mate.
 * - **Down:** the Mate's state as HQ holds it, kept here for whoever asks and handed on to
 *   `ZeropsAutomation` (whether the Mate is automated) and to `ZeropsChiefRestart`, which rotates
 *   every session on a moved Chief mark (`chief`), and to `ZeropsMateOwner`, whom it names the
 *   Mate's owner (`ownerUserId`), and to `ZeropsChiefOpener`, whom it lets open a Chief
 *   (`chiefOpenerUserId`); the raw `mate` of every state, decoded or not, is kept by
 *   `ZeropsMateStateFile` where zcp reads it; tickets (`ticket`), each answered `ticket-ack`, or
 *   `ticket_refused` when the access list does not admit its person, or not at all when the key
 *   it came under was refused, which closes the link and leaves HQ to answer it; the
 *   Mate's Git credential (`git-credential`), handed on to
 *   `ZeropsGitCredentialFile`, never logged; an automated Mate's keys (`provider-keys`), handed on
 *   to `ZeropsAutomation`, never logged; and the tasks HQ hands an automated Mate (`task`), the
 *   follow-ups people say on them (`task-message`) and their stops (`task-stop`), worked by
 *   `ZeropsTasks`, whose reports go up as `task-state` — the latest task's first on every link —
 *   and only on a link whose HQ said in its state that the Mate is automated. A task's frame told
 *   before HQ's first state on a link is held until it comes ({@link HQ_TASK_HOLD}). The
 *   operator's command (`command`) is run aside (`zeropsLinkCommand.ts`) and its `command-result`
 *   goes up the link stated when it ends, or nowhere. An older
 *   HQ's `access` frame is read past like any frame this build cannot decode: the Mate's own list
 *   is the only one (`ZeropsMateAccessList`).
 * - **Closed:** the Mate is not linked until HQ's first state on the next link. HQ names why
 *   (`MateLinkClosed`). A refused key (`4401`) or one HQ does not admit
 *   (`4403`, its code the reason) is the Mate's standing until HQ next sends its state, and so is
 *   an admission that could not resolve the key (`1011`, {@link KEY_UNRESOLVED}) unless a refusal
 *   stands; a link superseded by the Mate's own newer one (`4409`) is expected.
 * - **A dead key:** each state names the admission of the key its link presented. Zerops refusing
 *   that key outright (`401`) to a request started under the admission HQ last named, while the
 *   env still holds it, or HQ closing `4401 key_refused`, marks that admission dead first; then
 *   everyone's connections and tickets end (`ZeropsConnections`), and the Mate tells HQ
 *   `key-refused` on the link that named it and again on each state naming it, until a state names
 *   another admission. A refusal from before HQ's first state names no admission and is dropped.
 *
 * A link that closes or never opens is tried again after a growing wait; one superseded (`4409`)
 * after the shortest. A refused key (`4401`, `4403`) is HQ's answer to that key in that project's
 * state, so the Mate dials again only once its env store changed (`ZeropsMateKey.changedSince`) or
 * {@link REFUSAL_REASK} passed. HQ is reached over IPv6 only, and the link is kept until it closes.
 *
 * @module ZeropsHqLink
 */
import { mateRunsWithoutSignIn } from "@t3tools/shared/zeropsAgentAuth";
import type { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import { ProviderInstances } from "../spi/providerInstances.ts";
import * as NodeDns from "node:dns";
import * as NodeNet from "node:net";

import * as NodeWS from "@effect/platform-node/NodeWS";
import type {
  ConversationRow,
  CrewSnapshot,
  MateAttention,
  MateHealth,
  MateHqKey,
  OrchestrationThreadShell,
  ServerProvider,
} from "@t3tools/contracts";
import { type MateTaskReport, TrimmedNonEmptyString } from "@t3tools/contracts";
import {
  KeyLinkDown,
  KeyLinkUp,
  type KeyNotAdmitted,
  type LinkedMate,
  KEY_UNRESOLVED,
  LINK_COMMAND_PROTOCOL,
  type LinkCommandDown,
  type LinkCommandResultUp,
  MATE_OVERVIEW_EVERY_MS,
  MATE_REFUSAL_REASK_MS,
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
import * as FileSystem from "effect/FileSystem";
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

import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ZeropsAgentAuth } from "./ZeropsAgentAuth.ts";
import { combineAgentAuth, ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { ZeropsSignIns } from "./zeropsSignIns.ts";
import { ZeropsChiefOpener } from "./ZeropsChiefOpener.ts";
import { type MateOwner, ZeropsMateOwner } from "./ZeropsMateOwner.ts";
import { mateOverviewOf } from "./zeropsHqOverview.ts";
import { hasSetupMarker, readServiceVariableKeys } from "./zeropsSetupMarker.ts";
import { MateEngine } from "../engine/MateEngine.ts";
import { chatsSource } from "./engineOverview.ts";
import { ZeropsLogins } from "./ZeropsLogins.ts";
import { ZeropsMateAttention } from "./ZeropsMateAttention.ts";
import { ZeropsMateUpdate } from "./ZeropsMateUpdate.ts";
import { makeChiefRestart } from "./ZeropsChiefRestart.ts";
import {
  HeardMate,
  makeMateStateFile,
  type MateLinkEnd,
  type MateStateFile,
} from "./ZeropsMateStateFile.ts";
import { ZeropsGitCredentialFile } from "./ZeropsGitCredentialFile.ts";
import { ZeropsObserveCredentialFile } from "./ZeropsObserveCredentialFile.ts";
import { ZeropsMateKey, type ZeropsMateKeyReader } from "./ZeropsMateKey.ts";
import type { ZeropsKeyRefusal } from "./ZeropsKeyRefusal.ts";
import { ZeropsAutomation } from "./ZeropsAutomation.ts";
import { ZeropsTasks } from "./ZeropsTasks.ts";
import { makeLinkCommands } from "./zeropsLinkCommand.ts";
import { ZEROPS_SUBJECT_PREFIX, zeropsUserIdOf } from "@t3tools/contracts";
import { MateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";
import type { UsageLink } from "../usage/UsageLink.ts";
import { makeUsageCapture } from "../usage/UsageCapture.ts";
import { MateUpdateBootFence } from "../mateUpdateBoot.ts";

/** The part of a WebSocket the link uses; the global `WebSocket` is one. */
export interface LinkSocket {
  send(data: string): void;
  close(): void;
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

/**
 * Where the Mate stands with its HQ. `unresolved`: the latest link HQ closed because its admission
 * could not resolve the key ({@link KEY_UNRESOLVED}); never beside a refusal, which it does not
 * displace.
 */
export type HqStanding =
  /**
   * No link has heard HQ's state: none is up yet or the last one ended; or HQ refused the key, why
   * as HQ's close reason; or the Mate does not dial because it does not know its public origin
   * (`withheld`).
   */
  | {
      readonly kind: "not-linked";
      readonly refusal?: string;
      readonly withheld?: "no_public_origin";
      readonly unresolved?: true;
    }
  /** The Mate as HQ last sent it on the link that is up. */
  | { readonly kind: "linked"; readonly mate: LinkedMate };

/** HQ's word on the key at the latest admission that closed a link, until HQ next sends its state. */
type KeyVerdict = { readonly refusal: string } | { readonly unresolved: true };

/** The close code HQ supersedes a link with: the Mate's own newer link took over. */
const SUPERSEDED = 4409;
/** `1001` and `1012`: HQ is going away or restarting (a rolling deploy); the Mate relinks to its other container. */
const PLANNED_HANDOVER: ReadonlyArray<number> = [1001, 1012];
/** `1006`: the socket went away without a close frame (a dropped network); the code is the Mate's own, never HQ's. */
const ABNORMAL = 1006;

const decodeClosed = Schema.decodeUnknownOption(MateLinkClosed);

/**
 * HQ's word on the key a link closed with: refused (`4401`, `4403`), its reason; not resolved
 * (`1011` {@link KEY_UNRESOLVED}); none for any other close.
 */
const verdictOf = (close: LinkClose | undefined): KeyVerdict | undefined => {
  const closed = decodeClosed(close);
  if (Option.isNone(closed) || !("reason" in closed.value)) return undefined;
  return closed.value.reason === KEY_UNRESOLVED
    ? { unresolved: true }
    : { refusal: closed.value.reason };
};

/** HQ's `4401 key_refused`: the key the link presented is dead (no other close says so). */
const keyRefused = (close: LinkClose | undefined): boolean => {
  const closed = decodeClosed(close);
  return Option.isSome(closed) && closed.value.code === 4401;
};

/** Why the Mate is not linked after one attempt: why none was dialled, or HQ's word on the key. */
const linkEndOf = (ended: MateLinkEnd | undefined, heard: KeyVerdict | undefined): MateLinkEnd => {
  if (ended !== undefined) return ended;
  if (heard === undefined) return "closed";
  return "refusal" in heard ? "key_refused" : "key_unresolved";
};

/** HQ's refusals of the Mate's key for a safety rule: while one stands, nobody acts in the Mate. */
export type KeyUnsafe = Extract<KeyNotAdmitted, "key_too_wide" | "key_not_sensitive">;
const KEY_UNSAFE: ReadonlyArray<string> = [
  "key_too_wide",
  "key_not_sensitive",
] satisfies ReadonlyArray<KeyUnsafe>;
const keyUnsafe = (reason: string | undefined): reason is KeyUnsafe =>
  reason !== undefined && KEY_UNSAFE.includes(reason);

/**
 * What the session's person may do in this Mate: act, only read along, or nothing while HQ refuses
 * its key for a safety rule (why, as HQ named it).
 */
export type MateActing = "acts" | "reads-along" | KeyUnsafe;

/**
 * What the session's `subject` may do in this Mate (`MateActing`). A Zerops person other than the
 * owner HQ last named (`ZeropsMateOwner`, kept across link loss and refusal) reads along; any
 * Zerops person does nothing while HQ refuses the key for a safety rule. Any other refusal, a dead
 * key among them, changes nobody's standing: Zerops refuses each of the key's calls by itself.
 * Everyone acts while HQ has named no owner since the server started, as the client opens its
 * composer then.
 */
export const actingIn = (owner: MateOwner, standing: HqStanding, subject: string): MateActing => {
  if (!subject.startsWith(ZEROPS_SUBJECT_PREFIX)) return "acts";
  if (standing.kind === "not-linked" && keyUnsafe(standing.refusal)) return standing.refusal;
  return typeof owner === "string" && zeropsUserIdOf(subject) !== owner ? "reads-along" : "acts";
};

/** What the people in the Mate are told of HQ's word on its key (`ServerConfig.hqKey`); none while none stands. */
export const hqKeyOf = (standing: HqStanding): MateHqKey | null => {
  if (standing.kind === "linked") return null;
  if (standing.refusal !== undefined) return { state: "refused", reason: standing.refusal };
  return standing.unresolved === true ? { state: "unresolved" } : null;
};

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
  /** When the store the key is read from changes (`ZeropsMateKey`); none: only {@link REFUSAL_REASK}. */
  readonly keyStore?: Pick<ZeropsMateKeyReader, "revision" | "changedSince">;
  readonly connect: ConnectLinkSocket;
  /** The Mate's overview as it stands now; none when it cannot be read, tried again at the next change. */
  readonly overview: Effect.Effect<Option.Option<MateOverview>>;
  /** Fires whenever the overview may have changed. */
  readonly changes: Stream.Stream<unknown>;
  /** The Mate's attention now, then each new revision (`ZeropsMateAttention.changes`). */
  readonly attention: Stream.Stream<MateAttention>;
  /**
   * Takes HQ's ticket, with whether the admission it came under is still live, and gives what
   * admits it or says why not, answered `ticket-ack` or `ticket_refused`, or not at all
   * (`ZeropsConnections.ticket`).
   */
  readonly ticket?: (
    frame: TicketFrame,
    live: AdmissionLive,
  ) => Effect.Effect<Effect.Effect<TicketAnswer>>;
  /** Ends a session HQ closed, or everyone's once the key is dead (`ZeropsConnections.end`). */
  readonly end?: (subject: ConnectionSubject) => Effect.Effect<void>;
  /**
   * Every HQ session the Mate holds now, each once, read for every hello: HQ closes each of them
   * it no longer holds live (`ZeropsConnections.heldSessions`).
   */
  readonly heldSessions: Effect.Effect<ReadonlyArray<string>>;
  /** Hands on whom each state lets open a Chief, if it names one (`ZeropsChiefOpener.named`). */
  readonly chiefOpener?: (userId: string | null | undefined) => Effect.Effect<void>;
  /** Hands on whom each state names the Mate's owner, `null` for none (`ZeropsMateOwner.named`). */
  readonly owner?: (userId: string | null) => Effect.Effect<void>;
  /** Hands on the Mate's Git credential, or HQ's revocation of it (`ZeropsGitCredentialFile`). */
  readonly gitCredential: (credential: string | null) => Effect.Effect<void>;
  /** Writes or removes the explicit personal Observe credential, returning its durable receipt. */
  readonly observeCredential?: (credential: string | null) => Effect.Effect<boolean>;
  /** Applies HQ's map of each login's last signer (`signers`) to whose a login is (`ZeropsSignIns.heard`). */
  readonly signers?: (signers: Readonly<Record<string, string>>) => Effect.Effect<void>;
  /** The fingerprint of the Git credential held now, read afresh for every dial; HQ keeps a live one it names. */
  readonly gitFingerprint: Effect.Effect<Option.Option<string>>;
  /** The fingerprint of the Observe credential held now, read afresh for every dial; HQ mints none while it names a live one. */
  readonly observeFingerprint?: Effect.Effect<Option.Option<string>>;
  /** Keeps every state HQ sends, and how the link stands, where zcp reads them; none: no file. */
  readonly mateState?: Pick<MateStateFile, "linked" | "notLinked">;
  /** Hands on the project HQ's Chief mark names, or none, with every state HQ sends. */
  readonly chief?: (projectId: string | null) => Effect.Effect<void>;
  /** Hands on HQ's word on the Mate and the organization's keys (`ZeropsAutomation`). */
  readonly automation?: Pick<ZeropsAutomation["Service"], "heard" | "keysHeard">;
  /** Works the tasks HQ hands an automated Mate, and says how each stands (`ZeropsTasks`). */
  readonly tasks?: ZeropsTasks["Service"];
  /**
   * Runs the operator's command HQ sent and says how it went (`zeropsLinkCommand.ts`); none: the
   * frame is passed by.
   */
  readonly command?: (frame: LinkCommandDown) => Effect.Effect<LinkCommandResultUp>;
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
    /** Fires whenever `standing` may have moved: each state HQ sends, each link's end, each word it closes on the key. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/zerops/ZeropsHqLink") {}

const DEFAULT_RECONNECT_DELAYS_MS: ReadonlyArray<number> = [1_000, 2_000, 5_000, 10_000, 30_000];

// An IPv4-mapped IPv6 address still opens an IPv4 connection.
const mappedIpv4 = new NodeNet.BlockList();
mappedIpv4.addSubnet("::ffff:0:0", 96, "ipv6");
const nativeIpv6 = (address: string) =>
  NodeNet.isIP(address) === 6 && !mappedIpv4.check(address, "ipv6");

/** HQ's shared IPv4 cuts a WebSocket at 120 s; its IPv6 holds (verified.md, 2026-10-03). */
export const lookupIpv6 =
  (lookup: NodeNet.LookupFunction): NodeNet.LookupFunction =>
  (hostname, options, callback) =>
    lookup(hostname, { ...options, family: 6 }, (error, address, version) => {
      if (error) return callback(error, address, version);
      const usable = Array.isArray(address)
        ? address.filter((item) => nativeIpv6(item.address))
        : nativeIpv6(address)
          ? address
          : "";
      if (usable.length === 0) {
        const failure = Object.assign(new Error("HQ has no usable IPv6 address"), {
          code: "ENOTFOUND",
        });
        return callback(failure, usable);
      }
      return callback(null, usable, 6);
    });

/** The link's socket (`ws`) uses only IPv6, including for an address supplied directly. */
export const connectLinkSocket: ConnectLinkSocket = (url) => {
  const host = new URL(url).hostname;
  const address = host.startsWith("[") ? host.slice(1, -1) : host;
  if (NodeNet.isIP(address) !== 0 && !nativeIpv6(address)) {
    throw new Error("HQ link requires an IPv6 address");
  }
  // ws passes these options to Node's socket, although its types omit auto-selection.
  const socketOptions = {
    lookup: lookupIpv6(NodeDns.lookup),
    autoSelectFamily: false,
  };
  return new NodeWS.WebSocket(url, socketOptions) as unknown as LinkSocket;
};

const decodeDown = Schema.decodeUnknownResult(Schema.fromJsonString(KeyLinkDown));
const encodeUp = Schema.encodeSync(Schema.fromJsonString(KeyLinkUp));
/** The `mate` a `state` frame carries, read past what of it this build cannot decode. */
const decodeHeardState = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ type: Schema.Literal("state"), mate: HeardMate })),
);
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
      readonly at: number;
    }
  | { readonly _tag: "close"; readonly close: LinkClose | undefined };

type HandshakeSignals = {
  readonly opened: Deferred.Deferred<void>;
  readonly firstState: Deferred.Deferred<void>;
};

/** How one link closed, once it does. */
type Link = Effect.Effect<LinkClose | undefined>;

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
    // Whether a link is up, and the Mate as it last said: some from a link's first decoded state
    // to that link's end.
    const state = yield* SubscriptionRef.make<Option.Option<LinkedMate>>(Option.none());
    const keyVerdict = yield* SubscriptionRef.make<KeyVerdict | undefined>(undefined);
    // The admission HQ last named in a state, and the key the link presented for it: kept across
    // this process's links. Its key once refused, it is `fenced` until a state names another.
    let admitted: { readonly admission: string; readonly key: string } | undefined;
    let fenced: string | undefined;
    // The link that heard the latest state, until it ends: where `key-refused` goes.
    let reportTo: ((message: KeyLinkUp) => Effect.Effect<void>) | undefined;
    /** A ticket's admission is live unless it is the fenced one; asked where it is used. */
    const liveness = (): AdmissionLive => {
      const admission = admitted?.admission;
      return () => fenced === undefined || fenced !== admission;
    };
    /** The admission's key is dead: marked first, then everyone's connections and tickets end. */
    const fenceAdmission = (admission: string | undefined) =>
      Effect.suspend(() => {
        if (admission !== undefined) fenced = admission;
        return options.end?.({ everyone: true }) ?? Effect.void;
      });
    if (options.keyRefusal !== undefined) {
      const keyRefusal = options.keyRefusal;
      yield* keyRefusal.installAdmission(() => admitted?.admission);
      yield* Effect.forkScoped(
        Stream.runForEach(keyRefusal.changes, (notice) =>
          Effect.gen(function* () {
            const current = admitted;
            // Only a refusal of the key HQ admitted, which the env still holds, by a request
            // started under that admission: one from before HQ's first state, of an older
            // admission or of a key rotated meanwhile accuses nobody.
            if (
              current === undefined ||
              fenced === current.admission ||
              notice.admission !== current.admission ||
              notice.refusedKey !== current.key ||
              notice.currentKey !== current.key
            )
              return;
            yield* fenceAdmission(current.admission);
            if (fenced === current.admission)
              yield* reportTo?.({ type: "key-refused" }) ?? Effect.void;
          }),
        ),
      );
    }
    const delays = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    const keyStore = options.keyStore ?? {
      revision: Effect.succeed(0),
      changedSince: () => Effect.never,
    };
    const overviewEvery = Duration.millis(options.overviewEveryMs ?? MATE_OVERVIEW_EVERY_MS);
    // A command outlives the link it came on: its result goes up the link stated when it ends.
    const commands = yield* Effect.scope;
    let stated: ((message: KeyLinkUp) => Effect.Effect<void>) | undefined;
    const url = `${options.hqOrigin.replace(/^http/u, "ws").replace(/\/+$/u, "")}/api/mate/link`;

    /**
     * One link, opened with the project's key in its first frame, then relayed in the scope's
     * lifetime until it closes: the overview up once HQ answered, pongs and HQ's frames down.
     * Fails with why when there is no key or public origin, or the socket never opened.
     */
    const openLink = Effect.fnUntraced(function* (handshake: HandshakeSignals) {
      const key = yield* options.readKey;
      if (options.publicOrigin === undefined) return Result.fail("no_public_origin" as const);
      if (key === undefined || key === "") return Result.fail("no_key" as const);
      const origin = options.publicOrigin;
      const events = yield* Queue.unbounded<SocketEvent>();
      const clock = yield* Clock.Clock;
      const pingInterval = yield* Deferred.make<number>();
      let lastInboundAt = clock.monotonicTimeNanosUnsafe();
      const socket = yield* Effect.acquireRelease(
        Effect.sync(() => options.connect(url)),
        (socket) =>
          Effect.sync(() => {
            try {
              socket.close();
            } catch {
              // Gone already.
            }
          }),
      );
      socket.addEventListener("open", () => {
        Deferred.doneUnsafe(handshake.opened, Effect.void);
        Queue.offerUnsafe(events, { _tag: "open" });
      });
      socket.addEventListener("message", (event) => {
        // Ingress is liveness even while a consumer waits, or this build cannot read the frame.
        lastInboundAt = clock.monotonicTimeNanosUnsafe();
        const raw = String(event.data);
        const frame = decodeDown(raw);
        if (Result.isSuccess(frame) && frame.success.type === "state") {
          Deferred.doneUnsafe(handshake.firstState, Effect.void);
          if (frame.success.pingIntervalMs !== undefined) {
            // The first announcement owns this generation's cadence; older HQs never arm it.
            Deferred.doneUnsafe(pingInterval, Effect.succeed(frame.success.pingIntervalMs));
          }
        }
        Queue.offerUnsafe(events, {
          _tag: "message",
          raw,
          frame,
          at: clock.currentTimeMillisUnsafe(),
        });
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
      const silence = Effect.gen(function* () {
        const period = yield* Deferred.await(pingInterval);
        for (;;) {
          const elapsed = Number(clock.monotonicTimeNanosUnsafe() - lastInboundAt) / 1_000_000;
          const remaining = 3 * period - elapsed;
          if (remaining <= 0) {
            return undefined;
          }
          yield* Effect.sleep(Duration.millis(remaining));
        }
      });
      const first = yield* Queue.take(events);
      if (first._tag !== "open") {
        return Result.fail("closed" as const);
      }
      const gitFingerprint = yield* options.gitFingerprint;
      const observeFingerprint = yield* (
        options.observeFingerprint ?? Effect.succeed(Option.none<string>())
      );
      // Read once the last link's ticket work has ended with its scope, and before HQ sends this
      // one a ticket, which it does only after the hello.
      const heldSessionIds = yield* options.heldSessions;
      yield* send({
        type: "hello",
        key,
        serviceId: options.serviceId,
        origin,
        ...(Option.isSome(gitFingerprint) ? { gitFingerprint: gitFingerprint.value } : {}),
        ...(Option.isSome(observeFingerprint)
          ? { observeFingerprint: observeFingerprint.value }
          : {}),
        heldSessionIds,
      });
      // The Mate ends this link itself: its key changed, or HQ sent a ticket under a dead key.
      const ending = yield* Deferred.make<LinkClose>();
      // GAP-RIGHTS-7: nothing pushes a key's deletion or edit; the Mate learns of it at its next own
      // call; see docs/architecture/identity-and-access.md#gap-rights (mate-hq).
      // A refusal is where the env is read again: one that moved on dials with its new key.
      const keyRefusals = options.keyRefusal
        ? Stream.runForEach(options.keyRefusal.changes, () =>
            Effect.gen(function* () {
              if ((yield* options.readKey) !== key)
                yield* Deferred.succeed(ending, { keyChanged: true });
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
      // A wake per change, the ones heard while the overview is read or held back folded into one;
      // the first is the whole overview every link opens with.
      const woken = yield* Queue.dropping<void>(1);
      yield* Queue.offer(woken, undefined);
      // What this link sent of each section, as JSON: a new link starts with nothing sent.
      const sent = new Map<string, string>();
      const overviews = Effect.forever(
        Effect.gen(function* () {
          yield* Queue.take(woken);
          const overview = yield* options.overview;
          // Unread, it is read again at the next change.
          if (Option.isNone(overview)) return;
          if (sent.size === 0) {
            changedSections(overview.value, sent);
            yield* send({ type: "overview", full: true, overview: overview.value });
          } else {
            const sections = changedSections(overview.value, sent);
            if (sections !== undefined) {
              yield* send({ type: "overview", full: false, sections });
            }
          }
          // At most one frame per window: a change inside it waits for its end.
          yield* Effect.sleep(overviewEvery);
        }),
      );
      const heard = Stream.runForEach(options.changes, () => Queue.offer(woken, undefined));
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
            // A state naming the dead admission has not heard the refusal: it is told again. One
            // naming another is a new admission, even of the same key, and lifts the fence.
            return Effect.sync(() => {
              admitted = { admission: frame.admission, key };
              reportTo = send;
              if (fenced !== frame.admission) fenced = undefined;
              return fenced !== undefined;
            }).pipe(
              Effect.flatMap((dead) => (dead ? send({ type: "key-refused" }) : Effect.void)),
              Effect.andThen(options.chiefOpener?.(frame.mate.chiefOpenerUserId) ?? Effect.void),
              Effect.andThen(SubscriptionRef.set(state, Option.some(frame.mate))),
              Effect.andThen(options.owner?.(frame.mate.ownerUserId ?? null) ?? Effect.void),
              Effect.andThen(SubscriptionRef.set(keyVerdict, undefined)),
              Effect.andThen(Ref.set(automatedHere, frame.mate.automated === true)),
              Effect.andThen(options.automation?.heard(frame.mate) ?? Effect.void),
              Effect.andThen(options.chief?.(frame.mate.chief?.projectId ?? null) ?? Effect.void),
              Effect.andThen(
                autoUpdatePolicy?.receive(Option.fromUndefinedOr(frame.autoUpdate)) ?? Effect.void,
              ),
              Effect.andThen(Deferred.succeed(answered, undefined)),
              Effect.andThen(usage?.state(frame) ?? Effect.void),
            );
          case "git-credential":
            return options.gitCredential(frame.credential);
          case "observe-credential":
            return (options.observeCredential?.(frame.credential) ?? Effect.succeed(false)).pipe(
              Effect.flatMap((ok) => send({ type: "observe-credential-ack", id: frame.id, ok })),
            );
          case "signers":
            return options.signers?.(frame.signers) ?? Effect.void;
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
            // Taken here, in the order heard; answered aside, since a verdict may wait on a
            // Zerops read that must not hold back pings, close-session or the frames after it.
            // One under a dead key is not answered: the link ends, and HQ answers it not-connected.
            return options.ticket === undefined
              ? Effect.void
              : options.ticket(frame, liveness()).pipe(
                  Effect.flatMap((answer) =>
                    answer.pipe(
                      Effect.flatMap((verdict) =>
                        verdict === "fenced"
                          ? Deferred.succeed(ending, {})
                          : send(
                              verdict === "open"
                                ? { type: "ticket-ack", ticket: frame.ticket }
                                : { type: "ticket_refused", ticket: frame.ticket, reason: verdict },
                            ),
                      ),
                      Effect.forkChild,
                    ),
                  ),
                  Effect.asVoid,
                );
          case "close-session":
            return options.end?.({ session: frame.sessionId }) ?? Effect.void;
          case "command":
            // Run aside, past this link's end, so pings and the frames after it are not held back.
            return options.command === undefined
              ? Effect.void
              : options.command(frame).pipe(
                  Effect.flatMap((result) => stated?.(result) ?? Effect.void),
                  Effect.forkIn(commands),
                  Effect.asVoid,
                );
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
          // The raw frame, ahead of the decode: a state a newer HQ sent still reaches zcp.
          const stated =
            Result.isFailure(frame) || frame.success.type === "state"
              ? decodeHeardState(event.raw)
              : Option.none();
          if (Option.isSome(stated) && options.mateState !== undefined) {
            yield* options.mateState.linked(stated.value.mate, event.at);
          }
          if (Result.isSuccess(frame)) yield* receive(frame.success);
          else if (Option.isSome(stated)) {
            yield* Effect.logWarning("zerops hq link: could not read a state HQ sent", {
              error: frame.failure.message,
            });
          } else yield* undecoded(event.raw, frame.failure);
        }
      });
      // This link carries the commands' results from HQ's first state until it ends.
      const carrying = onceAnswered(
        Effect.acquireUseRelease(
          Effect.sync(() => {
            stated = send;
          }),
          () => Effect.never,
          () =>
            Effect.sync(() => {
              if (stated === send) stated = undefined;
            }),
        ),
      );
      const relayed = yield* Effect.forkScoped(
        Effect.raceFirst(
          Effect.raceFirst(Effect.raceFirst(relay, silence), Deferred.await(ending)),
          Effect.all(
            [
              onceAnswered(overviews),
              heard,
              onceAnswered(attention),
              onceAnswered(health),
              ...(usage ? [onceAnswered(usage.run)] : []),
              reporting,
              keyRefusals,
              carrying,
            ],
            { concurrency: "unbounded" },
          ).pipe(Effect.as(undefined)),
        ).pipe(
          Effect.ensuring(autoUpdatePolicy?.close ?? Effect.void),
          Effect.ensuring(
            Effect.sync(() => {
              if (reportTo === send) reportTo = undefined;
            }),
          ),
        ),
      );
      return Result.succeed<Link>(Fiber.join(relayed));
    });

    /** Whether a link opened, and how it closed. */
    const runOnce = Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* Deferred.make<void>();
        const firstState = yield* Deferred.make<void>();
        const run = Effect.gen(function* () {
          const link = yield* openLink({ opened, firstState });
          if (Result.isFailure(link)) return { opened: false, ended: link.failure } as const;
          const close = yield* link.success;
          return { opened: true, close, stated: yield* Deferred.isDone(firstState) } as const;
        });
        const handshake = Deferred.await(opened).pipe(
          Effect.andThen(
            Deferred.await(firstState).pipe(Effect.timeoutOption(HQ_HANDSHAKE_BUDGET)),
          ),
          Effect.flatMap((received) =>
            Option.isSome(received)
              ? Effect.never
              : Effect.succeed({ opened: true, close: undefined, stated: false } as const),
          ),
        );
        return yield* Effect.raceFirst(run, handshake);
      }),
    );

    const fence = yield* MateUpdateBootFence;
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        // A boot under an uncommitted update says nothing to HQ: no hello, overview, usage or report.
        yield* fence.lifted;
        let attempt = 0;
        // The close HQ was last logged for while the Mate has not linked since, so a refused hello
        // retried forever writes one line, not one per retry.
        let warned: string | undefined;
        for (;;) {
          // A link that failed, whatever failed in it, is tried again after a growing wait: the loop
          // never ends.
          const began = yield* Clock.currentTimeMillis;
          // The store as it stood before this link read its key.
          const mark = yield* keyStore.revision;
          const ran = yield* runOnce.pipe(
            Effect.catchCause(() => Effect.succeed({ opened: false } as const)),
          );
          const close = "close" in ran ? ran.close : undefined;
          const heard = verdictOf(close);
          yield* SubscriptionRef.set(state, Option.none());
          if (keyRefused(close)) yield* fenceAdmission(admitted?.admission);
          const ended = "ended" in ran ? ran.ended : undefined;
          yield* options.mateState?.notLinked(linkEndOf(ended, heard)) ?? Effect.void;
          if (close?.keyChanged) {
            attempt = 0;
            continue;
          }
          const planned =
            close?.code === SUPERSEDED ||
            (close?.code !== undefined && PLANNED_HANDOVER.includes(close.code));
          if (ran.opened && ran.stated) warned = undefined;
          // HQ closed the link for something other than the key (a malformed hello, `1007`): the
          // standing cannot say why, so the container's log does.
          if (
            heard === undefined &&
            close?.code !== undefined &&
            close.code !== ABNORMAL &&
            !planned
          ) {
            const said = `${close.code} ${close.reason ?? ""}`;
            if (said !== warned) {
              warned = said;
              yield* Effect.logWarning("zerops hq link: HQ closed the link", {
                code: close.code,
                reason: close.reason ?? "",
              });
            }
          }
          // No answer on the key says nothing against a refusal that stands.
          if (heard !== undefined)
            yield* SubscriptionRef.update(keyVerdict, (held) =>
              "unresolved" in heard && held !== undefined && "refusal" in held ? held : heard,
            );
          if (heard !== undefined && "refusal" in heard) {
            // The same hello hears the same refusal: dial again once the owner may have fixed it in
            // the store (the key, or a variable it is judged by), else after a slow re-ask for what
            // the container cannot see (HQ holding the project again, the token edited in Zerops).
            const spread = yield* Random.nextIntBetween(
              0,
              Duration.toMillis(REFUSAL_REASK) / 4 + 1,
            );
            yield* Effect.raceFirst(
              keyStore.changedSince(mark),
              Effect.sleep(Duration.sum(REFUSAL_REASK, Duration.millis(spread))),
            );
            attempt = 0;
            continue;
          }
          // Only an admitted link that stayed up, or one the Mate's own newer link superseded, resets
          // the wait. A handover of any other link climbs like a failure: an HQ that keeps closing
          // links must not be redialled by every Mate at the shortest wait.
          const lived = (yield* Clock.currentTimeMillis) - began;
          attempt =
            close?.code === SUPERSEDED || (ran.opened && ran.stated && lived >= LINK_STABLE_MS)
              ? 0
              : attempt + 1;
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
        const word = yield* SubscriptionRef.get(keyVerdict);
        if (word !== undefined && "refusal" in word)
          return { kind: "not-linked", refusal: word.refusal } as const;
        const held = yield* SubscriptionRef.get(state);
        if (Option.isSome(held)) return { kind: "linked", mate: held.value } as const;
        return word === undefined
          ? ({ kind: "not-linked" } as const)
          : ({ kind: "not-linked", unresolved: true } as const);
      }),
      changes: Stream.merge(
        Stream.map(SubscriptionRef.changes(state), () => undefined),
        Stream.map(SubscriptionRef.changes(keyVerdict), () => undefined),
      ),
    });
  });

/** Time after the socket opens for HQ to admit the key and send its first state. */
const HQ_HANDSHAKE_BUDGET = Duration.seconds(30);
/** How long a refused key waits, with no change of its store, before the Mate asks HQ again. */
export const REFUSAL_REASK = Duration.millis(MATE_REFUSAL_REASK_MS);
/** How long an admitted link must stay up before the next reconnect starts from the shortest wait. */
const LINK_STABLE_MS = 30_000;
/**
 * How long a task told before HQ's first state on a link waits for it; HQ tells a task again
 * when the Mate has not answered it.
 */
export const HQ_TASK_HOLD = Duration.seconds(30);
/** How long the fresh policy question waits; past it the holder decides on the last policy heard. */
const HQ_AUTO_UPDATE_VERIFY_BUDGET = Duration.seconds(5);

/** Where a Mate's overview is read from: the services the link's layer finds, by what it reads. */
export interface OverviewSources {
  readonly lastSigners?: Effect.Effect<Readonly<Record<string, string>>>;
  readonly signedAt?: Effect.Effect<Readonly<Record<string, string>>>;
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
  /** Whether its service holds the press's setup marker, read locally at each look; none off Zerops. */
  readonly setupMarker?: Effect.Effect<boolean>;
  /** That it runs HQ's `command` frame (`LINK_COMMAND_PROTOCOL`); none where it cannot. */
  readonly command?: { readonly protocol: number };
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
          ...(sources.setupMarker === undefined ? {} : { setupMarker: yield* sources.setupMarker }),
          ...(sources.command === undefined ? {} : { command: sources.command }),
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
        ...(sources.signedAt === undefined ? {} : { signedAt: yield* sources.signedAt }),
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
      const fs = yield* FileSystem.FileSystem;
      const providers = yield* ProviderInstances;
      // Separate home database: capture IO cannot lock the orchestration event store.
      // Admission waits for a subscribed capture service, including across storage recovery.
      const usage = yield* makeUsageCapture(paths.join(config.stateDir, "usage.sqlite"));
      const zerops = config.zerops;
      if (zerops === undefined) {
        return ZeropsHqLink.of({
          standing: Effect.succeed({ kind: "not-linked" }),
          changes: Stream.empty,
        });
      }
      const key = yield* ZeropsMateKey;
      const connections = yield* ZeropsConnections;
      const credential = yield* ZeropsGitCredentialFile;
      const observeCredential = yield* ZeropsObserveCredentialFile;
      const signIns = yield* ZeropsSignIns;
      const owner = yield* ZeropsMateOwner;
      const chiefOpener = yield* ZeropsChiefOpener;
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
        lastSigners: signIns.lastSigners,
        signedAt: signIns.signedAt,
        logins: yield* ZeropsLogins,
        update: yield* ZeropsMateUpdate,
        domainEvents: chats.domainEvents,
        ...(chats.conversations === undefined ? {} : { conversations: chats.conversations }),
        ...(chats.engine === undefined ? {} : { engine: chats.engine }),
        setupMarker: readServiceVariableKeys(zerops.envStorePath).pipe(
          Effect.map(hasSetupMarker),
          Effect.provideService(FileSystem.FileSystem, fs),
        ),
        // Here `runExecCommand` runs: the link exists only in a Zerops environment.
        command: { protocol: LINK_COMMAND_PROTOCOL },
      });
      const mateState =
        zerops.mateStateFile === undefined
          ? undefined
          : yield* makeMateStateFile(zerops.mateStateFile, zerops.projectId);
      return yield* makeZeropsHqLink({
        hqOrigin: zerops.hqOrigin,
        serviceId: zerops.serviceId ?? zerops.hostname ?? "",
        publicOrigin: zerops.publicOrigin,
        // Read past the cache on every dial: a key zcp rewrote is the one the next link presents.
        readKey: Effect.andThen(key.invalidate, key.read),
        ...(key.refusal === undefined ? {} : { keyRefusal: key.refusal }),
        keyStore: key,
        connect: connectLinkSocket,
        ticket: connections.ticket,
        end: connections.end,
        heldSessions: connections.heldSessions,
        // HQ's state is where the Mate learns who may open its Chief: the one source behind the
        // access list's Chief filter, which the tickets and connections follow.
        chiefOpener: chiefOpener.named,
        // HQ's state is where the Mate learns whose it is: the one source behind `ZeropsMateOwner`.
        owner: owner.named,
        gitCredential: credential.write,
        observeCredential: observeCredential.write,
        signers: signIns.heard,
        ...(mateState === undefined ? {} : { mateState }),
        gitFingerprint: credential.fingerprint,
        observeFingerprint: observeCredential.fingerprint,
        // A moved Chief mark rotates every session on this engine, so each runs a fresh zcp.
        chief: (yield* makeChiefRestart({
          conversations: Effect.map(engine.conversations, (list) => [
            ...list.views.map((view) => view.conversationId),
            ...list.unread,
          ]),
          deliver: engine.deliver,
          keptChief: mateState?.keptChief ?? Option.none(),
        })).heard,
        automation: yield* ZeropsAutomation,
        tasks: yield* ZeropsTasks,
        command: yield* makeLinkCommands,
        autoUpdatePolicy: yield* MateAutoUpdatePolicy,
        attention: attention.changes,
        health: attention.healthChanges,
        usage,
        ...feed,
      });
    }),
  );
