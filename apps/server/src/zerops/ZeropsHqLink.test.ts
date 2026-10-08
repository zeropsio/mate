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
import { MateLinkUp, type MateOverview, type MateState } from "@t3tools/shared/mateLink";
import * as Deferred from "effect/Deferred";
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
import { HttpClient, HttpClientResponse } from "effect/http";

import { CREW_OFF_SNAPSHOT } from "./crew/crewSnapshot.ts";
import { makeMateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";
import {
  type HqEnrollment,
  type HqOutcome,
  type LinkSocket,
  HQ_LINK_ADDRESS_ORDER,
  makeZeropsHqLink,
  MATE_LINK_ROTATE_MS,
  HQ_AUTO_UPDATE_VERIFY_BUDGET,
  mateOverviewFeed,
  preferringIpv6,
  type OverviewSources,
} from "./ZeropsHqLink.ts";

const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeHeard = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeMateLinkUp = Schema.decodeUnknownEffect(MateLinkUp);
const decodeRow = Schema.decodeUnknownSync(ConversationRow);
const decodeMateHealth = Schema.decodeUnknownEffect(MateHealth);

type Sent = { readonly type: string } & Readonly<Record<string, unknown>>;

class FakeSocket implements LinkSocket {
  readonly url: string;
  readonly sent: Array<Sent> = [];
  readonly listeners = new Map<string, Array<(event: { readonly data: unknown }) => void>>();
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
  addEventListener(type: string, listener: (event: { readonly data: unknown }) => void) {
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
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
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

/** A Mate in no application, with no changes yet. */
const STATE: MateState = {
  projectId: "P_MATE",
  name: "Ada",
  face: "face-1",
  standupRequestedBy: "owner",
  closedOff: true,
  appId: null,
  appName: null,
  changes: [],
};

/**
 * A link over a fake HQ: tickets for `cred` while `refusing` is off, a socket per connect. It sends
 * at most every `everyMs` (10 ms unless said: the link's own pace is for the clock's tests).
 */
const rig = (
  options: {
    readonly enrolled?: boolean;
    readonly everyMs?: number;
    /** The attention the link sends up; nothing unless a test says. */
    readonly attention?: Stream.Stream<MateAttention>;
    readonly health?: Stream.Stream<MateHealth>;
    readonly overview?: Effect.Effect<Option.Option<MateOverview>>;
    readonly reconnectDelaysMs?: ReadonlyArray<number>;
  } = {},
) =>
  Effect.gen(function* () {
    const enrollment = yield* Ref.make<Option.Option<HqEnrollment>>(
      options.enrolled === true
        ? Option.some({ hq: "https://hq.test", credential: "cred" })
        : Option.none(),
    );
    const outcome = yield* Ref.make<Option.Option<HqOutcome>>(Option.none());
    const current = yield* Ref.make(overview("Add a login page"));
    /** How often the link read the overview. */
    const reads = { count: 0 };
    const changes = yield* PubSub.unbounded<void>();
    const sockets: Array<FakeSocket> = [];
    const connected = yield* Queue.unbounded<FakeSocket>();
    const asked: Array<string | undefined> = [];
    const hq = { refusing: false, tickets: 0 };
    /** What HQ relayed of the project's access, as the link handed it on. */
    const relayed: Array<unknown> = [];
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        asked.push(request.headers.authorization);
        const ok =
          !hq.refusing &&
          request.url === "https://hq.test/api/mate/link-ticket" &&
          request.headers.authorization === "Mate cred";
        hq.tickets += ok ? 1 : 0;
        return HttpClientResponse.fromWeb(
          request,
          ok
            ? Response.json({ ticket: `t${String(hq.tickets)}`, expiresIn: 60 })
            : Response.json({ code: "mate_credential_required" }, { status: 401 }),
        );
      }),
    );
    const autoUpdatePolicy = yield* makeMateAutoUpdatePolicy;
    const enrollmentRead = yield* Deferred.make<void>();
    let readBefore = false;
    const link = yield* makeZeropsHqLink({
      autoUpdatePolicy,
      // Pulling again acknowledges that the previous enrollment decision finished.
      readEnrollment: Effect.suspend(() => {
        if (readBefore) Deferred.doneUnsafe(enrollmentRead, Effect.void);
        readBefore = true;
        return Ref.get(enrollment);
      }),
      readOutcome: Ref.get(outcome),
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
      relayAccess: (access) =>
        Effect.sync(() => {
          relayed.push(access);
        }),
      reconnectDelaysMs: options.reconnectDelaysMs ?? [20],
      ...(options.everyMs === undefined ? {} : { overviewEveryMs: options.everyMs }),
    }).pipe(Effect.provideService(HttpClient.HttpClient, http));
    /** Waits until `found` answers. */
    const until = <A>(found: () => A | undefined) =>
      Effect.suspend(() => {
        const value = found();
        return value === undefined ? Effect.fail("not yet") : Effect.succeed(value);
      }).pipe(
        Effect.retry(Schedule.spaced(Duration.millis(5))),
        Effect.timeout(Duration.seconds(3)),
        Effect.orDie,
      );
    return {
      autoUpdatePolicy,
      link,
      enrollment,
      outcome,
      current,
      changes,
      sockets,
      connected,
      asked,
      hq,
      until,
      enrollmentRead: Deferred.await(enrollmentRead),
      reads,
      relayed,
    };
  });

describe("ZeropsHqLink", () => {
  it.live(
    "checks the current org policy with a fresh correlated reply before granting update permission",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { autoUpdatePolicy, connected } = yield* rig({ enrolled: true });
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
          const { autoUpdatePolicy, connected } = yield* rig({ enrolled: true });
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
          const { autoUpdatePolicy, connected } = yield* rig({ enrolled: true });
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
  it.live(
    "waits for an enrollment, links with a ticket for its credential, sends its overview, answers pings and keeps HQ's state",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { link, enrollment, sockets, until, enrollmentRead } = yield* rig({ everyMs: 10 });
          yield* enrollmentRead.pipe(Effect.timeout("5 seconds"), Effect.orDie);
          assert.strictEqual(sockets.length, 0);
          yield* Ref.set(enrollment, Option.some({ hq: "https://hq.test", credential: "cred" }));
          const socket = yield* until(() => sockets[0]);
          assert.strictEqual(socket.url, "wss://hq.test/api/mate/link?ticket=t1");
          socket.emit("open");
          const first = yield* until(() => socket.sent[0]);
          assert.deepStrictEqual(first, {
            type: "overview",
            full: true,
            overview: overview("Add a login page"),
          });
          socket.hear({ type: "ping" });
          yield* until(() => socket.sent.find((message) => message.type === "pong"));
          assert.deepStrictEqual(yield* link.standing, { kind: "not-linked" });
          socket.hear({ type: "state", mate: STATE });
          const held = yield* link.standing.pipe(
            Effect.flatMap((standing) =>
              standing.kind === "linked" ? Effect.succeed(standing.mate) : Effect.fail("not yet"),
            ),
            Effect.retry(Schedule.spaced(Duration.millis(5))),
            Effect.timeout(Duration.seconds(3)),
          );
          assert.deepStrictEqual(held, STATE);
        }),
      ),
  );

  // R6: HQ relays who the project lets in, and how old its read of Zerops is; the link hands it
  // on as it lands (`ZeropsProjectAccess`).
  it.live("hands on the access HQ relays, with its age", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { enrollment, sockets, until, relayed } = yield* rig({ everyMs: 10 });
        yield* Ref.set(enrollment, Option.some({ hq: "https://hq.test", credential: "cred" }));
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const members = [{ userId: "owner", role: "OWNER", visibility: "open" }];
        socket.hear({ type: "access", ageMs: 1_500, members });
        assert.deepStrictEqual(yield* until(() => relayed[0]), { members, ageMs: 1_500 });
      }),
    ),
  );

  // HQ's state carries the application the Mate is in and its changes there: kept whole, as sent.
  it.live("keeps HQ's state with the application and the changes it carries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, enrollment, sockets, until } = yield* rig({ everyMs: 10 });
        yield* Ref.set(enrollment, Option.some({ hq: "https://hq.test", credential: "cred" }));
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const placed: MateState = {
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
          Effect.timeout(Duration.seconds(3)),
        );
        assert.deepStrictEqual(held, placed);
      }),
    ),
  );

  // An HQ older than the application's name sends none: the state is kept, naming none.
  it.live("keeps an older HQ's state, its application named by none", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, enrollment, sockets, until } = yield* rig({ everyMs: 10 });
        yield* Ref.set(enrollment, Option.some({ hq: "https://hq.test", credential: "cred" }));
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const { appName: _appName, ...older } = { ...STATE, appId: "app-1" };
        socket.hear({ type: "state", mate: older });
        const held = yield* link.standing.pipe(
          Effect.flatMap((standing) =>
            standing.kind === "linked" ? Effect.succeed(standing.mate) : Effect.fail("not yet"),
          ),
          Effect.retry(Schedule.spaced(Duration.millis(5))),
          Effect.timeout(Duration.seconds(3)),
        );
        assert.deepStrictEqual(held, { ...older, appName: null });
      }),
    ),
  );

  // Until zcp enrolls, the Mate says why it is not linked as far as zcp said: its last word on
  // the enrollment, beside it — none from a zcp that says nothing.
  it.live("says why it is not linked yet, as zcp's last word on its enrollment has it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, outcome } = yield* rig({ everyMs: 10 });
        assert.deepStrictEqual(yield* link.standing, {
          kind: "not-enrolled",
          outcome: Option.none(),
        });
        const refused: HqOutcome = { state: "refused", code: "not_a_mate" };
        yield* Ref.set(outcome, Option.some(refused));
        assert.deepStrictEqual(yield* link.standing, {
          kind: "not-enrolled",
          outcome: Option.some(refused),
        });
      }),
    ),
  );

  it.live("links again after the link closes, with a new ticket, and after a refused one", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { enrollment, sockets, hq, asked, until } = yield* rig({ everyMs: 10 });
        hq.refusing = true;
        yield* Ref.set(enrollment, Option.some({ hq: "https://hq.test", credential: "cred" }));
        // A credential HQ refuses (revoked: zcp enrolls again) opens no socket; it is asked again.
        yield* until(() => (asked.length >= 2 ? true : undefined));
        assert.strictEqual(sockets.length, 0);
        hq.refusing = false;
        const first = yield* until(() => sockets[0]);
        first.emit("open");
        first.emit("close");
        const second = yield* until(() => sockets[1]);
        assert.strictEqual(second.url, "wss://hq.test/api/mate/link?ticket=t2");
      }),
    ),
  );

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

  it.effect("waits longer each time a link closes right after it opened", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig({ enrolled: true, reconnectDelaysMs: [100, 1_000, 10_000] });
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
        const { sockets } = yield* rig({ enrolled: true });
        const first = yield* opened(sockets, 0);
        assert.deepStrictEqual(first.sent, [
          { type: "overview", full: true, overview: overview("Add a login page") },
        ]);
        first.emit("close");
        // The next link waits out its backoff (at most 20 ms and a quarter more), then opens.
        yield* TestClock.adjust(Duration.millis(30));
        const second = yield* opened(sockets, 1);
        assert.deepStrictEqual(second.sent, [
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
          enrolled: true,
          attention: SubscriptionRef.changes(attention),
        });
        const attentionSent = (socket: FakeSocket) =>
          socket.sent.filter((frame) => frame.type === "attention");
        const first = yield* opened(sockets, 0);
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
        const second = yield* opened(sockets, 1);
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
          enrolled: true,
          attention: Stream.suspend(() => {
            subscriptions += 1;
            return subscriptions === 1 ? Stream.die("the attention could not start") : Stream.never;
          }),
        });
        yield* opened(sockets, 0);
        yield* TestClock.adjust(Duration.millis(30));
        const second = yield* opened(sockets, 1);
        assert.isTrue(second.sent.some((frame) => frame.type === "overview"));
      }),
    ),
  );

  it.effect("sends only the sections that changed, at most once per 500 ms", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, current, changes } = yield* rig({ enrolled: true });
        const socket = yield* opened(sockets, 0);
        // Two changes inside one 500 ms: the second is the one sent, in one frame.
        yield* TestClock.adjust(Duration.millis(100));
        yield* Ref.set(current, overview("Add a sign-up page"));
        yield* PubSub.publish(changes, undefined);
        yield* TestClock.adjust(Duration.millis(200));
        yield* Ref.set(current, overview("Add a password reset"));
        yield* PubSub.publish(changes, undefined);
        yield* TestClock.adjust(Duration.millis(199));
        assert.strictEqual(socket.sent.length, 1);
        yield* TestClock.adjust(Duration.millis(1));
        assert.deepStrictEqual(socket.sent.slice(1), [
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
        const { sockets, relayed } = yield* rig({ enrolled: true });
        const first = yield* opened(sockets, 0);
        yield* TestClock.adjust(Duration.millis(MATE_LINK_ROTATE_MS - 1));
        assert.strictEqual(sockets.length, 1);
        yield* TestClock.adjust(Duration.millis(1));
        const successor = yield* opened(sockets, 1);
        assert.strictEqual(successor.url, "wss://hq.test/api/mate/link?ticket=t2");
        assert.deepStrictEqual(successor.sent, [
          { type: "overview", full: true, overview: overview("Add a login page") },
        ]);
        // Until HQ answers on it, the old link stays and still answers HQ.
        first.hear({ type: "ping" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(first.sent.at(-1), { type: "pong" });
        assert.isFalse(first.closed);

        successor.hear({ type: "state", mate: STATE });
        yield* TestClock.adjust(Duration.zero);
        assert.isTrue(first.closed);
        assert.isFalse(successor.closed);
        successor.hear({ type: "ping" });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(successor.sent.at(-1), { type: "pong" });
        // It hands on the access HQ relays, as the old link did (R6).
        const members = [{ userId: "owner", role: "OWNER", visibility: "open" }];
        successor.hear({ type: "access", ageMs: 500, members });
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(relayed, [{ members, ageMs: 500 }]);

        // The successor rotates in its turn, counted from its own opening.
        yield* TestClock.adjust(Duration.millis(MATE_LINK_ROTATE_MS));
        yield* opened(sockets, 2);
        assert.strictEqual(sockets.length, 3);
      }),
    ),
  );

  // Only the shared IPv4 is cut at 120 s: a link that went over IPv6 is kept as it is.
  it.effect("never rotates a link that went over IPv6", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets } = yield* rig({ enrolled: true });
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
          const { sockets } = yield* rig({ enrolled: true });
          const first = yield* opened(sockets, 0);
          yield* TestClock.adjust(Duration.millis(MATE_LINK_ROTATE_MS));
          const successor = yield* opened(sockets, 1);
          yield* TestClock.adjust(Duration.seconds(19));
          assert.isFalse(first.closed);

          // The L7's cut: the old link closes, the successor that never answered goes with it.
          first.emit("close");
          yield* TestClock.adjust(Duration.zero);
          assert.isTrue(successor.closed);
          yield* TestClock.adjust(Duration.millis(30));
          const next = yield* opened(sockets, 2);
          assert.deepStrictEqual(next.sent, [
            { type: "overview", full: true, overview: overview("Add a login page") },
          ]);
        }),
      ),
  );

  it.effect("sends nothing on a quiet link", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, changes, reads } = yield* rig({ enrolled: true });
        const socket = yield* opened(sockets, 0);
        // A change heard that changed nothing sends nothing either.
        yield* PubSub.publish(changes, undefined);
        yield* TestClock.adjust(Duration.seconds(1));
        const read = reads.count;
        // Nothing heard, nothing read: no timer looks at the overview again.
        yield* TestClock.adjust(Duration.minutes(2));
        assert.strictEqual(socket.sent.length, 1);
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
      const http = HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ ticket: "t1" }))),
      );
      yield* makeZeropsHqLink({
        readEnrollment: Effect.succeed(Option.some({ hq: "https://hq.test", credential: "cred" })),
        readOutcome: Effect.succeed(Option.none()),
        connect: (url) => {
          const socket = new FakeSocket(url);
          sockets.push(socket);
          Queue.offerUnsafe(connected, socket);
          return socket;
        },
        relayAccess: () => Effect.void,
        attention: Stream.never,
        ...feed,
      }).pipe(Effect.provideService(HttpClient.HttpClient, http));
      yield* TestClock.adjust(Duration.zero);
      const socket = sockets[0];
      if (socket === undefined) return yield* Effect.die("no socket");
      socket.emit("open");
      // Settled: whatever the feeds said as the link subscribed has been looked at, and was sent.
      yield* TestClock.adjust(Duration.seconds(1));
      return { socket, crew, auth, update, providers, rows };
    });
  const feedRig = feedRigOf(false);

  /** The sections of every frame after the first, whole. */
  const sectionsSent = (socket: FakeSocket) =>
    socket.sent.slice(1).map((frame) => frame["sections"]);

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

  it.effect("sends an engine Mate's rows as their own section, and a V1 Mate's never", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const v1 = yield* feedRig;
        const first = yield* decodeMateLinkUp(v1.socket.sent[0]);
        assert.isTrue(
          first.type === "overview" &&
            first.full &&
            first.overview.conversations === undefined &&
            first.overview.identity.engine === undefined,
        );

        const engine = yield* feedRigOf(true);
        const opened = yield* decodeMateLinkUp(engine.socket.sent[0]);
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
          cpu: null,
          io: null,
          disk: null,
          unavailable: [],
        },
      });
      const { connected } = yield* rig({
        enrolled: true,
        overview: Effect.never,
        health: Stream.make(health),
      });
      const sent = yield* Queue.unbounded<Sent>();
      const socket = yield* Queue.take(connected);
      socket.onSent = (message) => {
        Queue.offerUnsafe(sent, message);
      };
      socket.emit("open");
      const message = yield* Queue.take(sent);
      assert.deepStrictEqual(message, { type: "health", health });
      yield* decodeMateLinkUp(message);
    }),
  ),
);
