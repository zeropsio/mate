import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
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
import { KeyLinkUp, type LinkedMate, type MateOverview } from "@t3tools/shared/mateLink";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
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
import { CREW_OFF_SNAPSHOT } from "./crew/crewSnapshot.ts";
import { makeMateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";
import {
  type LinkSocket,
  HQ_LINK_ADDRESS_ORDER,
  makeZeropsHqLink,
  MATE_LINK_ROTATE_MS,
  HQ_AUTO_UPDATE_VERIFY_BUDGET,
  mateOverviewFeed,
  preferringIpv6,
  readsAlongOnly,
  type OverviewSources,
} from "./ZeropsHqLink.ts";

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
  /** The address family it went over; unknown unless a test says. */
  over: "IPv4" | "IPv6" | undefined = undefined;
  family() {
    return this.over;
  }
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
  closedOff: true,
  signers: {},
  appId: null,
  appName: null,
  changes: [],
  chief: null,
};

/** The hello a link opens with: the project's key, the service it is labelled by, and the Mate's public origin. */
const hello = (key: string) => ({
  type: "hello",
  key,
  serviceId: "svc-mate",
  origin: "https://mate-1234.prg1.zerops.app",
});

/** HQ admits the key: its first state on the link. */
const admit = (socket: FakeSocket, mate: LinkedMate = STATE) =>
  socket.hear({ type: "state", mate });

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
  } = {},
) =>
  Effect.gen(function* () {
    const key = yield* Ref.make<string | undefined>(options.keyless === true ? undefined : "zk-1");
    const current = yield* Ref.make(overview("Add a login page"));
    /** How often the link read the overview. */
    const reads = { count: 0 };
    const changes = yield* PubSub.unbounded<void>();
    const sockets: Array<FakeSocket> = [];
    const connected = yield* Queue.unbounded<FakeSocket>();
    /** The access frames HQ sent, as the link handed them on. */
    const relayed: Array<unknown> = [];
    /** The Git credentials HQ sent, as the link handed them on. */
    const credentials: Array<string | null> = [];
    /** The Chief mark's project of each state HQ sent, as the link handed it on. */
    const chiefs: Array<string | null> = [];
    /** What the link handed `ZeropsAutomation`: HQ's word on the Mate, and its keys. */
    const automation: Array<unknown> = [];
    /** The tasks the link handed on; each is answered `accepted`, and the latest is `task-0`. */
    const taken: Array<string> = [];
    const autoUpdatePolicy = yield* makeMateAutoUpdatePolicy;
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
      access: (frame) => Effect.sync(() => void relayed.push(frame)),
      gitCredential: (credential) => Effect.sync(() => void credentials.push(credential)),
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
      current,
      changes,
      sockets,
      connected,
      until,
      reads,
      relayed,
      credentials,
      chiefs,
      automation,
      taken,
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

describe("ZeropsHqLink", () => {
  it.live(
    "checks the current org policy with a fresh correlated reply before granting update permission",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { autoUpdatePolicy, connected } = yield* rig();
          const socket = yield* Queue.take(connected);
          socket.over = "IPv6";
          socket.emit("open");
          socket.hear({
            type: "state",
            mate: STATE,
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
    "a silent HQ withholds permission at the verification deadline instead of reusing its old allow",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { autoUpdatePolicy, connected } = yield* rig();
          const socket = yield* Queue.take(connected);
          socket.over = "IPv6";
          socket.emit("open");
          socket.hear({
            type: "state",
            mate: STATE,
            autoUpdate: { orgId: "ORG", enabled: true, revision: 0 },
          });
          yield* Stream.runHead(autoUpdatePolicy.changes.pipe(Stream.filter(Option.isSome)));
          const verification = yield* Effect.forkScoped(autoUpdatePolicy.verify);
          yield* TestClock.adjust(HQ_AUTO_UPDATE_VERIFY_BUDGET);
          assert.isTrue(Option.isNone(yield* Fiber.join(verification)));
          assert.isTrue(Option.isNone(yield* autoUpdatePolicy.current));
        }),
      ),
  );
  it.live(
    "requires HQ's policy on a live authenticated link and clears it when that link closes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { autoUpdatePolicy, connected } = yield* rig();
          const socket = yield* Queue.take(connected);
          socket.over = "IPv6";
          socket.emit("open");
          const value = { orgId: "ORG", enabled: true, revision: 0 };
          socket.hear({ type: "state", mate: STATE, autoUpdate: value });
          const policy = yield* Stream.runHead(
            autoUpdatePolicy.changes.pipe(Stream.filter(Option.isSome)),
          );
          assert.deepStrictEqual(policy, Option.some(Option.some(value)));
          socket.emit("close");
          yield* Stream.runHead(autoUpdatePolicy.changes.pipe(Stream.filter(Option.isNone)));
          assert.isTrue(Option.isNone(yield* autoUpdatePolicy.current));
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

  // HQ sends who the project opens for and lists, and the time of the view it read; the link hands
  // each frame on as it lands (`ZeropsMateAccessList`), the refused one too.
  it.effect("hands on the access HQ relays, with its age", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, relayed } = yield* rig();
        const socket = yield* linked(sockets, 0);
        const members = [{ userId: "owner", role: "OWNER", visibility: "open" }];
        const snapshot = {
          type: "access",
          version: 1,
          viewAt: "2026-10-24T10:00:00.000Z",
          full: true,
          members,
        };
        const refused = { type: "access", version: 2, full: true, refused: true, members: [] };
        socket.hear(snapshot);
        socket.hear(refused);
        // An access frame naming a visibility HQ does not send is no frame.
        socket.hear({ ...snapshot, members: [{ ...members[0], visibility: "hidden" }] });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(relayed, [snapshot, refused]);
      }),
    ),
  );

  it.effect(
    "TC-6 and TC-8 the HQ link holds tickets before acknowledging and forwards sign-out to live connections",
    () =>
      Effect.gen(function* () {
        const access = yield* Access.make;
        const tickets = yield* Tickets.make;
        const connections = yield* Connections.make.pipe(
          Effect.provideService(Access.ZeropsMateAccessList, access),
          Effect.provideService(Tickets.ZeropsTicketDoor, tickets),
          Effect.provide(NodeCrypto.layer),
        );
        const sockets: Array<FakeSocket> = [];
        const pongs = yield* Queue.unbounded<void>();
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
            socket.over = "IPv6";
            socket.onSent = (message) => {
              if (message.type === "ticket-ack") heldAtAcknowledgement.push(ticketHeld);
              if (message.type === "pong") Queue.offerUnsafe(pongs, undefined);
            };
            sockets.push(socket);
            return socket;
          },
          overview: Effect.succeed(Option.none()),
          changes: Stream.never,
          attention: Stream.never,
          access: connections.heard,
          ticket: (frame) =>
            tickets.heard(frame).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  ticketHeld = true;
                }),
              ),
            ),
          closeSession: connections.closeSession,
          gitCredential: () => Effect.void,
        });
        const socket = yield* linked(sockets, 0);
        socket.hear({
          type: "access",
          version: 1,
          full: true,
          viewAt: "2026-10-24T10:00:00.000Z",
          members: [{ userId: "jan", role: "OWNER", visibility: "open" }],
        });
        socket.hear({
          type: "ticket",
          ticket: "browser-ticket",
          userId: "jan",
          sessionId: "hq-session",
          expiresIn: 60,
        });
        socket.hear({ type: "ping" });
        yield* Queue.take(pongs);
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

  // HQ's state carries the application the Mate is in and its changes there: kept whole, as sent.
  it.live("hands on HQ's word that the Mate is automated, and the organization's keys", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, until, automation } = yield* rig({ everyMs: 10 });
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const automated: LinkedMate = { ...STATE, automated: true };
        socket.hear({ type: "state", mate: automated });
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
        };
        // Told before HQ's state, it is held until the Mate knows whether it is automated.
        socket.hear({ type: "task", task });
        // HQ's frames are heard in order: once the ping is answered, the task was heard.
        socket.hear({ type: "ping" });
        yield* until(() => socket.sent.find((message) => message.type === "pong"));
        assert.deepStrictEqual(taken, []);
        assert.isFalse(socket.sent.some((message) => message.type === "task-state"));
        socket.hear({ type: "state", mate: { ...STATE, automated: true } });
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
        socket.hear({ type: "state", mate: { ...STATE, automated: true } });
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
        socket.hear({ type: "state", mate: STATE });
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
          },
        });
        yield* until(() => (taken.length > 0 ? taken : undefined));
        socket.hear({ type: "ping" });
        yield* until(() => socket.sent.find((message) => message.type === "pong"));
        assert.isFalse(socket.sent.some((message) => message.type === "task-state"));
      }),
    ),
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
        socket.hear({ type: "state", mate: placed });
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
        socket.hear({ type: "state", mate: older });
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
        assert.isFalse(readsAlongOnly(yield* link.standing, "zerops-user:colleague"));
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
        socket.hear({ type: "state", mate: { ...STATE, ownerUserId: "owner-1" } });
        const named = yield* ownerNamed("owner-1");
        assert.deepStrictEqual(
          ["zerops-user:colleague", "zerops-user:owner-1", "local-owner"].map((subject) =>
            readsAlongOnly(named, subject),
          ),
          [true, false, false],
        );
        // HQ that knows no owner names none.
        socket.hear({ type: "state", mate: STATE });
        assert.isFalse(readsAlongOnly(yield* ownerNamed(undefined), "zerops-user:colleague"));
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
        yield* TestClock.adjust(Duration.millis(30));
        const second = yield* opened(sockets, 1);
        second.closeWith(4401, "key_refused");
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(yield* link.standing, {
          kind: "not-linked",
          refusal: "key_refused",
        });
        // A close that names no refusal leaves the last one standing; HQ's state clears it.
        yield* TestClock.adjust(Duration.millis(60));
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

  it.effect("sends only the sections that changed, at most once per 500 ms", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, current, changes } = yield* rig();
        const socket = yield* linked(sockets, 0);
        // Two changes inside one 500 ms: the second is the one sent, in one frame.
        yield* TestClock.adjust(Duration.millis(100));
        yield* Ref.set(current, overview("Add a sign-up page"));
        yield* PubSub.publish(changes, undefined);
        yield* TestClock.adjust(Duration.millis(200));
        yield* Ref.set(current, overview("Add a password reset"));
        yield* PubSub.publish(changes, undefined);
        yield* TestClock.adjust(Duration.millis(199));
        assert.strictEqual(socket.sent.length, 2);
        yield* TestClock.adjust(Duration.millis(1));
        assert.deepStrictEqual(socket.sent.slice(2), [
          {
            type: "overview",
            full: false,
            sections: { threads: overview("Add a password reset").threads },
          },
        ]);
      }),
    ),
  );

  // F26: the Zerops L7 cuts every link at 120 s. A Mate opens its successor before that, and lets
  // the old link go only once HQ answered on the new one: HQ never sees it without a link.
  it.effect("rotates to a successor before the cut, and closes the old link once HQ answered", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, relayed } = yield* rig();
        const first = yield* linked(sockets, 0);
        yield* TestClock.adjust(Duration.millis(MATE_LINK_ROTATE_MS - 1));
        assert.strictEqual(sockets.length, 1);
        yield* TestClock.adjust(Duration.millis(1));
        const successor = yield* opened(sockets, 1);
        assert.deepStrictEqual(successor.sent, [hello("zk-1")]);
        // Until HQ answers on it, the old link stays and still answers HQ.
        first.hear({ type: "ping" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(first.sent.at(-1), { type: "pong" });
        assert.isFalse(first.closed);

        admit(successor);
        yield* TestClock.adjust(Duration.zero);
        assert.isTrue(first.closed);
        assert.isFalse(successor.closed);
        assert.deepStrictEqual(successor.sent.slice(1), [
          { type: "overview", full: true, overview: overview("Add a login page") },
        ]);
        successor.hear({ type: "ping" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(successor.sent.at(-1), { type: "pong" });
        // It hands on the access HQ sends, as the old link did.
        const access = {
          type: "access",
          version: 1,
          viewAt: "2026-10-24T10:00:00.000Z",
          full: true,
          members: [],
        };
        successor.hear(access);
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(relayed, [access]);

        // The successor rotates in its turn, counted from its own opening.
        yield* TestClock.adjust(Duration.millis(MATE_LINK_ROTATE_MS));
        yield* opened(sockets, 2);
        assert.strictEqual(sockets.length, 3);
      }),
    ),
  );

  // HQ admits the successor's key and closes the old link 4409 before it sends its state on the new.
  it.effect(
    "waits on its successor when HQ supersedes the old link on admitting it, and links nothing anew",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { sockets, link } = yield* rig();
          const first = yield* linked(sockets, 0);
          yield* TestClock.adjust(Duration.millis(MATE_LINK_ROTATE_MS));
          const successor = yield* opened(sockets, 1);
          first.closeWith(4409);
          yield* TestClock.adjust(Duration.seconds(1));
          assert.isFalse(successor.closed);
          assert.lengthOf(sockets, 2);
          admit(successor, { ...STATE, name: "Ada II" });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(successor.sent.slice(1), [
            { type: "overview", full: true, overview: overview("Add a login page") },
          ]);
          const standing = yield* link.standing;
          assert.isTrue(standing.kind === "linked" && standing.mate.name === "Ada II");
          // The successor is the link now, rotating in its turn.
          yield* TestClock.adjust(Duration.millis(MATE_LINK_ROTATE_MS));
          assert.lengthOf(sockets, 3);
          assert.isFalse(successor.closed);
        }),
      ),
  );

  // Only the shared IPv4 is cut at 120 s: a link that went over IPv6 is kept as it is.
  it.effect("never rotates a link that went over IPv6", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig();
        yield* TestClock.adjust(Duration.zero);
        sockets[0]!.over = "IPv6";
        const first = yield* opened(sockets, 0);
        yield* TestClock.adjust(Duration.millis(3 * MATE_LINK_ROTATE_MS));
        assert.strictEqual(sockets.length, 1);
        assert.isFalse(first.closed);
      }),
    ),
  );

  it.effect(
    "keeps the old link when its successor never answers, and links again as ever once it closes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { sockets } = yield* rig();
          const first = yield* linked(sockets, 0);
          yield* TestClock.adjust(Duration.millis(MATE_LINK_ROTATE_MS));
          const successor = yield* opened(sockets, 1);
          yield* TestClock.adjust(Duration.seconds(19));
          assert.isFalse(first.closed);

          // The L7's cut: the old link closes, the successor that never answered goes with it.
          first.emit("close");
          yield* TestClock.adjust(Duration.zero);
          assert.isTrue(successor.closed);
          yield* TestClock.adjust(Duration.millis(30));
          const next = yield* linked(sockets, 2);
          assert.deepStrictEqual(next.sent, [
            hello("zk-1"),
            { type: "overview", full: true, overview: overview("Add a login page") },
          ]);
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

// The 120 s cut is the shared IPv4's: a WebSocket over the project's IPv6 holds (verified.md,
// 2026-10-03). A Mate container has IPv6, so its link asks for HQ's addresses IPv6 first.
describe("ZeropsHqLink's addresses", () => {
  it("resolves HQ IPv6 first, whatever else the connection asks", () => {
    const asked: Array<unknown> = [];
    const lookup = preferringIpv6((hostname, options, callback) => {
      asked.push({ hostname, options });
      callback(null, [{ address: "2001:db8::1", family: 6 }]);
    });
    let answered: unknown;
    lookup("hq.example", { all: true, hints: 0 }, (_error, addresses) => {
      answered = addresses;
    });
    assert.strictEqual(HQ_LINK_ADDRESS_ORDER, "ipv6first");
    assert.deepStrictEqual(asked, [
      { hostname: "hq.example", options: { all: true, hints: 0, order: "ipv6first" } },
    ]);
    assert.deepStrictEqual(answered, [{ address: "2001:db8::1", family: 6 }]);
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
      const feed = yield* mateOverviewFeed({
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
        access: () => Effect.void,
        gitCredential: () => Effect.void,
        attention: Stream.never,
        ...feed,
      });
      yield* TestClock.adjust(Duration.zero);
      const socket = sockets[0];
      if (socket === undefined) return yield* Effect.die("no socket");
      socket.emit("open");
      admit(socket);
      // Settled: whatever the feeds said as the link subscribed has been looked at, and was sent.
      yield* TestClock.adjust(Duration.seconds(1));
      return { socket, crew, auth, update, providers, rows };
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
        const { socket, providers } = yield* feedRig;
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
        yield* TestClock.adjust(Duration.seconds(1));
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
    "A Mate whose coding agent runs on a verified environment token counts as signed in",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { socket, auth } = yield* feedRig;
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
          yield* TestClock.adjust(Duration.seconds(1));
          assert.strictEqual(yield* runsWithoutSignIn, false);
          yield* SubscriptionRef.set(auth, {
            available: true,
            agents: [{ ...token, state: "authorized-token" }],
          });
          yield* TestClock.adjust(Duration.seconds(1));
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
        yield* TestClock.adjust(Duration.seconds(1));
        assert.deepStrictEqual(sectionsSent(engine.socket), [{ conversations: [working] }]);
      }),
    ),
  );

  it.effect("sends again when the crew's snapshot moves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { socket, crew } = yield* feedRig;
        yield* SubscriptionRef.set(crew, APPLIED);
        yield* TestClock.adjust(Duration.seconds(1));
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
        const { socket, auth } = yield* feedRig;
        yield* SubscriptionRef.set(auth, {
          available: true,
          agents: [{ ...CLAUDE, authorizedBy: { subject: "user-ada" } }],
        });
        yield* TestClock.adjust(Duration.seconds(1));
        assert.deepStrictEqual(sectionsSent(socket), [
          { logins: { "claude-code": { signedInBy: "user-ada", present: true, token: false } } },
        ]);
      }),
    ),
  );

  it.effect("sends again when the Mate's update line changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { socket, update } = yield* feedRig;
        const line: ExecutionEnvironmentUpdate = {
          installed: "0.11.90",
          latest: "0.11.91",
          available: true,
          checkedAt: "2026-10-03T10:00:00Z",
        };
        yield* SubscriptionRef.set(update, line);
        yield* TestClock.adjust(Duration.seconds(1));
        assert.deepStrictEqual(sectionsSent(socket), [
          {
            identity: {
              environmentId: "env-1",
              serverVersion: "0.11.90",
              update: line,
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
