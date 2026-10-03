import { assert, describe, it } from "@effect/vitest";
import type {
  CrewSnapshot,
  ExecutionEnvironmentUpdate,
  ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import type { MateOverview, MateState } from "@t3tools/shared/mateLink";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { CREW_OFF_SNAPSHOT } from "./crew/crewSnapshot.ts";
import {
  type HqEnrollment,
  type HqOutcome,
  type LinkSocket,
  makeZeropsHqLink,
  mateOverviewFeed,
  type OverviewSources,
} from "./ZeropsHqLink.ts";

const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeHeard = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

type Sent = { readonly type: string } & Readonly<Record<string, unknown>>;

class FakeSocket implements LinkSocket {
  readonly url: string;
  readonly sent: Array<Sent> = [];
  readonly listeners = new Map<string, Array<(event: { readonly data: unknown }) => void>>();
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, listener: (event: { readonly data: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(decodeJson(data) as Sent);
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
  crew: null,
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
const rig = (options: { readonly enrolled?: boolean; readonly everyMs?: number } = {}) =>
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
    const asked: Array<string | undefined> = [];
    const hq = { refusing: false, tickets: 0 };
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
    const link = yield* makeZeropsHqLink({
      readEnrollment: Ref.get(enrollment),
      readOutcome: Ref.get(outcome),
      connect: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      overview: Effect.sync(() => {
        reads.count += 1;
      }).pipe(Effect.andThen(Ref.get(current)), Effect.map(Option.some)),
      changes: Stream.fromPubSub(changes),
      reconnectDelaysMs: [20],
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
    return { link, enrollment, outcome, current, changes, sockets, asked, hq, until, reads };
  });

describe("ZeropsHqLink", () => {
  it.live(
    "waits for an enrollment, links with a ticket for its credential, sends its overview, answers pings and keeps HQ's state",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { link, enrollment, sockets, until } = yield* rig({ everyMs: 10 });
          yield* Effect.sleep(Duration.millis(60));
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
  const feedRig = Effect.gen(function* () {
    const crew = yield* SubscriptionRef.make<CrewSnapshot>(CREW_OFF_SNAPSHOT);
    const auth = yield* SubscriptionRef.make<ZeropsAgentAuthSnapshot>(NO_AUTH);
    const update = yield* SubscriptionRef.make<ExecutionEnvironmentUpdate | undefined>(undefined);
    const feed = yield* mateOverviewFeed({
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
      domainEvents: Stream.never,
    });
    const sockets: Array<FakeSocket> = [];
    const http = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ ticket: "t1" }))),
    );
    yield* makeZeropsHqLink({
      readEnrollment: Effect.succeed(Option.some({ hq: "https://hq.test", credential: "cred" })),
      readOutcome: Effect.succeed(Option.none()),
      connect: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      ...feed,
    }).pipe(Effect.provideService(HttpClient.HttpClient, http));
    yield* TestClock.adjust(Duration.zero);
    const socket = sockets[0];
    if (socket === undefined) return yield* Effect.die("no socket");
    socket.emit("open");
    // Settled: whatever the feeds said as the link subscribed has been looked at, and was sent.
    yield* TestClock.adjust(Duration.seconds(1));
    return { socket, crew, auth, update };
  });

  /** The sections of every frame after the first, whole. */
  const sectionsSent = (socket: FakeSocket) =>
    socket.sent.slice(1).map((frame) => frame["sections"]);

  it.effect("sends again when the crew's snapshot moves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { socket, crew } = yield* feedRig;
        yield* SubscriptionRef.set(crew, APPLIED);
        yield* TestClock.adjust(Duration.seconds(1));
        assert.deepStrictEqual(sectionsSent(socket), [
          { crew: { crewmates: [], attention: [], readyTasks: [], personLands: true } },
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
          { identity: { environmentId: "env-1", serverVersion: "0.11.90", update: line } },
        ]);
      }),
    ),
  );
});
