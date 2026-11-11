import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ConversationRow,
  MateHealth,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type CrewSnapshot,
  type ExecutionEnvironmentUpdate,
  type MateAttention,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import {
  KeyLinkUp,
  type LinkedMate,
  MATE_OVERVIEW_EVERY_MS,
  type MateOverview,
} from "@t3tools/shared/mateLink";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import * as Access from "./ZeropsMateAccessList.ts";
import * as Tickets from "./ZeropsTicketDoor.ts";
import * as Connections from "./ZeropsConnections.ts";
import { makeAccessScene, sceneRead } from "./testing/accessScene.ts";
import * as ChiefOpener from "./ZeropsChiefOpener.ts";
import { makeMateStateFile } from "./ZeropsMateStateFile.ts";
import { CREW_OFF_SNAPSHOT } from "./crew/crewSnapshot.ts";
import { makeMateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";
import { memorySignInStore } from "./zeropsSignIns.ts";
import {
  type LinkSocket,
  connectLinkSocket,
  makeZeropsHqLink,
  REFUSAL_REASK,
  mateOverviewFeed,
  lookupIpv6,
  actingIn,
  type HqStanding,
  type OverviewSources,
  type ZeropsHqLinkOptions,
} from "./ZeropsHqLink.ts";

/** Past the re-ask of a refused key and the most its spread adds. */
const REASKED = Duration.millis(Duration.toMillis(REFUSAL_REASK) * 1.25 + 1);

const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeHeard = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeMateLinkUp = Schema.decodeUnknownEffect(KeyLinkUp);
const decodeRow = Schema.decodeUnknownSync(ConversationRow);
const decodeMateHealth = Schema.decodeUnknownEffect(MateHealth);

type Sent = { readonly type: string } & Readonly<Record<string, unknown>>;

class FakeSocket implements LinkSocket {
  readonly url: string;
  readonly sent: Array<Sent> = [];
  readonly listeners = new Map<
    string,
    Array<
      (event: { readonly data: unknown; readonly code: number; readonly reason: unknown }) => void
    >
  >();
  closed = false;
  onSent: (message: Sent) => void = () => {};
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(
    type: string,
    listener: (event: {
      readonly data: unknown;
      readonly code: number;
      readonly reason: unknown;
    }) => void,
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    const message = decodeJson(data) as Sent;
    this.sent.push(message);
    this.onSent(message);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown = undefined) {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data, code: 1006, reason: "" });
  }
  /** HQ closes the link with `code` and `reason`. */
  closeWith(code: number, reason = "") {
    for (const listener of this.listeners.get("close") ?? [])
      listener({ data: undefined, code, reason });
  }
  hear(message: unknown) {
    this.emit("message", encodeHeard(message));
  }
}

/** A Mate with one chat, titled `title`, at work. */
const overview = (title: string): MateOverview => ({
  identity: {
    environmentId: "env-1" as MateOverview["identity"]["environmentId"],
    serverVersion: "0.11.90",
    update: null,
  },
  main: null,
  threads: {
    list: [
      {
        id: "t1" as MateOverview["threads"]["list"][number]["id"],
        title,
        kind: "working",
        turnId: null,
        turnState: null,
        completedAt: null,
      },
    ],
    omitted: 0,
  },
  logins: {},
  crew: { status: "off" },
});

/** A Mate's attention at `revision`: one chat at work. */
const attentionAt = (revision: number): MateAttention => ({
  source: {
    environmentId: "env-1" as MateAttention["source"]["environmentId"],
    epoch: 1,
    incarnation: "boot-1",
    revision,
  },
  mainThreadId: "t1" as MateAttention["mainThreadId"],
  lastThreadId: "t1" as MateAttention["lastThreadId"],
  working: 1,
  waiting: 0,
  results: [],
  questions: [],
  truncated: false,
});

/** A Mate in no application, with no changes yet, its organisation's Chief mark on none. */
const STATE: LinkedMate = {
  projectId: "P_MATE",
  name: "Ada",
  face: "face-1",
  standupRequestedBy: "owner",
  appId: null,
  appName: null,
  changes: [],
  chief: null,
};

/** The admission of the project's key HQ names in each state. */
const ADMISSION = "6d0c2f4e-3b1a-4c8d-9e7f-5a2b1c0d9e8f";
/** A ticket taken under an admission whose key stands. */
const live = () => true;

/**
 * The hello a link opens with: the project's key, the service it is labelled by, the Mate's public
 * origin, and the sessions it holds, none here.
 */
const hello = (key: string) => ({
  type: "hello",
  key,
  serviceId: "svc-mate",
  origin: "https://mate-1234.prg1.zerops.app",
  heldSessionIds: [],
});

/** HQ admits the key: its first state on the link. */
const admit = (socket: FakeSocket, mate: LinkedMate = STATE) =>
  socket.hear({ type: "state", mate: { ...mate, repos: [] }, admission: ADMISSION });

/**
 * A link over a fake HQ, a socket per connect, the project's key `zk-1` unless a test takes it. It
 * sends at most every `everyMs` (10 ms unless said: the link's own pace is for the clock's tests).
 */
const rig = (
  options: {
    /** The container holds no key until the test gives it one. */
    readonly keyless?: boolean;
    readonly everyMs?: number;
    /** The attention the link sends up; nothing unless a test says. */
    readonly attention?: Stream.Stream<MateAttention>;
    readonly health?: Stream.Stream<MateHealth>;
    readonly overview?: Effect.Effect<Option.Option<MateOverview>>;
    readonly reconnectDelaysMs?: ReadonlyArray<number>;
    /** The Mate's public origin; its container's own unless a test takes it away. */
    readonly publicOrigin?: string | undefined;
    /** What a credential's write waits on before it lands, as a file write in flight does. */
    readonly credentialLands?: (credential: string | null) => Effect.Effect<void>;
    readonly observeCredential?: (credential: string | null) => Effect.Effect<boolean>;
    /** The Mate's own verdict on each ticket HQ sends; no tickets unless a test says. */
    readonly ticket?: ZeropsHqLinkOptions["ticket"];
    readonly end?: ZeropsHqLinkOptions["end"];
    readonly chiefOpener?: ZeropsHqLinkOptions["chiefOpener"];
    readonly mateState?: ZeropsHqLinkOptions["mateState"];
  } = {},
) =>
  Effect.gen(function* () {
    const key = yield* Ref.make<string | undefined>(options.keyless === true ? undefined : "zk-1");
    const current = yield* Ref.make(overview("Add a login page"));
    /** The fingerprint of the Git credential the Mate holds; none until a test gives it one. */
    const fingerprint = yield* Ref.make(Option.none<string>());
    /** How often the link read the overview. */
    const reads = { count: 0 };
    const changes = yield* PubSub.unbounded<void>();
    const sockets: Array<FakeSocket> = [];
    const connected = yield* Queue.unbounded<FakeSocket>();
    /** The access frames HQ sent, as the link handed them on. */
    /** The Git credentials HQ sent, as the link handed them on. */
    const credentials: Array<string | null> = [];
    /** The Chief mark's project of each state HQ sent, as the link handed it on. */
    const chiefs: Array<string | null> = [];
    /** What the link handed `ZeropsAutomation`: HQ's word on the Mate, and its keys. */
    const automation: Array<unknown> = [];
    /** The tasks the link handed on; each is answered `accepted`, and the latest is `task-0`. */
    const taken: Array<string> = [];
    /** The policy heard from HQ; none kept from an earlier run. */
    const autoUpdatePolicy = yield* makeMateAutoUpdatePolicy({
      heard: Option.none(),
      keep: () => Effect.void,
    });
    /** Whose each login is, as the link's `signers` frames leave it. */
    const signIns = yield* memorySignInStore();
    const link = yield* makeZeropsHqLink({
      autoUpdatePolicy,
      hqOrigin: "https://hq.test/",
      serviceId: "svc-mate",
      publicOrigin:
        "publicOrigin" in options ? options.publicOrigin : "https://mate-1234.prg1.zerops.app",
      readKey: Ref.get(key),
      connect: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        Queue.offerUnsafe(connected, socket);
        return socket;
      },
      overview:
        options.overview ??
        Effect.sync(() => {
          reads.count += 1;
        }).pipe(Effect.andThen(Ref.get(current)), Effect.map(Option.some)),
      changes: Stream.fromPubSub(changes),
      attention: options.attention ?? Stream.never,
      ...(options.health === undefined ? {} : { health: options.health }),
      ...(options.ticket === undefined ? {} : { ticket: options.ticket }),
      ...(options.end === undefined ? {} : { end: options.end }),
      ...(options.chiefOpener === undefined ? {} : { chiefOpener: options.chiefOpener }),
      ...(options.mateState === undefined ? {} : { mateState: options.mateState }),
      gitCredential: (credential) =>
        Effect.uninterruptible(
          (options.credentialLands?.(credential) ?? Effect.void).pipe(
            Effect.andThen(Effect.sync(() => void credentials.push(credential))),
          ),
        ),
      ...(options.observeCredential === undefined
        ? {}
        : { observeCredential: options.observeCredential }),
      signers: signIns.heard,
      gitFingerprint: Ref.get(fingerprint),
      heldSessions: Effect.succeed([]),
      chief: (projectId) => Effect.sync(() => void chiefs.push(projectId)),
      automation: {
        heard: (mate) => Effect.sync(() => void automation.push({ heard: mate })),
        keysHeard: (keys, model) =>
          Effect.sync(() => void automation.push(model === undefined ? { keys } : { keys, model })),
      },
      tasks: {
        open: (send) =>
          Effect.succeed({
            receive: (task) =>
              Effect.sync(() => void taken.push(task.id)).pipe(
                Effect.andThen(send({ taskId: task.id, state: "accepted" })),
              ),
            message: (taskId, message, change) =>
              Effect.sync(
                () =>
                  void taken.push(
                    `${taskId}:${message.id}${change === undefined ? "" : `@${change.branch}`}`,
                  ),
              ),
            stop: (taskId, reason) => Effect.sync(() => void taken.push(`${taskId}:${reason}`)),
            run: send({ taskId: "task-0", state: "done" }).pipe(Effect.andThen(Effect.never)),
          }),
      },
      reconnectDelaysMs: options.reconnectDelaysMs ?? [20],
      ...(options.everyMs === undefined ? {} : { overviewEveryMs: options.everyMs }),
    });
    /** Waits until `found` answers. */
    const until = <A>(found: () => A | undefined) =>
      Effect.suspend(() => {
        const value = found();
        return value === undefined ? Effect.fail("not yet") : Effect.succeed(value);
      }).pipe(Effect.retry(Schedule.spaced(Duration.millis(5))), Effect.orDie);
    return {
      autoUpdatePolicy,
      link,
      key,
      fingerprint,
      current,
      changes,
      sockets,
      connected,
      until,
      reads,
      credentials,
      chiefs,
      automation,
      taken,
      signIns,
    };
  });

/** Opens the newest socket the link made, on the test's clock. */
const opened = (sockets: ReadonlyArray<FakeSocket>, index: number) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(Duration.zero);
    const socket = sockets[index];
    if (socket === undefined) return yield* Effect.die(`no socket ${String(index)} yet`);
    socket.emit("open");
    yield* TestClock.adjust(Duration.zero);
    return socket;
  });

/** Opens the newest socket the link made and HQ admits it, on the test's clock. */
const linked = (sockets: ReadonlyArray<FakeSocket>, index: number) =>
  Effect.gen(function* () {
    const socket = yield* opened(sockets, index);
    admit(socket);
    yield* TestClock.adjust(Duration.zero);
    return socket;
  });

/** The Mate's state file in a temp directory, what it holds, and a queue told as each write lands. */
const stateFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "mate-state-file-" });
  const at = path.join(root, "state.json");
  const file = yield* makeMateStateFile(at, "P_MATE");
  const landed = yield* Queue.unbounded<void>();
  const told = (write: Effect.Effect<void>) =>
    write.pipe(Effect.andThen(Queue.offer(landed, undefined)), Effect.asVoid);
  return {
    read: Effect.map(fs.readFileString(at), decodeJson),
    landed,
    mateState: {
      linked: (mate, heardAtMs) => told(file.linked(mate, heardAtMs)),
      notLinked: (reason) => told(file.notLinked(reason)),
    } satisfies NonNullable<ZeropsHqLinkOptions["mateState"]>,
  };
});

describe("ZeropsHqLink", () => {
  it.effect(
    "HQ state applies the Chief opener again on reconnect and omission retains the last verdict",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const opener = yield* ChiefOpener.make;
          const list = yield* Access.make({
            projectId: "P_MATE",
            read: Effect.succeed(sceneRead({ jan: "OWNER", eva: "BASIC_USER" }, ["chief"])),
            opener,
          });
          const tickets = yield* Tickets.make;
          const connections = yield* Connections.make.pipe(
            Effect.provideService(Access.ZeropsMateAccessList, list),
            Effect.provideService(Tickets.ZeropsTicketDoor, tickets),
            Effect.provide(NodeCrypto.layer),
          );
          const { sockets } = yield* rig({ chiefOpener: opener.named });
          const first = yield* linked(sockets, 0);
          admit(first, { ...STATE, chiefOpenerUserId: "eva" });
          yield* TestClock.adjust(Duration.zero);
          assert.strictEqual(
            yield* Effect.flatten(
              connections.ticket(
                {
                  type: "ticket",
                  ticket: "t1",
                  userId: "jan",
                  sessionId: "s",
                  expiresIn: 60,
                },
                live,
              ),
            ),
            "not_in_list",
          );
          first.closeWith(1006);
          yield* TestClock.adjust(Duration.millis(30));
          const next = yield* linked(sockets, 1);
          assert.strictEqual(
            yield* Effect.flatten(
              connections.ticket(
                {
                  type: "ticket",
                  ticket: "t2",
                  userId: "jan",
                  sessionId: "s",
                  expiresIn: 60,
                },
                live,
              ),
            ),
            "not_in_list",
          );
          admit(next, { ...STATE, chiefOpenerUserId: "jan" });
          yield* TestClock.adjust(Duration.zero);
          assert.strictEqual(
            yield* Effect.flatten(
              connections.ticket(
                {
                  type: "ticket",
                  ticket: "t-new",
                  userId: "jan",
                  sessionId: "s",
                  expiresIn: 60,
                },
                live,
              ),
            ),
            "open",
          );
          admit(next, { ...STATE, chiefOpenerUserId: null });
          yield* TestClock.adjust(Duration.zero);
          assert.strictEqual(
            yield* Effect.flatten(
              connections.ticket(
                {
                  type: "ticket",
                  ticket: "t3",
                  userId: "eva",
                  sessionId: "s",
                  expiresIn: 60,
                },
                live,
              ),
            ),
            "not_in_list",
          );
        }),
      ),
  );
  it.effect(
    "A link whose HQ sends no state within the handshake budget closes and reconnects",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { sockets } = yield* rig({
            everyMs: 10_000_000,
            reconnectDelaysMs: [100, 1_000],
          });
          const first = yield* opened(sockets, 0);
          assert.deepStrictEqual(first.sent, [hello("zk-1")]);

          yield* TestClock.adjust(Duration.seconds(29));
          first.hear({ type: "ping" });
          yield* TestClock.adjust(Duration.millis(999));
          assert.deepStrictEqual(first.sent.at(-1), { type: "pong" });
          assert.isFalse(first.closed);
          assert.lengthOf(sockets, 1);

          yield* TestClock.adjust(Duration.millis(1));
          assert.isTrue(first.closed);
          yield* TestClock.adjust(Duration.millis(130));
          const next = yield* opened(sockets, 1);
          assert.deepStrictEqual(next.sent, [hello("zk-1")]);
          yield* TestClock.adjust(Duration.seconds(30));
          assert.isTrue(next.closed);
          yield* TestClock.adjust(Duration.millis(130));
          assert.lengthOf(sockets, 2);
          yield* TestClock.adjust(Duration.millis(1_120));
          const admitted = yield* opened(sockets, 2);
          assert.deepStrictEqual(admitted.sent, [hello("zk-1")]);
          admit(admitted);
          yield* TestClock.adjust(Duration.minutes(31));
          assert.isFalse(admitted.closed);
          assert.lengthOf(sockets, 3);
        }),
      ),
  );

  it.effect("keeps a healthy link until it closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig({ everyMs: 10_000_000 });
        const first = yield* linked(sockets, 0);
        yield* TestClock.adjust(Duration.minutes(5));
        assert.lengthOf(sockets, 1);
        assert.isFalse(first.closed);
        first.emit("close");
        yield* TestClock.adjust(Duration.millis(30));
        assert.isTrue(first.closed);
        const failed = sockets[1]!;
        failed.emit("error");
        yield* TestClock.adjust(Duration.millis(30));
        assert.isTrue(failed.closed);
        const next = yield* linked(sockets, 2);
        assert.deepStrictEqual(next.sent[0], hello("zk-1"));
      }),
    ),
  );

  it.effect(
    "Decision: A Mate reconnects when its current HQ link stops receiving traffic, even if the socket never reports closed.",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          // Both the normal cadence and a supported slow HQ: no client-side default.
          for (const pingIntervalMs of [20_000, 600_000]) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { sockets } = yield* rig({ everyMs: 10_000_000 });
                yield* TestClock.adjust(Duration.zero);
                const socket = yield* opened(sockets, 0);
                socket.hear({ type: "state", mate: STATE, admission: ADMISSION, pingIntervalMs });
                yield* TestClock.adjust(Duration.millis(3 * pingIntervalMs - 1));
                assert.isFalse(socket.closed);
                assert.lengthOf(sockets, 1);
                yield* TestClock.adjust(Duration.millis(1));
                assert.isTrue(socket.closed);
                yield* TestClock.adjust(Duration.millis(30));
                const next = yield* opened(sockets, 1);
                assert.deepStrictEqual(next.sent, [hello("zk-1")]);
              }),
            );
          }
        }),
      ),
  );

  it.effect("Decision: A superseded link's silence deadline cannot close the successor.", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig({ everyMs: 10_000_000 });
        const first = yield* opened(sockets, 0);
        first.hear({ type: "state", mate: STATE, admission: ADMISSION, pingIntervalMs: 20_000 });
        yield* TestClock.adjust(Duration.seconds(10));
        first.closeWith(4409);
        yield* TestClock.adjust(Duration.millis(30));
        const successor = yield* opened(sockets, 1);
        successor.hear({
          type: "state",
          mate: STATE,
          admission: ADMISSION,
          pingIntervalMs: 30_000,
        });
        yield* TestClock.adjust(Duration.zero);
        assert.isTrue(first.closed);
        // The old deadline passes while the successor has its own longer budget.
        yield* TestClock.adjust(Duration.millis(49_970));
        assert.isFalse(successor.closed);
        assert.lengthOf(sockets, 2);
        yield* TestClock.adjust(Duration.millis(40_029));
        assert.isFalse(successor.closed);
        yield* TestClock.adjust(Duration.millis(1));
        assert.isTrue(successor.closed);
        yield* TestClock.adjust(Duration.millis(30));
        const legacy = yield* opened(sockets, 2);
        admit(legacy);
        yield* TestClock.adjust(Duration.minutes(5));
        assert.isFalse(legacy.closed);
        assert.lengthOf(sockets, 3);
      }),
    ),
  );

  it.effect(
    "Decision: Link silence does not revoke the project key, erase remembered Mate identity or execute a task awaiting HQ state.",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { sockets, key, link, taken } = yield* rig();
          yield* TestClock.adjust(Duration.zero);
          const first = yield* opened(sockets, 0);
          first.hear({ type: "state", mate: STATE, admission: ADMISSION, pingIntervalMs: 1_000 });
          yield* TestClock.adjust(Duration.zero);
          yield* TestClock.adjust(Duration.seconds(3));
          assert.isTrue(first.closed);
          assert.strictEqual(yield* Ref.get(key), "zk-1");
          assert.deepStrictEqual(yield* link.standing, { kind: "not-linked" });
          yield* TestClock.adjust(Duration.millis(30));
          const next = yield* opened(sockets, 1);
          next.hear({
            type: "task",
            task: {
              id: "held-task",
              source: {
                kind: "github-issue",
                repo: "acme/tea-shop",
                number: 42,
                url: "https://github.com/acme/tea-shop/issues/42",
                title: "The cart forgets its teas",
                author: null,
              },
              body: "",
              limits: { minutes: 60, costUsd: null },
            },
          });
          yield* TestClock.adjust(Duration.seconds(31));
          assert.deepStrictEqual(taken, []);
          assert.isFalse(next.sent.some((frame) => frame.type === "task-state"));
          assert.deepStrictEqual(next.sent[0], hello("zk-1"));
        }),
      ),
  );

  it.effect(
    "inbound traffic near the silence deadline keeps the link alive while a handler waits",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const writing = yield* Deferred.make<void>();
          const written = yield* Deferred.make<void>();
          const { sockets } = yield* rig({
            credentialLands: () =>
              Deferred.succeed(writing, undefined).pipe(Effect.andThen(Deferred.await(written))),
          });
          yield* TestClock.adjust(Duration.zero);
          const socket = yield* opened(sockets, 0);
          socket.hear({ type: "state", mate: STATE, admission: ADMISSION, pingIntervalMs: 1_000 });
          socket.hear({ type: "git-credential", credential: "credential-fixture" });
          yield* Deferred.await(writing);
          yield* TestClock.adjust(Duration.millis(2_999));
          socket.hear({ type: "ping" });
          yield* TestClock.adjust(Duration.millis(2_999));
          assert.isFalse(socket.closed);
          assert.lengthOf(sockets, 1);
          // Unknown frames also prove inbound liveness without claiming domain progress.
          socket.hear({ type: "future-frame" });
          yield* TestClock.adjust(Duration.millis(2_999));
          assert.isFalse(socket.closed);
          yield* Deferred.succeed(written, undefined);
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(socket.sent.at(-1), { type: "pong" });
          yield* TestClock.adjust(Duration.millis(1));
          assert.isTrue(socket.closed);
        }),
      ),
  );

  it.live(
    "checks the current org policy with a fresh correlated reply before granting update permission",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { autoUpdatePolicy, connected } = yield* rig();
          const socket = yield* Queue.take(connected);
          socket.emit("open");
          socket.hear({
            type: "state",
            mate: STATE,
            admission: ADMISSION,
            autoUpdate: { orgId: "ORG", enabled: true, revision: 0 },
          });
          yield* Stream.runHead(autoUpdatePolicy.changes.pipe(Stream.filter(Option.isSome)));
          const held = { orgId: "ORG", enabled: false, revision: 1 };
          socket.onSent = (message) => {
            if (message.type !== "auto-update-policy") return;
            socket.hear({
              type: "auto-update-policy",
              requestId: "unrelated",
              policy: { orgId: "ORG", enabled: true, revision: 0 },
            });
            socket.hear({
              type: "auto-update-policy",
              requestId: message["requestId"],
              policy: held,
            });
          };
          assert.deepStrictEqual(yield* autoUpdatePolicy.verify, Option.some(held));
          assert.deepStrictEqual(yield* autoUpdatePolicy.current, Option.some(held));
        }),
      ),
  );

  it.effect(
    "opens its link with the project's key as its first frame, nothing in the URL, and speaks once HQ answered",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { link, key, sockets } = yield* rig();
          const first = yield* opened(sockets, 0);
          assert.strictEqual(first.url, "wss://hq.test/api/mate/link");
          // HQ counts nothing before it admitted the key: no overview yet, though pings are answered.
          first.hear({ type: "ping" });
          yield* TestClock.adjust(Duration.seconds(1));
          assert.deepStrictEqual(first.sent, [hello("zk-1"), { type: "pong" }]);
          assert.deepStrictEqual(yield* link.standing, { kind: "not-linked" });
          admit(first);
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(first.sent.slice(2), [
            { type: "overview", full: true, overview: overview("Add a login page") },
          ]);
          assert.deepStrictEqual(yield* link.standing, { kind: "linked", mate: STATE });
          // zcp rewrote the key: the next link presents the new one.
          yield* Ref.set(key, "zk-2");
          first.emit("close");
          yield* TestClock.adjust(Duration.millis(30));
          const second = yield* opened(sockets, 1);
          assert.deepStrictEqual(second.sent, [hello("zk-2")]);
        }),
      ),
  );

  it.effect(
    "tells HQ in its hello the fingerprint of the Git credential it holds, read afresh for every dial, and nothing while it holds none",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { fingerprint, sockets } = yield* rig();
          const first = yield* opened(sockets, 0);
          assert.deepStrictEqual(first.sent, [hello("zk-1")]);
          yield* Ref.set(fingerprint, Option.some("f".repeat(64)));
          first.emit("close");
          yield* TestClock.adjust(Duration.millis(30));
          const second = yield* opened(sockets, 1);
          assert.deepStrictEqual(second.sent, [
            { ...hello("zk-1"), gitFingerprint: "f".repeat(64) },
          ]);
          yield* Ref.set(fingerprint, Option.none());
          second.emit("close");
          yield* TestClock.adjust(Duration.millis(30));
          assert.deepStrictEqual((yield* opened(sockets, 2)).sent, [hello("zk-1")]);
        }),
      ),
  );

  it.effect("says it does not link while its public origin is unknown, and dials nothing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, sockets } = yield* rig({ publicOrigin: undefined });
        yield* TestClock.adjust(Duration.seconds(1));
        assert.lengthOf(sockets, 0);
        assert.deepStrictEqual(yield* link.standing, {
          kind: "not-linked",
          withheld: "no_public_origin",
        });
      }),
    ),
  );

  it.effect("dials nothing while the container holds no key, and links once it does", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { key, sockets } = yield* rig({ keyless: true });
        yield* TestClock.adjust(Duration.seconds(1));
        assert.lengthOf(sockets, 0);
        yield* Ref.set(key, "zk-1");
        yield* TestClock.adjust(Duration.millis(30));
        const socket = yield* opened(sockets, 0);
        assert.deepStrictEqual(socket.sent, [hello("zk-1")]);
      }),
    ),
  );

  /** Who an older HQ said the project opens for, as it sent it: a snapshot, then its refusal. */
  const olderAccess = [
    {
      type: "access",
      version: 1,
      viewAt: "2026-10-24T10:00:00.000Z",
      full: true,
      members: [{ userId: "bob", role: "OWNER", visibility: "open" }],
    },
    { type: "access", version: 2, full: true, refused: true, members: [] },
  ];

  it.effect(
    "Decision: The link's hello and state handling are unchanged; a Mate on a new server still links to an older HQ that sends `access` frames and ignores them",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { link, sockets } = yield* rig();
          const socket = yield* linked(sockets, 0);
          for (const frame of olderAccess) socket.hear(frame);
          socket.hear({ type: "ping" });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(socket.sent[0], hello("zk-1"));
          assert.deepStrictEqual(socket.sent.at(-1), { type: "pong" });
          assert.isFalse(socket.closed);
          assert.strictEqual(sockets.length, 1);
          assert.deepStrictEqual(yield* link.standing, { kind: "linked", mate: STATE });
          socket.closeWith(1006);
          yield* TestClock.adjust(Duration.millis(30));
          const next = yield* linked(sockets, 1);
          for (const frame of olderAccess) next.hear(frame);
          next.hear({ type: "ping" });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(next.sent.at(-1), { type: "pong" });
          assert.isFalse(next.closed);
          assert.deepStrictEqual(yield* link.standing, { kind: "linked", mate: STATE });
        }),
      ),
  );

  it.effect(
    "Decision: The Mate's admission list is computed from its own Zerops stream and REST pair only; the relayed `access` frame, its `heard` state, its merge into the list, its contract field and its tests are deleted (Drops-test trailers). Decision: What must NOT happen: no new frame; no polling; no second list.",
    () =>
      Effect.gen(function* () {
        // Zerops names Jan alone; the older HQ's list opens the project for Bob.
        const scene = yield* makeAccessScene({ jan: "OWNER" });
        const tickets = yield* Tickets.make;
        const connections = yield* Connections.make.pipe(
          Effect.provideService(Access.ZeropsMateAccessList, scene.list),
          Effect.provideService(Tickets.ZeropsTicketDoor, tickets),
          Effect.provide(NodeCrypto.layer),
        );
        const sockets: Array<FakeSocket> = [];
        const answers = yield* Queue.unbounded<unknown>();
        yield* makeZeropsHqLink({
          hqOrigin: "https://hq.test",
          serviceId: "svc-mate",
          publicOrigin: "https://mate.example",
          readKey: Effect.succeed("project-key"),
          connect: (url) => {
            const socket = new FakeSocket(url);
            socket.onSent = (message) => {
              if (message.type === "ticket-ack" || message.type === "ticket_refused")
                Queue.offerUnsafe(answers, message);
            };
            sockets.push(socket);
            return socket;
          },
          overview: Effect.succeed(Option.none()),
          changes: Stream.never,
          attention: Stream.never,
          ticket: connections.ticket,
          end: connections.end,
          heldSessions: connections.heldSessions,
          gitCredential: () => Effect.void,
          gitFingerprint: Effect.succeed(Option.none()),
        });
        const socket = yield* linked(sockets, 0);
        const ticket = (userId: string) => ({
          type: "ticket",
          ticket: `t-${userId}`,
          userId,
          sessionId: "hq-session",
          expiresIn: 60,
        });
        socket.hear(olderAccess[0]);
        socket.hear(ticket("bob"));
        assert.deepStrictEqual(yield* Queue.take(answers), {
          type: "ticket_refused",
          ticket: "t-bob",
          reason: "not_in_list",
        });
        socket.hear(ticket("jan"));
        assert.deepStrictEqual(yield* Queue.take(answers), {
          type: "ticket-ack",
          ticket: "t-jan",
        });
        assert.deepStrictEqual(
          socket.sent.map((message) => message.type),
          ["hello", "ticket_refused", "ticket-ack"],
        );
      }).pipe(Effect.scoped),
  );

  it.effect(
    "TC-6 and TC-8 the HQ link holds tickets before acknowledging and forwards sign-out to live connections",
    () =>
      Effect.gen(function* () {
        const scene = yield* makeAccessScene({ jan: "OWNER" });
        const tickets = yield* Tickets.make;
        const connections = yield* Connections.make.pipe(
          Effect.provideService(Access.ZeropsMateAccessList, scene.list),
          Effect.provideService(Tickets.ZeropsTicketDoor, tickets),
          Effect.provide(NodeCrypto.layer),
        );
        const sockets: Array<FakeSocket> = [];
        const pongs = yield* Queue.unbounded<void>();
        const acks = yield* Queue.unbounded<void>();
        const closed: Array<string> = [];
        const heldAtAcknowledgement: Array<boolean> = [];
        let ticketHeld = false;
        yield* makeZeropsHqLink({
          hqOrigin: "https://hq.test",
          serviceId: "svc-mate",
          publicOrigin: "https://mate.example",
          readKey: Effect.succeed("project-key"),
          connect: (url) => {
            const socket = new FakeSocket(url);
            socket.onSent = (message) => {
              if (message.type === "ticket-ack") {
                heldAtAcknowledgement.push(ticketHeld);
                Queue.offerUnsafe(acks, undefined);
              }
              if (message.type === "pong") Queue.offerUnsafe(pongs, undefined);
            };
            sockets.push(socket);
            return socket;
          },
          overview: Effect.succeed(Option.none()),
          changes: Stream.never,
          attention: Stream.never,
          ticket: (frame, live) =>
            connections.ticket(frame, live).pipe(
              Effect.map(
                Effect.tap(() =>
                  Effect.sync(() => {
                    ticketHeld = true;
                  }),
                ),
              ),
            ),
          end: connections.end,
          heldSessions: connections.heldSessions,
          gitCredential: () => Effect.void,
          gitFingerprint: Effect.succeed(Option.none()),
        });
        const socket = yield* linked(sockets, 0);
        socket.hear({
          type: "ticket",
          ticket: "browser-ticket",
          userId: "jan",
          sessionId: "hq-session",
          expiresIn: 60,
        });
        yield* Queue.take(acks);
        assert.deepEqual(heldAtAcknowledgement, [true]);
        assert.deepEqual(
          socket.sent.filter((message) => message.type === "ticket-ack"),
          [{ type: "ticket-ack", ticket: "browser-ticket" }],
        );
        const admission = yield* connections.admit(
          { ticket: "browser-ticket" },
          Effect.sync(() => {
            closed.push("browser");
          }),
        );
        assert.strictEqual(Option.getOrThrow(admission).sessionId, "hq-session");
        socket.hear({ type: "close-session", sessionId: "hq-session" });
        socket.hear({ type: "ping" });
        yield* Queue.take(pongs);
        assert.deepEqual(closed, ["browser"]);
        assert.isTrue(Option.isNone(yield* connections.current("browser-ticket")));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "answers a ticket the Mate's own list does not open for with ticket_refused and its reason, instead of ticket-ack",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const verdicts = { jan: "open", eva: "read_only" } as const;
          const { sockets } = yield* rig({
            ticket: (frame) =>
              Effect.succeed(
                Effect.succeed(
                  frame.userId in verdicts
                    ? verdicts[frame.userId as keyof typeof verdicts]
                    : "not_in_list",
                ),
              ),
          });
          const socket = yield* linked(sockets, 0);
          for (const userId of ["jan", "eva", "token"])
            socket.hear({
              type: "ticket",
              ticket: `t-${userId}`,
              userId,
              sessionId: "s",
              expiresIn: 60,
            });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(
            socket.sent.filter(
              (message) => message.type === "ticket-ack" || message.type === "ticket_refused",
            ),
            [
              { type: "ticket-ack", ticket: "t-jan" },
              { type: "ticket_refused", ticket: "t-eva", reason: "read_only" },
              { type: "ticket_refused", ticket: "t-token", reason: "not_in_list" },
            ],
          );
        }),
      ),
  );

  it.effect(
    "A ticket whose verdict waits on a Zerops read holds back none of the frames after it: ping and close-session are answered at once",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const readAnswers = yield* Deferred.make<void>();
          const closedSessions: Array<string> = [];
          const { sockets } = yield* rig({
            ticket: () =>
              Effect.succeed(Deferred.await(readAnswers).pipe(Effect.as("open" as const))),
            end: (subject) =>
              Effect.sync(() => {
                if ("session" in subject) closedSessions.push(subject.session);
              }),
          });
          const socket = yield* linked(sockets, 0);
          socket.hear({
            type: "ticket",
            ticket: "t-1",
            userId: "jan",
            sessionId: "s",
            expiresIn: 60,
          });
          socket.hear({ type: "close-session", sessionId: "other" });
          socket.hear({ type: "ping" });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(closedSessions, ["other"]);
          assert.deepStrictEqual(
            socket.sent.filter(
              (message) => message.type === "pong" || message.type === "ticket-ack",
            ),
            [{ type: "pong" }],
          );
          yield* Deferred.succeed(readAnswers, undefined);
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(
            socket.sent.filter((message) => message.type === "ticket-ack"),
            [{ type: "ticket-ack", ticket: "t-1" }],
          );
        }),
      ),
  );

  it.effect("acknowledges Observe writes and revocation only after their truthful receipt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const lands = yield* Deferred.make<void>();
        const written: Array<string | null> = [];
        const { sockets } = yield* rig({
          observeCredential: (credential) =>
            Effect.uninterruptible(
              (credential === "zobs.delayed" ? Deferred.await(lands) : Effect.void).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    written.push(credential);
                    return credential !== "zobs.failed";
                  }),
                ),
              ),
            ),
        });
        const socket = yield* linked(sockets, 0);
        const acks = () =>
          socket.sent.filter((message) => message.type === "observe-credential-ack");
        socket.hear({ type: "observe-credential", id: "write", credential: "zobs.delayed" });
        socket.hear({ type: "observe-credential", id: "revoke", credential: null });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(acks(), []);
        assert.deepStrictEqual(written, []);
        yield* Deferred.succeed(lands, undefined);
        yield* TestClock.adjust(Duration.zero);
        socket.hear({ type: "observe-credential", id: "failed", credential: "zobs.failed" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(written, ["zobs.delayed", null, "zobs.failed"]);
        assert.deepStrictEqual(acks(), [
          { type: "observe-credential-ack", id: "write", ok: true },
          { type: "observe-credential-ack", id: "revoke", ok: true },
          { type: "observe-credential-ack", id: "failed", ok: false },
        ]);
      }),
    ),
  );

  it.effect("refuses Observe delivery when no credential writer is available", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig();
        const socket = yield* linked(sockets, 0);
        socket.hear({ type: "observe-credential", id: "absent", credential: "zobs.value" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(socket.sent.at(-1), {
          type: "observe-credential-ack",
          id: "absent",
          ok: false,
        });
      }),
    ),
  );

  it.effect("an Observe write from an old link cannot land after its successor's credential", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const oldLands = yield* Deferred.make<void>();
        const written: Array<string | null> = [];
        const { sockets } = yield* rig({
          observeCredential: (credential) =>
            Effect.uninterruptible(
              (credential === "zobs.old" ? Deferred.await(oldLands) : Effect.void).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    written.push(credential);
                    return true;
                  }),
                ),
              ),
            ),
        });
        const first = yield* linked(sockets, 0);
        first.hear({ type: "observe-credential", id: "old", credential: "zobs.old" });
        yield* TestClock.adjust(Duration.zero);
        first.closeWith(4409);
        // A late frame queued after the close must never land.
        first.hear({ type: "observe-credential", id: "stale", credential: "zobs.stale" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(written, []);
        yield* Deferred.succeed(oldLands, undefined);
        yield* TestClock.adjust(Duration.millis(30));
        const successor = yield* linked(sockets, 1);
        successor.hear({ type: "observe-credential", id: "new", credential: "zobs.new" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(written, ["zobs.old", "zobs.new"]);
        assert.deepStrictEqual(successor.sent.at(-1), {
          type: "observe-credential-ack",
          id: "new",
          ok: true,
        });
      }),
    ),
  );

  it.effect("ignores malformed signer frames and accepts the next valid frame", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, signIns } = yield* rig();
        const moved = yield* Stream.runHead(signIns.changes).pipe(
          Effect.forkScoped({ startImmediately: true }),
        );
        const socket = yield* linked(sockets, 0);
        socket.hear({ type: "signers", signers: null });
        socket.hear({ type: "signers", signers: { codex: 42 } });
        socket.hear({ type: "signers", signers: { codex: "U-eva" } });
        yield* Fiber.join(moved);
        assert.deepStrictEqual(yield* signIns.load, { codex: { by: "U-eva" } });
      }),
    ),
  );

  it.effect("takes whose each login is from HQ's signers frame, at once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, signIns } = yield* rig();
        const moved = yield* Stream.runHead(signIns.changes).pipe(
          Effect.forkScoped({ startImmediately: true }),
        );
        const socket = yield* linked(sockets, 0);
        socket.hear({ type: "signers", signers: { "claude-code": "U-eva", codex: "U-jan" } });
        yield* Fiber.join(moved);
        assert.deepStrictEqual(yield* signIns.load, {
          "claude-code": { by: "U-eva" },
          codex: { by: "U-jan" },
        });
      }),
    ),
  );

  it.effect("keeps the Git credential HQ sends, and lets it go when HQ revokes it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, credentials } = yield* rig();
        const socket = yield* linked(sockets, 0);
        socket.hear({ type: "git-credential", credential: "ORG.secret" });
        socket.hear({ type: "git-credential", credential: null });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(credentials, ["ORG.secret", null]);
      }),
    ),
  );

  it.effect(
    "tells which project the organisation's Chief mark names with every state HQ sends",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { sockets, chiefs } = yield* rig();
          const socket = yield* linked(sockets, 0);
          admit(socket, { ...STATE, chief: { projectId: "P_MATE" } });
          admit(socket, { ...STATE, chief: { projectId: "P_OTHER" } });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(chiefs, [null, "P_MATE", "P_OTHER"]);
        }),
      ),
  );

  // witness: apps/server/src/zerops/ZeropsHqLink.ts | yield* SubscriptionRef.set(state, Option.none()); → yield* Effect.void;
  // witness: apps/server/src/zerops/ZeropsHqLink.ts | return "refusal" in heard ? "key_refused" : "key_unresolved"; → return "refusal" in heard ? "key_unresolved" : "key_refused";
  it.effect("A link that ended is not linked, and the file says why with the last state.", () =>
    Effect.gen(function* () {
      const { read, landed, mateState } = yield* stateFile;
      const { link, sockets } = yield* rig({ mateState });
      const mate = { ...STATE, repos: [] };
      const first = yield* linked(sockets, 0);
      yield* Queue.take(landed);
      first.closeWith(1006);
      yield* TestClock.adjust(Duration.zero);
      yield* Queue.take(landed);
      assert.deepStrictEqual(yield* link.standing, { kind: "not-linked" });
      assert.deepStrictEqual(yield* read, {
        link: "not-linked",
        reason: "closed",
        heardAt: "1970-01-01T00:00:00.000Z",
        mate,
      });
      yield* TestClock.adjust(Duration.millis(30));
      const second = yield* linked(sockets, 1);
      yield* Queue.take(landed);
      second.closeWith(4401, "key_refused");
      yield* TestClock.adjust(Duration.zero);
      yield* Queue.take(landed);
      assert.deepStrictEqual(yield* read, {
        link: "not-linked",
        reason: "key_refused",
        heardAt: "1970-01-01T00:00:00.030Z",
        mate,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  // witness: apps/server/src/zerops/ZeropsHqLink.ts | Result.isFailure(frame) || frame.success.type === "state" → Result.isSuccess(frame) && frame.success.type === "state"
  it.effect("A state this build cannot decode still reaches the file.", () =>
    Effect.gen(function* () {
      const { read, mateState } = yield* stateFile;
      const { link, sockets } = yield* rig({ mateState });
      const socket = yield* opened(sockets, 0);
      const newer = { projectId: "P_MATE", fromANewerHq: true };
      // Frames are taken in order: the pong is the receipt that the state was handled.
      const ponged = yield* Deferred.make<void>();
      socket.onSent = (message) => {
        if (message.type === "pong") Deferred.doneUnsafe(ponged, Effect.void);
      };
      socket.hear({ type: "state", mate: newer, admission: ADMISSION });
      socket.hear({ type: "ping" });
      yield* Deferred.await(ponged);
      assert.deepStrictEqual(yield* read, {
        link: "linked",
        heardAt: "1970-01-01T00:00:00.000Z",
        mate: newer,
      });
      assert.deepStrictEqual(yield* link.standing, { kind: "not-linked" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  // HQ's state carries the application the Mate is in and its changes there: kept whole, as sent.
  it.live("hands on HQ's word that the Mate is automated, and the organization's keys", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, until, automation } = yield* rig({ everyMs: 10 });
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const automated: LinkedMate = { ...STATE, automated: true };
        socket.hear({ type: "state", mate: automated, admission: ADMISSION });
        const keys = [{ env: "NEBIUS_API_KEY", value: ["nb", "acme", "fixture"].join("-") }];
        socket.hear({ type: "provider-keys", keys });
        const model = "nebius/zai-org/GLM-5.3-Flash";
        socket.hear({ type: "provider-keys", keys, model });
        yield* until(() => automation[2]);
        assert.deepStrictEqual(automation, [{ heard: automated }, { keys }, { keys, model }]);
      }),
    ),
  );

  it.live("works a task HQ tells once HQ said who the Mate is, and sends how it stands", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, until, taken } = yield* rig({ everyMs: 10 });
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const task = {
          id: "task-1",
          source: {
            kind: "github-issue",
            repo: "acme/tea-shop",
            number: 42,
            url: "https://github.com/acme/tea-shop/issues/42",
            title: "The cart forgets its teas",
            author: null,
          },
          body: "",
          limits: { minutes: 60, costUsd: null },
        };
        // Told before HQ's state, it is held until the Mate knows whether it is automated.
        socket.hear({ type: "task", task });
        // HQ's frames are heard in order: once the ping is answered, the task was heard.
        socket.hear({ type: "ping" });
        yield* until(() => socket.sent.find((message) => message.type === "pong"));
        assert.deepStrictEqual(taken, []);
        assert.isFalse(socket.sent.some((message) => message.type === "task-state"));
        socket.hear({ type: "state", mate: { ...STATE, automated: true }, admission: ADMISSION });
        yield* until(() => (taken.length > 0 ? taken : undefined));
        const reports = yield* until(() => {
          const found = socket.sent.filter((message) => message.type === "task-state");
          return found.length >= 2 ? found : undefined;
        });
        assert.sameDeepMembers(reports, [
          { type: "task-state", report: { taskId: "task-0", state: "done" } },
          { type: "task-state", report: { taskId: "task-1", state: "accepted" } },
        ]);
        assert.deepStrictEqual(taken, ["task-1"]);
      }),
    ),
  );

  it.live("hands a task's follow-ups and its stop on once HQ said who the Mate is", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, until, taken } = yield* rig({ everyMs: 10 });
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        socket.hear({
          type: "task-message",
          taskId: "task-1",
          message: { id: "m-1", from: "comment", author: "nova", text: "Also the teapot." },
          // The task's change: where its follow-up's work starts.
          change: { repo: "appdev", number: 3, branch: "mate/P_ROBOT/3" },
        });
        socket.hear({ type: "ping" });
        yield* until(() => socket.sent.find((message) => message.type === "pong"));
        assert.deepStrictEqual(taken, []);
        socket.hear({ type: "state", mate: { ...STATE, automated: true }, admission: ADMISSION });
        yield* until(() => (taken.length > 0 ? taken : undefined));
        socket.hear({ type: "task-stop", taskId: "task-1", reason: "The issue was closed." });
        yield* until(() => (taken.length > 1 ? taken : undefined));
        assert.deepStrictEqual(taken, [
          "task-1:m-1@mate/P_ROBOT/3",
          "task-1:The issue was closed.",
        ]);
      }),
    ),
  );

  it.live("sends no task report on a link whose HQ never said the Mate is automated", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, until, taken } = yield* rig({ everyMs: 10 });
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        // An HQ from before automated Mates: its state names no flag, and it never hears of tasks.
        socket.hear({ type: "state", mate: STATE, admission: ADMISSION });
        socket.hear({
          type: "task",
          task: {
            id: "task-1",
            source: {
              kind: "github-issue",
              repo: "acme/tea-shop",
              number: 42,
              url: "https://github.com/acme/tea-shop/issues/42",
              title: "The cart forgets its teas",
              author: null,
            },
            body: "",
            limits: { minutes: 60, costUsd: null },
          },
        });
        yield* until(() => (taken.length > 0 ? taken : undefined));
        socket.hear({ type: "ping" });
        yield* until(() => socket.sent.find((message) => message.type === "pong"));
        assert.isFalse(socket.sent.some((message) => message.type === "task-state"));
      }),
    ),
  );

  it.live(
    "A task frame the Mate cannot decode is logged with the decode error and answered to HQ as a failed task, never dropped silently",
    () => {
      const logged: Array<string> = [];
      const logger = Logger.make(({ message }) => void logged.push(JSON.stringify(message)));
      return Effect.scoped(
        Effect.gen(function* () {
          const { sockets, until, taken } = yield* rig({ everyMs: 10 });
          const socket = yield* until(() => sockets[0]);
          socket.emit("open");
          socket.hear({ type: "state", mate: { ...STATE, automated: true }, admission: ADMISSION });
          // A task this Mate cannot read: its limits allow no minutes.
          socket.hear({
            type: "task",
            task: {
              id: "task-1",
              source: {
                kind: "github-issue",
                repo: "acme/tea-shop",
                number: 42,
                url: "https://github.com/acme/tea-shop/issues/42",
                title: "The cart forgets its teas",
                author: null,
              },
              body: "",
              limits: { minutes: 0, costUsd: null },
            },
          });
          const reports = yield* until(() => {
            const found = socket.sent.filter((message) => message.type === "task-state");
            return found.length >= 2 ? found : undefined;
          }).pipe(Effect.timeoutOption(Duration.seconds(2)));
          assert.sameDeepMembers(
            Option.getOrElse(reports, () => []),
            [
              { type: "task-state", report: { taskId: "task-0", state: "done" } },
              {
                type: "task-state",
                report: {
                  taskId: "task-1",
                  state: "failed",
                  detail: "This Mate could not read the task as HQ sent it.",
                },
              },
            ],
          );
          assert.deepStrictEqual(taken, []);
          const warning = logged.find((line) => line.includes("could not read a task"));
          assert.include(warning, "task-1");
          assert.include(warning, "minutes");
        }),
      ).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
    },
  );

  it.live("keeps HQ's state with the application and the changes it carries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, sockets, until } = yield* rig({ everyMs: 10 });
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const placed: LinkedMate = {
          ...STATE,
          appId: "app-1",
          appName: "Shop",
          changes: [
            {
              repo: "shop",
              number: 3,
              title: "Mate: shop",
              state: "open",
              head: "a".repeat(40),
              mergedSha: null,
              landedHead: null,
            },
          ],
        };
        socket.hear({ type: "state", mate: placed, admission: ADMISSION });
        const held = yield* link.standing.pipe(
          Effect.flatMap((standing) =>
            standing.kind === "linked" ? Effect.succeed(standing.mate) : Effect.fail("not yet"),
          ),
          Effect.retry(Schedule.spaced(Duration.millis(5))),
        );
        assert.deepStrictEqual(held, placed);
      }),
    ),
  );

  // An HQ older than the application's name sends none: the state is kept, naming none.
  it.live("keeps an older HQ's state, its application named by none", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, sockets, until } = yield* rig({ everyMs: 10 });
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const { appName: _appName, ...older } = { ...STATE, appId: "app-1" };
        socket.hear({ type: "state", mate: older, admission: ADMISSION });
        const held = yield* link.standing.pipe(
          Effect.flatMap((standing) =>
            standing.kind === "linked" ? Effect.succeed(standing.mate) : Effect.fail("not yet"),
          ),
          Effect.retry(Schedule.spaced(Duration.millis(5))),
        );
        assert.deepStrictEqual(held, { ...older, appName: null });
      }),
    ),
  );

  // F6: the server refuses acting calls from whoever HQ does not name as the Mate's owner.
  it.live("a colleague only reads along in the Mate HQ names someone else the owner of", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, sockets, until } = yield* rig({ everyMs: 10 });
        const actingOf = (standing: HqStanding, subject: string) =>
          actingIn(
            standing.kind === "linked" ? (standing.mate.ownerUserId ?? null) : undefined,
            standing,
            subject,
          );
        assert.strictEqual(actingOf(yield* link.standing, "zerops-user:colleague"), "acts");
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const ownerNamed = (ownerUserId: string | undefined) =>
          link.standing.pipe(
            Effect.flatMap((standing) =>
              standing.kind === "linked" && standing.mate.ownerUserId === ownerUserId
                ? Effect.succeed(standing)
                : Effect.fail("not yet"),
            ),
            Effect.retry(Schedule.spaced(Duration.millis(5))),
          );
        socket.hear({
          type: "state",
          mate: { ...STATE, ownerUserId: "owner-1" },
          admission: ADMISSION,
        });
        const named = yield* ownerNamed("owner-1");
        assert.deepStrictEqual(
          ["zerops-user:colleague", "zerops-user:owner-1", "local-owner"].map((subject) =>
            actingOf(named, subject),
          ),
          ["reads-along", "acts", "acts"],
        );
        // HQ that knows no owner names none.
        socket.hear({ type: "state", mate: STATE, admission: ADMISSION });
        assert.strictEqual(actingOf(yield* ownerNamed(undefined), "zerops-user:colleague"), "acts");
      }),
    ),
  );

  // HQ names its refusal of the key as the close reason; the setup's git step says it.
  it.effect("says HQ refused its key, with HQ's reason, until HQ next sends its state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, sockets } = yield* rig();
        const first = yield* opened(sockets, 0);
        first.closeWith(4403, "key_not_sensitive");
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(yield* link.standing, {
          kind: "not-linked",
          refusal: "key_not_sensitive",
        });
        // A refused key is asked again only after the re-ask (and its spread) when its store stays put.
        yield* TestClock.adjust(REASKED);
        const second = yield* opened(sockets, 1);
        second.closeWith(4401, "key_refused");
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(yield* link.standing, {
          kind: "not-linked",
          refusal: "key_refused",
        });
        // A close that names no refusal leaves the last one standing; HQ's state clears it.
        yield* TestClock.adjust(REASKED);
        const third = yield* opened(sockets, 2);
        admit(third);
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(yield* link.standing, { kind: "linked", mate: STATE });
      }),
    ),
  );

  // `4409`: the project's newer link took over. Expected, so no failure grows the wait.
  it.effect("links again after the shortest wait when HQ superseded its link", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig({ reconnectDelaysMs: [100, 1_000, 10_000] });
        const first = yield* opened(sockets, 0);
        first.emit("close");
        yield* TestClock.adjust(Duration.millis(130));
        const second = yield* opened(sockets, 1);
        second.closeWith(4409);
        // Two failures in a row would wait 1 s; a superseded link waits the shortest.
        yield* TestClock.adjust(Duration.millis(130));
        assert.lengthOf(sockets, 3);
      }),
    ),
  );

  it.effect("waits longer each time a link closes right after it opened", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig({ reconnectDelaysMs: [100, 1_000, 10_000] });
        const first = yield* opened(sockets, 0);
        first.emit("close");
        yield* TestClock.adjust(Duration.millis(130));
        const second = yield* opened(sockets, 1);
        second.emit("close");
        // A link that lived no time does not reset the wait: the next one is 1 s away, not 100 ms.
        yield* TestClock.adjust(Duration.millis(130));
        assert.lengthOf(sockets, 2);
        yield* TestClock.adjust(Duration.millis(1_200));
        assert.lengthOf(sockets, 3);
      }),
    ),
  );

  it.effect("sends the whole overview first on every link it opens", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig();
        const first = yield* linked(sockets, 0);
        assert.deepStrictEqual(first.sent, [
          hello("zk-1"),
          { type: "overview", full: true, overview: overview("Add a login page") },
        ]);
        first.emit("close");
        // The next link waits out its backoff (at most 20 ms and a quarter more), then opens.
        yield* TestClock.adjust(Duration.millis(30));
        const second = yield* linked(sockets, 1);
        assert.deepStrictEqual(second.sent, [
          hello("zk-1"),
          { type: "overview", full: true, overview: overview("Add a login page") },
        ]);
      }),
    ),
  );

  it.effect("sends the attention whole on every link it opens, then each new revision", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const attention = yield* SubscriptionRef.make(attentionAt(0));
        const { sockets } = yield* rig({
          attention: SubscriptionRef.changes(attention),
        });
        const attentionSent = (socket: FakeSocket) =>
          socket.sent.filter((frame) => frame.type === "attention");
        const first = yield* linked(sockets, 0);
        yield* SubscriptionRef.set(attention, attentionAt(1));
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(attentionSent(first), [
          { type: "attention", attention: attentionAt(0) },
          { type: "attention", attention: attentionAt(1) },
        ]);
        // Beside the overview, never in its place.
        assert.isTrue(first.sent.some((frame) => frame.type === "overview"));
        first.emit("close");
        yield* TestClock.adjust(Duration.millis(30));
        const second = yield* linked(sockets, 1);
        assert.deepStrictEqual(attentionSent(second), [
          { type: "attention", attention: attentionAt(1) },
        ]);
      }),
    ),
  );

  it.effect("links again after a link fails, whatever failed in it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let subscriptions = 0;
        const { sockets } = yield* rig({
          attention: Stream.suspend(() => {
            subscriptions += 1;
            return subscriptions === 1 ? Stream.die("the attention could not start") : Stream.never;
          }),
        });
        yield* linked(sockets, 0);
        yield* TestClock.adjust(Duration.millis(30));
        const second = yield* linked(sockets, 1);
        assert.isTrue(second.sent.some((frame) => frame.type === "overview"));
      }),
    ),
  );

  it.effect(
    "Decision: The Mate overview goes up at its change, at most once per 500 ms; nothing ticks while nothing changed.",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const now = yield* Ref.make(overview("Add a login page"));
          const state = { readable: true, reads: 0 };
          const { sockets, changes } = yield* rig({
            overview: Effect.suspend(() => {
              state.reads += 1;
              return state.readable
                ? Ref.get(now).pipe(Effect.map(Option.some))
                : Effect.succeed(Option.none<MateOverview>());
            }),
          });
          const socket = yield* linked(sockets, 0);
          const sectionsOf = (title: string) => ({
            type: "overview",
            full: false,
            sections: { threads: overview(title).threads },
          });
          const change = (title: string) =>
            Ref.set(now, overview(title)).pipe(
              Effect.andThen(PubSub.publish(changes, undefined)),
              Effect.andThen(TestClock.adjust(Duration.zero)),
            );
          // A change after a quiet while goes up at once, not at a next tick.
          yield* TestClock.adjust(Duration.millis(10_250));
          assert.strictEqual(state.reads, 1);
          yield* change("Add a sign-up page");
          assert.deepStrictEqual(socket.sent.slice(2), [sectionsOf("Add a sign-up page")]);
          // Changes inside the window wait for its end, and go up as one frame of the last.
          yield* TestClock.adjust(Duration.millis(100));
          yield* change("Add a password reset");
          yield* TestClock.adjust(Duration.millis(200));
          yield* change("Add a password reset link");
          yield* TestClock.adjust(Duration.millis(199));
          assert.strictEqual(socket.sent.length, 3);
          yield* TestClock.adjust(Duration.millis(1));
          assert.deepStrictEqual(socket.sent.slice(3), [sectionsOf("Add a password reset link")]);
          // An overview that cannot be read is read again at the next change, never on a timer.
          yield* TestClock.adjust(Duration.seconds(1));
          state.readable = false;
          const before = state.reads;
          yield* change("Add a profile page");
          assert.strictEqual(state.reads, before + 1);
          yield* TestClock.adjust(Duration.minutes(2));
          assert.strictEqual(state.reads, before + 1);
          state.readable = true;
          yield* change("Add a profile page");
          assert.deepStrictEqual(socket.sent.at(-1), sectionsOf("Add a profile page"));
          assert.strictEqual(socket.sent.length, 5);
        }),
      ),
  );

  it.effect("keeps the original link past the IPv4 cut and continues answering HQ", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig();
        const first = yield* linked(sockets, 0);
        yield* TestClock.adjust(Duration.seconds(150));
        assert.lengthOf(sockets, 1);
        first.hear({ type: "ping" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(first.sent.at(-1), { type: "pong" });
        assert.isFalse(first.closed);
        assert.lengthOf(sockets, 1);
      }),
    ),
  );

  it.effect("after HQ supersedes the single link, reconnects once and uses its new state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, link } = yield* rig();
        const first = yield* linked(sockets, 0);
        first.closeWith(4409);
        yield* TestClock.adjust(Duration.millis(30));
        const successor = yield* opened(sockets, 1);
        assert.isFalse(successor.closed);
        assert.lengthOf(sockets, 2);
        admit(successor, { ...STATE, name: "Ada II" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(successor.sent.slice(1), [
          { type: "overview", full: true, overview: overview("Add a login page") },
        ]);
        const standing = yield* link.standing;
        assert.isTrue(standing.kind === "linked" && standing.mate.name === "Ada II");
        yield* TestClock.adjust(Duration.seconds(150));
        assert.lengthOf(sockets, 2);
        assert.isFalse(successor.closed);
      }),
    ),
  );

  it.effect("reconnects after HQ closes a link before sending its first state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, link } = yield* rig();
        const first = yield* opened(sockets, 0);
        assert.deepStrictEqual(first.sent, [hello("zk-1")]);
        first.closeWith(4409);
        yield* TestClock.adjust(Duration.millis(30));
        const successor = yield* linked(sockets, 1);
        assert.isTrue(first.closed);
        assert.isFalse(successor.closed);
        assert.lengthOf(sockets, 2);
        assert.deepStrictEqual(yield* link.standing, { kind: "linked", mate: STATE });
      }),
    ),
  );

  // A closed link's late credential cannot replace one delivered after reconnecting.
  it.effect(
    "a credential frame from a superseded link never overwrites the current link's credential",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const oldLands = yield* Deferred.make<void>();
          const { sockets, credentials } = yield* rig({
            credentialLands: (credential) =>
              credential === "ORG.old" ? Deferred.await(oldLands) : Effect.void,
          });
          const first = yield* linked(sockets, 0);
          first.hear({ type: "git-credential", credential: "ORG.old" });
          yield* TestClock.adjust(Duration.zero);
          first.closeWith(4409);
          first.hear({ type: "git-credential", credential: "ORG.stale" });
          yield* TestClock.adjust(Duration.zero);
          yield* Deferred.succeed(oldLands, undefined);
          yield* TestClock.adjust(Duration.millis(30));
          const successor = yield* linked(sockets, 1);
          successor.hear({ type: "git-credential", credential: "ORG.new" });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(credentials, ["ORG.old", "ORG.new"]);
        }),
      ),
  );

  it.effect("sends nothing on a quiet link", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, changes, reads } = yield* rig();
        const socket = yield* linked(sockets, 0);
        // A change heard that changed nothing sends nothing either.
        yield* PubSub.publish(changes, undefined);
        yield* TestClock.adjust(Duration.seconds(1));
        const read = reads.count;
        // Nothing heard, nothing read: no timer looks at the overview again.
        yield* TestClock.adjust(Duration.minutes(2));
        assert.strictEqual(socket.sent.length, 2);
        assert.strictEqual(reads.count, read);
      }),
    ),
  );
});

describe("ZeropsHqLink's addresses", () => {
  it("resolves HQ only over IPv6 even when the connection asks for IPv4", () => {
    const asked: Array<unknown> = [];
    const lookup = lookupIpv6((hostname, options, callback) => {
      asked.push({ hostname, options });
      callback(null, [
        { address: "::ffff:127.0.0.1", family: 6 },
        { address: "2001:db8::1", family: 6 },
      ]);
    });
    let answered: unknown;
    let failure: NodeJS.ErrnoException | null = null;
    lookup("hq.example", { all: true, hints: 0, family: 4 }, (error, addresses) => {
      failure = error;
      answered = addresses;
    });
    assert.deepStrictEqual(asked, [
      { hostname: "hq.example", options: { all: true, hints: 0, family: 6 } },
    ]);
    assert.isNull(failure);
    assert.deepStrictEqual(answered, [{ address: "2001:db8::1", family: 6 }]);
  });

  it("rejects an IPv4 address without opening a socket", () => {
    for (const address of ["127.0.0.1", "[::ffff:127.0.0.1]"]) {
      let socket: LinkSocket | undefined;
      try {
        assert.throws(() => {
          socket = connectLinkSocket(`ws://${address}:9/api/mate/link`);
          socket.addEventListener("error", () => {});
        });
      } finally {
        socket?.close();
      }
    }
  });

  it("rejects a DNS answer that maps to IPv4", () => {
    for (const answer of ["::ffff:127.0.0.1", [{ address: "::ffff:7f00:1", family: 6 }]]) {
      const lookup = lookupIpv6((_hostname, _options, callback) => {
        callback(null, answer, 6);
      });
      const failures: Array<NodeJS.ErrnoException | null> = [];
      lookup("hq.example", {}, (error) => {
        failures.push(error);
      });
      assert.strictEqual(failures[0]?.code, "ENOTFOUND");
    }
  });
});

describe("ZeropsHqLink's overview, from the Mate's own feeds", () => {
  const NO_AUTH: ZeropsAgentAuthSnapshot = { available: true, agents: [] };
  const CLAUDE = {
    agentId: "claude-code",
    credPresent: true,
    flagOAuth: true,
    flagToken: false,
    providerAuth: "authenticated",
    state: "authorized",
  } as const;
  const APPLIED: CrewSnapshot = { ...CREW_OFF_SNAPSHOT, status: "applied" };

  /** A link over HQ whose overview is read from feeds the test moves, on the test's clock. */
  const feedRigOf = (onEngine: boolean) =>
    Effect.gen(function* () {
      const rows = yield* SubscriptionRef.make<ReadonlyArray<ConversationRow>>([]);
      const crew = yield* SubscriptionRef.make<CrewSnapshot>(CREW_OFF_SNAPSHOT);
      const auth = yield* SubscriptionRef.make<ZeropsAgentAuthSnapshot>(NO_AUTH);
      const update = yield* SubscriptionRef.make<ExecutionEnvironmentUpdate | undefined>(undefined);
      const providers = yield* SubscriptionRef.make<ReadonlyArray<ServerProvider>>([]);
      const setupMarker = yield* Ref.make(true);
      const feed = yield* mateOverviewFeed({
        setupMarker: Ref.get(setupMarker),
        providers: {
          latest: SubscriptionRef.get(providers),
          changes: SubscriptionRef.changes(providers).pipe(Stream.drop(1)),
        },
        environmentId: "env-1" as OverviewSources["environmentId"],
        serverVersion: "0.11.90",
        threads: Effect.succeed([]),
        crew: { snapshot: SubscriptionRef.changes(crew) },
        // A feed's `changes` tells of a change, never of where it stands as it is subscribed to.
        agentAuth: {
          latest: SubscriptionRef.get(auth),
          changes: SubscriptionRef.changes(auth).pipe(Stream.drop(1)),
        },
        agentLogin: { latest: Effect.succeed({}), changes: Stream.never },
        logins: { latest: Effect.succeed([]), changes: Stream.never },
        update: {
          current: SubscriptionRef.get(update),
          changes: SubscriptionRef.changes(update).pipe(Stream.drop(1)),
        },
        domainEvents: onEngine ? SubscriptionRef.changes(rows).pipe(Stream.drop(1)) : Stream.never,
        ...(onEngine ? { conversations: SubscriptionRef.get(rows), engine: { protocol: 1 } } : {}),
      });
      const sockets: Array<FakeSocket> = [];
      const connected = yield* Queue.unbounded<FakeSocket>();
      yield* makeZeropsHqLink({
        hqOrigin: "https://hq.test",
        serviceId: "svc-mate",
        publicOrigin: "https://mate-1234.prg1.zerops.app",
        readKey: Effect.succeed("zk-1"),
        connect: (url) => {
          const socket = new FakeSocket(url);
          sockets.push(socket);
          Queue.offerUnsafe(connected, socket);
          return socket;
        },
        gitCredential: () => Effect.void,
        gitFingerprint: Effect.succeed(Option.none()),
        heldSessions: Effect.succeed([]),
        attention: Stream.never,
        ...feed,
      });
      yield* TestClock.adjust(Duration.zero);
      const socket = sockets[0];
      if (socket === undefined) return yield* Effect.die("no socket");
      /** The overview frames the link sends, in order: the receipt of each look. */
      const overviews = yield* Queue.unbounded<Sent>();
      socket.onSent = (message) => {
        if (message.type === "overview") Queue.offerUnsafe(overviews, message);
      };
      socket.emit("open");
      admit(socket);
      /** Waits for the next overview frame the link sends, then lets its window pass. */
      const sent = Queue.take(overviews).pipe(
        Effect.andThen(TestClock.adjust(Duration.millis(MATE_OVERVIEW_EVERY_MS))),
      );
      // Settled: the whole overview went up.
      yield* sent;
      return { socket, crew, auth, update, providers, rows, sent, setupMarker };
    });
  const feedRig = feedRigOf(false);

  /** The sections of every overview frame after the first, whole. */
  const sectionsSent = (socket: FakeSocket) =>
    socket.sent
      .filter((frame) => frame.type === "overview")
      .slice(1)
      .map((frame) => frame["sections"]);

  it.effect("relays a ready agent without a sign-in when its provider snapshot changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { socket, providers, sent } = yield* feedRig;
        const provider: ServerProvider = {
          driver: ProviderDriverKind.make("cursor"),
          instanceId: ProviderInstanceId.make("cursor"),
          enabled: true,
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
          version: "1.0.0",
          checkedAt: "2026-10-04T10:00:00.000Z",
          models: [{ slug: "cursor-model", name: "Cursor", isCustom: false, capabilities: null }],
          slashCommands: [],
          skills: [],
        };
        yield* SubscriptionRef.set(providers, [provider]);
        yield* sent;
        const overview = yield* decodeMateLinkUp(socket.sent.at(-1));
        assert.isTrue(
          overview.type === "overview" &&
            !overview.full &&
            overview.sections.identity?.runsWithoutSignIn === true,
        );
      }),
    ),
  );

  it.effect(
    "The overview's identity carries the setup marker the Mate reads of its own service, as it stands at each look",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { socket, update, setupMarker, sent } = yield* feedRig;
          const first = yield* decodeMateLinkUp(socket.sent[1]);
          assert.isTrue(
            first.type === "overview" && first.full && first.overview.identity.setupMarker === true,
          );
          // The press's variable gone: the next look at the overview says so.
          yield* Ref.set(setupMarker, false);
          yield* SubscriptionRef.set(update, {
            installed: "0.11.90",
            latest: "0.11.91",
            available: true,
            checkedAt: "2026-10-03T10:00:00Z",
          });
          yield* sent;
          const next = yield* decodeMateLinkUp(socket.sent.at(-1));
          assert.isTrue(
            next.type === "overview" && !next.full && next.sections.identity?.setupMarker === false,
          );
        }),
      ),
  );

  it.effect(
    "A Mate whose coding agent runs on a verified environment token counts as signed in",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { socket, auth, sent } = yield* feedRig;
          const token = { ...CLAUDE, credPresent: false, flagOAuth: false, flagToken: true };
          // What HQ holds: the full overview, then each identity section sent since.
          const runsWithoutSignIn = Effect.map(
            Effect.forEach(socket.sent, (frame) => decodeMateLinkUp(frame)),
            (frames) =>
              frames
                .map((frame) =>
                  frame.type !== "overview"
                    ? undefined
                    : frame.full
                      ? frame.overview.identity.runsWithoutSignIn
                      : frame.sections.identity?.runsWithoutSignIn,
                )
                .findLast((value) => value !== undefined),
          );
          // Set, but its agent's own check has not confirmed it: nothing to count yet.
          yield* SubscriptionRef.set(auth, {
            available: true,
            agents: [{ ...token, providerAuth: "unknown", state: "authorized-token" }],
          });
          yield* sent;
          assert.strictEqual(yield* runsWithoutSignIn, false);
          yield* SubscriptionRef.set(auth, {
            available: true,
            agents: [{ ...token, state: "authorized-token" }],
          });
          yield* sent;
          assert.strictEqual(yield* runsWithoutSignIn, true);
        }),
      ),
  );

  it.effect("sends an engine Mate's rows as their own section, and a V1 Mate's never", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const v1 = yield* feedRig;
        const first = yield* decodeMateLinkUp(v1.socket.sent[1]);
        assert.isTrue(
          first.type === "overview" &&
            first.full &&
            first.overview.conversations === undefined &&
            first.overview.identity.engine === undefined,
        );

        const engine = yield* feedRigOf(true);
        const opened = yield* decodeMateLinkUp(engine.socket.sent[1]);
        assert.isTrue(
          opened.type === "overview" &&
            opened.full &&
            opened.overview.identity.engine?.protocol === 1 &&
            opened.overview.conversations?.length === 0,
        );
        const working = decodeRow({
          conversationId: "c1",
          agent: null,
          revision: { environmentId: "env-1", epoch: 1, seq: 2 },
          state: { kind: "working", since: 1, waitsOnHelpers: false },
          activeRunId: "c1/r/1",
          latestRun: { id: "c1/r/1", end: null, endedAt: null },
          subject: "Ship the release",
          snippet: null,
          at: 1,
          askedAt: null,
        });
        yield* SubscriptionRef.set(engine.rows, [working]);
        yield* engine.sent;
        assert.deepStrictEqual(sectionsSent(engine.socket), [{ conversations: [working] }]);
      }),
    ),
  );

  it.effect("sends again when the crew's snapshot moves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { socket, crew, sent } = yield* feedRig;
        yield* SubscriptionRef.set(crew, APPLIED);
        yield* sent;
        assert.deepStrictEqual(sectionsSent(socket), [
          {
            crew: {
              status: "applied",
              crewmates: [],
              attention: [],
              readyTasks: [],
              personLands: true,
            },
          },
        ]);
      }),
    ),
  );

  it.effect("sends again when a login's signer changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { socket, auth, sent } = yield* feedRig;
        yield* SubscriptionRef.set(auth, {
          available: true,
          agents: [{ ...CLAUDE, authorizedBy: { subject: "user-ada" } }],
        });
        yield* sent;
        assert.deepStrictEqual(sectionsSent(socket), [
          { logins: { "claude-code": { signedInBy: "user-ada", present: true, token: false } } },
        ]);
      }),
    ),
  );

  it.effect("sends again when the Mate's update line changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { socket, update, sent } = yield* feedRig;
        const line: ExecutionEnvironmentUpdate = {
          installed: "0.11.90",
          latest: "0.11.91",
          available: true,
          checkedAt: "2026-10-03T10:00:00Z",
        };
        yield* SubscriptionRef.set(update, line);
        yield* sent;
        assert.deepStrictEqual(sectionsSent(socket), [
          {
            identity: {
              environmentId: "env-1",
              serverVersion: "0.11.90",
              update: line,
              setupMarker: true,
              runsWithoutSignIn: false,
            },
          },
        ]);
      }),
    ),
  );
});

it.effect("sends measured health even when the conversation overview cannot answer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const health = yield* decodeMateHealth({
        source: { environmentId: "env-1", epoch: 1, incarnation: "run", revision: 1 },
        sampledAt: "2026-10-07T12:00:00Z",
        evidence: {
          status: "strained",
          severity: "critical",
          resources: ["memory"],
          memory: {
            scope: "/sys/fs/cgroup",
            current: 2 * 1024 ** 3,
            high: 1.375 * 1024 ** 3,
            max: 3.375 * 1024 ** 3,
            events: { high: 2514, max: 7, oom: 0, oomKill: 0 },
            growth: { high: 1, max: 1, oom: 0, oomKill: 0 },
            pressure: null,
            swapCurrent: 200 * 1024 ** 2,
            swapMax: 512 * 1024 ** 2,
            swapGrowth: 1024,
          },
          pids: null,
          io: null,
          disk: null,
          unavailable: [],
        },
      });
      const { connected } = yield* rig({
        overview: Effect.never,
        health: Stream.make(health),
      });
      const sent = yield* Queue.unbounded<Sent>();
      const socket = yield* Queue.take(connected);
      socket.onSent = (message) => {
        Queue.offerUnsafe(sent, message);
      };
      socket.emit("open");
      assert.deepStrictEqual(yield* Queue.take(sent), hello("zk-1"));
      admit(socket);
      const message = yield* Queue.take(sent);
      assert.deepStrictEqual(message, { type: "health", health });
      yield* decodeMateLinkUp(message);
    }),
  ),
);
