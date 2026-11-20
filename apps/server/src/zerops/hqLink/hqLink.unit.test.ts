import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  type MateAttention,
  OrchestrationThreadShell,
  ProjectId,
  type ThreadId,
  ZeropsUserId,
} from "@t3tools/contracts";
import type { LinkedMate, MateOverview } from "@t3tools/shared/mateLink";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { type LinkSocket, lookupIpv6, makeZeropsHqLink, REFUSAL_REASK } from "../ZeropsHqLink.ts";
import {
  type AttentionEvent,
  makeZeropsMateAttention,
  nextMateEpoch,
} from "../ZeropsMateAttention.ts";
import { make, requestWithMateKey } from "../ZeropsMateKey.ts";

/** Past the re-ask of a refused key and the most its spread adds. */
const REASKED = Duration.millis(Duration.toMillis(REFUSAL_REASK) * 1.25 + 1);

const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeHeard = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

type Sent = { readonly type: string } & Readonly<Record<string, unknown>>;

/** HQ's end of one link, as the test plays it. */
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
  /** The socket is going away: a `key-refused` sent on it is lost. */
  failRefusal = false;
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
    if (this.failRefusal && data.includes("key-refused")) throw new Error("socket closed");
    this.sent.push(decodeJson(data) as Sent);
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

/** A Mate in no application, with no changes yet, its organisation's Chief mark on none. */
const STATE: LinkedMate = {
  projectId: "P_MATE",
  name: "Ada",
  face: "face-1",
  standupRequestedBy: ZeropsUserId.make("owner"),
  appId: null,
  appName: null,
  changes: [],
  chief: null,
};

/** The admission of the project's key HQ names in each state. */
const ADMISSION = "6d0c2f4e-3b1a-4c8d-9e7f-5a2b1c0d9e8f";

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

/** HQ admits the key: its first state on the link, then the signers it kept (none). */
const admit = (socket: FakeSocket) => {
  socket.hear({ type: "state", mate: { ...STATE, repos: [] }, admission: ADMISSION });
  socket.hear({ type: "signers", signers: {} });
};

/** A link over a fake HQ, a socket per connect, the project's key `zk-1` unless a test takes it. */
const rig = (
  options: {
    /** The container holds no key until the test gives it one. */
    readonly keyless?: boolean;
    readonly everyMs?: number;
    readonly reconnectDelaysMs?: ReadonlyArray<number>;
    /** The Mate's public origin; its container's own unless a test takes it away. */
    readonly publicOrigin?: string | undefined;
    readonly observeCredential?: (credential: string | null) => Effect.Effect<boolean>;
  } = {},
) =>
  Effect.gen(function* () {
    const key = yield* Ref.make<string | undefined>(options.keyless === true ? undefined : "zk-1");
    /** The fingerprint of the Git credential the Mate holds; none until a test gives it one. */
    const fingerprint = yield* Ref.make(Option.none<string>());
    /** How often the link read the overview. */
    const reads = { count: 0 };
    const changes = yield* PubSub.unbounded<void>();
    const sockets: Array<FakeSocket> = [];
    /** The Git credentials HQ sent, as the link handed them on. */
    const credentials: Array<string | null> = [];
    const link = yield* makeZeropsHqLink({
      hqOrigin: "https://hq.test/",
      serviceId: "svc-mate",
      publicOrigin:
        "publicOrigin" in options ? options.publicOrigin : "https://mate-1234.prg1.zerops.app",
      readKey: Ref.get(key),
      connect: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      overview: Effect.sync(() => {
        reads.count += 1;
      }).pipe(Effect.as(Option.some(overview("Add a login page")))),
      changes: Stream.fromPubSub(changes),
      attention: Stream.never,
      gitCredential: (credential) => Effect.sync(() => void credentials.push(credential)),
      ...(options.observeCredential === undefined
        ? {}
        : { observeCredential: options.observeCredential }),
      gitFingerprint: Ref.get(fingerprint),
      heldSessions: Effect.succeed([]),
      reconnectDelaysMs: options.reconnectDelaysMs ?? [20],
      ...(options.everyMs === undefined ? {} : { overviewEveryMs: options.everyMs }),
    });
    return { link, key, fingerprint, changes, sockets, reads, credentials };
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

/** The admission HQ names for the key, and a later one: a new admission, even of the same key. */
const ADMISSION_A = "0b6f3c1e-2d4a-4e5f-8a7b-9c0d1e2f3a4b";
const ADMISSION_B = "7e8f9a0b-1c2d-4e3f-a4b5-c6d7e8f9a0b1";

/** The hello of a link whose key is read from the env store. */
const storeHello = (key: string) => ({
  type: "hello",
  key,
  serviceId: "zcp",
  origin: "https://mate.test",
  heldSessionIds: [],
});

/** A link whose key and its refusals come from the env store's reader, its first socket open. */
const keyRig = Effect.gen(function* () {
  let store = '{"ZCP_API_KEY":"old-key"}';
  const storePath = "/test/env-store.json";
  const fs = FileSystem.makeNoop({
    readFileString: () => Effect.sync(() => store),
    writeFileString: (_path, value) =>
      Effect.sync(() => {
        store = value;
      }),
  });
  const reader = yield* make({
    fs,
    storePath,
    snapshot: undefined,
    watch: () => ({ dispose: () => {} }),
  });
  const sockets: Array<FakeSocket> = [];
  const connected = yield* Queue.unbounded<FakeSocket>();
  yield* makeZeropsHqLink({
    hqOrigin: "https://hq.test",
    serviceId: "zcp",
    publicOrigin: "https://mate.test",
    readKey: Effect.andThen(reader.invalidate, reader.read),
    ...(reader.refusal === undefined ? {} : { keyRefusal: reader.refusal }),
    connect: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      Queue.offerUnsafe(connected, socket);
      return socket;
    },
    overview: Effect.succeed(Option.none()),
    changes: Stream.never,
    attention: Stream.never,
    gitCredential: () => Effect.void,
    gitFingerprint: Effect.succeed(Option.none()),
    heldSessions: Effect.succeed([]),
    reconnectDelaysMs: [20],
  });
  const socket = yield* Queue.take(connected);
  socket.emit("open");
  yield* TestClock.adjust(Duration.zero);
  return { reader, sockets, connected, fs, storePath };
});

/** HQ's state on a link whose key is read from the env store, naming `admission`. */
const hearState = (socket: FakeSocket, admission: string) =>
  socket.hear({ type: "state", mate: STATE, admission });

const decodeShell = Schema.decodeUnknownSync(OrchestrationThreadShell);

const PROJECT = ProjectId.make("project-1");

const shell = (id: string, extra: object = {}) =>
  decodeShell({
    id,
    projectId: PROJECT,
    title: id,
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...extra,
  });

/** A projection the service reads, its chats by id, and each chat read alone (`one`). */
const projectionOf = (threads: ReadonlyArray<OrchestrationThreadShell>) => ({
  rows: new Map(threads.map((thread) => [thread.id as string, thread])),
  asked: { one: [] as Array<string> },
  /** The chats whose read fails. */
  failing: new Set<string>(),
  /** Told as each chat's read starts. */
  reading: (_id: string): Effect.Effect<void> => Effect.void,
});

/** The service over `projection`, started by a first read. */
const attentionFor = (projection: ReturnType<typeof projectionOf>) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<AttentionEvent>();
    const attention = yield* makeZeropsMateAttention({
      environmentId: EnvironmentId.make("env-1"),
      epoch: 1,
      incarnation: "boot-1",
      project: Effect.succeed(Option.some(PROJECT)),
      threadsOf: (projectId) =>
        Effect.sync(() =>
          [...projection.rows.values()].filter((thread) => thread.projectId === projectId),
        ),
      thread: (threadId: ThreadId) =>
        Effect.gen(function* () {
          projection.asked.one.push(threadId);
          yield* projection.reading(threadId);
          if (projection.failing.has(threadId)) return yield* Effect.fail("projection unavailable");
          return Option.fromNullishOr(projection.rows.get(threadId));
        }),
      domainEvents: Stream.fromPubSub(events),
    });
    const threadMoved = (threadId: string) =>
      PubSub.publish(events, { aggregateKind: "thread", aggregateId: threadId as ThreadId });
    yield* attention.current;
    return { attention, threadMoved };
  });

/** The first value the service publishes at `revision`. */
const atRevision = (changes: Stream.Stream<MateAttention>, revision: number) =>
  changes.pipe(
    Stream.filter((value) => value.source.revision === revision),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

// witness: apps/server/src/zerops/ZeropsHqLink.ts | const url = `${options.hqOrigin.replace(/^http/u, "ws").replace(/\/+$/u, "")}/api/mate/link`; → const url = `${options.hqOrigin.replace(/^http/u, "ws").replace(/\/+$/u, "")}/api/mate/link/${options.serviceId}`;
it.effect(
  "HL1: A link opens at HQ's link address with the project's key in its first frame and nothing in the URL, answers only pings until HQ's first state, then sends the whole overview, and the next link presents the key the container holds then",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, key, sockets } = yield* rig();
        const first = yield* opened(sockets, 0);
        assert.strictEqual(first.url, "wss://hq.test/api/mate/link");
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
        yield* Ref.set(key, "zk-2");
        first.emit("close");
        yield* TestClock.adjust(Duration.millis(30));
        const second = yield* opened(sockets, 1);
        assert.deepStrictEqual(second.sent, [hello("zk-2")]);
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsHqLink.ts | ...(Option.isSome(gitFingerprint) ? { gitFingerprint: gitFingerprint.value } : {}), → ...(Option.isSome(gitFingerprint) ? { gitFingerprint: gitFingerprint.value } : { gitFingerprint: "" }),
it.effect(
  "HL2: A link's hello names the fingerprint of the Git credential the Mate holds, read afresh at every dial, and none while it holds none",
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
        assert.deepStrictEqual(second.sent, [{ ...hello("zk-1"), gitFingerprint: "f".repeat(64) }]);
        yield* Ref.set(fingerprint, Option.none());
        second.emit("close");
        yield* TestClock.adjust(Duration.millis(30));
        assert.deepStrictEqual((yield* opened(sockets, 2)).sent, [hello("zk-1")]);
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsHqLink.ts | if (options.publicOrigin === undefined) return Result.fail("no_public_origin" as const); → if (options.publicOrigin === "") return Result.fail("no_public_origin" as const);
it.effect(
  "HL3: A Mate whose public origin is unknown dials nothing and says its link is withheld for it, and one whose container holds no key dials nothing until a key appears",
  () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { link, sockets } = yield* rig({ publicOrigin: undefined });
          yield* TestClock.adjust(Duration.seconds(1));
          assert.lengthOf(sockets, 0);
          assert.deepStrictEqual(yield* link.standing, {
            kind: "not-linked",
            withheld: "no_public_origin",
          });
        }),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { key, sockets } = yield* rig({ keyless: true });
          yield* TestClock.adjust(Duration.seconds(1));
          assert.lengthOf(sockets, 0);
          yield* Ref.set(key, "zk-1");
          yield* TestClock.adjust(Duration.millis(30));
          const socket = yield* opened(sockets, 0);
          assert.deepStrictEqual(socket.sent, [hello("zk-1")]);
        }),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsHqLink.ts | const HQ_HANDSHAKE_BUDGET = Duration.seconds(30); → const HQ_HANDSHAKE_BUDGET = Duration.seconds(60);
it.effect(
  "HL4: A link whose HQ sends no state within 30 s of opening is closed and dialled again, its pings answered meanwhile, while an admitted link is kept until it closes",
  () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { sockets } = yield* rig({ everyMs: 10_000_000, reconnectDelaysMs: [100, 1_000] });
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
      );
      yield* Effect.scoped(
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
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsHqLink.ts | const remaining = 3 * period - elapsed; → const remaining = 4 * period - elapsed;
it.effect(
  "HL5: A link that hears nothing for three of the ping intervals HQ announced is closed and dialled again though its socket never reports closed, and a superseded link's deadline never closes its successor",
  () =>
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
      yield* Effect.scoped(
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
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsHqLink.ts | return options.gitCredential(frame.credential); → return options.gitCredential(null);
it.effect("HL6: The Git credential HQ sends is handed on, and so is HQ's revocation of it", () =>
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

// witness: apps/server/src/zerops/ZeropsHqLink.ts | return (options.observeCredential?.(frame.credential) ?? Effect.succeed(false)).pipe( → return (options.observeCredential?.(frame.credential) ?? Effect.succeed(true)).pipe(
it.effect(
  "HL7: An Observe credential HQ sends is acknowledged with its writer's own receipt, and refused when the Mate has no writer for it",
  () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { sockets } = yield* rig({
            observeCredential: (credential) => Effect.succeed(credential !== "zobs.failed"),
          });
          const socket = yield* linked(sockets, 0);
          socket.hear({ type: "observe-credential", id: "write", credential: "zobs.delayed" });
          socket.hear({ type: "observe-credential", id: "failed", credential: "zobs.failed" });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(
            socket.sent.filter((message) => message.type === "observe-credential-ack"),
            [
              { type: "observe-credential-ack", id: "write", ok: true },
              { type: "observe-credential-ack", id: "failed", ok: false },
            ],
          );
        }),
      );
      yield* Effect.scoped(
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
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsHqLink.ts | Effect.andThen(SubscriptionRef.set(keyVerdict, undefined)), → Effect.andThen(Effect.void),
it.effect(
  "HL8: HQ's refusal of the key, with HQ's reason, stands until HQ next sends a state, and a refused key is dialled again only after the re-ask while its store stays put",
  () =>
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
        // Past the wait any other failed link redials after, the refused key is not dialled again.
        yield* TestClock.adjust(Duration.millis(30));
        assert.lengthOf(sockets, 1);
        yield* TestClock.adjust(REASKED);
        const second = yield* opened(sockets, 1);
        second.closeWith(4401, "key_refused");
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(yield* link.standing, {
          kind: "not-linked",
          refusal: "key_refused",
        });
        yield* TestClock.adjust(REASKED);
        const third = yield* opened(sockets, 2);
        admit(third);
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(yield* link.standing, { kind: "linked", mate: STATE });
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsHqLink.ts | close?.code === SUPERSEDED || (ran.opened && ran.stated && lived >= LINK_STABLE_MS) → (ran.opened && ran.stated && lived >= LINK_STABLE_MS)
it.effect(
  "HL9: A link HQ superseded is followed by a new one after the shortest wait, while each link that closes right after it opened waits longer than the last",
  () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
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
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { sockets } = yield* rig({ reconnectDelaysMs: [100, 1_000, 10_000] });
          const first = yield* opened(sockets, 0);
          first.emit("close");
          yield* TestClock.adjust(Duration.millis(130));
          const second = yield* opened(sockets, 1);
          second.emit("close");
          yield* TestClock.adjust(Duration.millis(130));
          assert.lengthOf(sockets, 2);
          yield* TestClock.adjust(Duration.millis(1_200));
          assert.lengthOf(sockets, 3);
        }),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsHqLink.ts | yield* Queue.take(woken); → yield* Queue.poll(woken);
it.effect(
  "HL10: A quiet link sends nothing and reads nothing: the overview is read again only when something changed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sockets, changes, reads } = yield* rig();
        const socket = yield* linked(sockets, 0);
        // A change heard that changed nothing sends nothing either.
        yield* PubSub.publish(changes, undefined);
        yield* TestClock.adjust(Duration.seconds(1));
        const read = reads.count;
        yield* TestClock.adjust(Duration.minutes(2));
        assert.strictEqual(socket.sent.length, 2);
        assert.strictEqual(reads.count, read);
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsHqLink.ts | lookup(hostname, { ...options, family: 6 }, (error, address, version) => { → lookup(hostname, options, (error, address, version) => {
it("HL11: HQ is resolved over IPv6 only, even when the connection asks for IPv4, and an answer that maps to IPv4 is refused", () => {
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

  for (const answer of ["::ffff:127.0.0.1", [{ address: "::ffff:7f00:1", family: 6 }]]) {
    const mapped = lookupIpv6((_hostname, _options, callback) => {
      callback(null, answer, 6);
    });
    const failures: Array<NodeJS.ErrnoException | null> = [];
    mapped("hq.example", {}, (error) => {
      failures.push(error);
    });
    assert.strictEqual(failures[0]?.code, "ENOTFOUND");
  }
});

// witness: apps/server/src/zerops/ZeropsHqLink.ts | Effect.flatMap((dead) => (dead ? send({ type: "key-refused" }) : Effect.void)), → Effect.flatMap(() => Effect.void),
it.effect(
  "HL12: A refusal by Zerops of the key HQ admitted, which the container still holds, is reported to HQ in one key-refused frame, and again on the next link when that send was lost, while a link after the key changed stays open",
  () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { reader, sockets } = yield* keyRig;
          hearState(sockets[0]!, ADMISSION_A);
          yield* TestClock.adjust(Duration.zero);
          yield* requestWithMateKey(reader, () => Effect.succeed({ status: 401 }));
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(sockets[0]!.sent, [
            storeHello("old-key"),
            { type: "key-refused" },
          ]);
        }),
      );
      // An env rotation after a reported refusal keeps the replacement link open; a failed
      // key-refused send is told again on the next link.
      for (const rotate of [true, false]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { reader, sockets, connected, fs, storePath } = yield* keyRig;
            hearState(sockets[0]!, ADMISSION_A);
            yield* TestClock.adjust(Duration.zero);
            sockets[0]!.failRefusal = !rotate;
            yield* requestWithMateKey(reader, () => Effect.succeed({ status: 401 }));
            yield* TestClock.adjust(Duration.zero);
            assert.equal(sockets[0]!.sent.length, rotate ? 2 : 1);
            if (rotate) yield* fs.writeFileString(storePath, '{"ZCP_API_KEY":"new-key"}');
            sockets[0]!.emit("close");
            yield* TestClock.adjust(Duration.millis(30));
            yield* TestClock.adjust(Duration.zero);
            assert.equal(sockets.length, 2);
            const next = yield* Queue.take(connected);
            next.emit("open");
            yield* TestClock.adjust(Duration.zero);
            hearState(next, rotate ? ADMISSION_B : ADMISSION_A);
            yield* TestClock.adjust(Duration.zero);
            assert.deepStrictEqual(next.sent, [
              storeHello(rotate ? "new-key" : "old-key"),
              ...(rotate ? [] : [{ type: "key-refused" }]),
            ]);
            assert.equal(next.closed, false);
            assert.equal(sockets.length, 2);
          }),
        );
      }
      // A refusal whose send was lost on a closing link is reported again on the next link.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { reader, sockets, connected } = yield* keyRig;
          hearState(sockets[0]!, ADMISSION_A);
          yield* TestClock.adjust(Duration.zero);
          yield* requestWithMateKey(reader, () => Effect.succeed({ status: 401 }));
          yield* TestClock.adjust(Duration.zero);
          assert.equal(sockets[0]!.sent.length, 2);
          sockets[0]!.emit("close");
          yield* TestClock.adjust(Duration.millis(30));
          yield* TestClock.adjust(Duration.zero);
          const next = yield* Queue.take(connected);
          next.emit("open");
          yield* TestClock.adjust(Duration.zero);
          hearState(next, ADMISSION_A);
          yield* TestClock.adjust(Duration.zero);
          assert.equal(next.sent.filter((frame) => frame.type === "key-refused").length, 1);
        }),
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsKeyRefusal.ts | if (status === 401) → if (status === 401 || status === 403)
it.effect(
  "HL13: Only Zerops' 401 accuses the Mate key: a resource's 403, a 5xx or a timeout reports nothing and keeps the link",
  () =>
    Effect.gen(function* () {
      for (const status of [403, 503, undefined]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { reader, sockets } = yield* keyRig;
            // HQ admitted the key, so a refusal of it would be told.
            hearState(sockets[0]!, ADMISSION_A);
            yield* TestClock.adjust(Duration.zero);
            const result = yield* requestWithMateKey(reader, () =>
              status === undefined ? Effect.fail("timeout") : Effect.succeed({ status }),
            ).pipe(Effect.result);
            assert.equal(result._tag, status === undefined ? "Failure" : "Success");
            yield* TestClock.adjust(Duration.zero);
            assert.deepStrictEqual(sockets[0]!.sent, [storeHello("old-key")]);
            assert.equal(sockets.length, 1);
            assert.equal(sockets[0]!.closed, false);
          }),
        );
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsMateAttention.ts | reads.thread(id).pipe( → reads.thread(id).pipe(Effect.orElseSucceed(() => Option.none())).pipe(
it.effect(
  "HL14: A chat whose read fails stays held in the Mate's attention, while a chat no longer active or now another project's leaves it",
  () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const projection = projectionOf([shell("a", { hasPendingApprovals: true })]);
          const { attention, threadMoved } = yield* attentionFor(projection);
          projection.rows.delete("a");
          projection.failing.add("a");
          yield* threadMoved("a");
          projection.rows.set("b", shell("b", { createdAt: "2026-10-02T00:00:00Z" }));
          yield* threadMoved("b");
          const next = yield* atRevision(attention.changes, 1);
          assert.deepStrictEqual(
            { waiting: next.waiting, asked: projection.asked.one },
            { waiting: 1, asked: ["a", "b"] },
          );
        }),
      );
      // No longer active, then another project's.
      for (const now of [undefined, { projectId: "project-2" }]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const projection = projectionOf([shell("a", { hasPendingApprovals: true })]);
            const { attention, threadMoved } = yield* attentionFor(projection);
            if (now === undefined) projection.rows.delete("a");
            else projection.rows.set("a", shell("a", { hasPendingApprovals: true, ...now }));
            yield* threadMoved("a");
            const next = yield* atRevision(attention.changes, 1);
            assert.deepStrictEqual(
              { waiting: next.waiting, questions: next.questions, last: next.lastThreadId },
              { waiting: 0, questions: [], last: null },
            );
          }),
        );
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsMateAttention.ts | if (next !== previous) yield* SubscriptionRef.set(attention, next); → yield* SubscriptionRef.set(attention, next);
it.effect(
  "HL15: Each attention revision is published once: an event that changes nothing publishes nothing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const projection = projectionOf([shell("a")]);
        const { attention, threadMoved } = yield* attentionFor(projection);
        const seen = yield* attention.changes.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        // The rename is read on its own before the next chat moves.
        const readA = yield* Deferred.make<void>();
        projection.reading = (id) =>
          id === "a" ? Effect.asVoid(Deferred.succeed(readA, undefined)) : Effect.void;
        projection.rows.set("a", shell("a", { title: "renamed" }));
        yield* threadMoved("a");
        yield* Deferred.await(readA);
        projection.rows.set("b", shell("b", { createdAt: "2026-10-02T00:00:00Z" }));
        yield* threadMoved("b");
        const revisions = Array.from(yield* Fiber.join(seen), (value) => value.source.revision);
        assert.deepStrictEqual(revisions, [0, 1]);
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsMateAttention.ts | if (saved !== null && !/^[1-9][0-9]*$/u.test(saved)) → if (saved !== null && !/^[0-9]+$/u.test(saved))
it.effect(
  "HL16: Each start counts its epoch one past the saved one, 1 when none is saved, and saves it before use, while a saved epoch that is no positive whole number is refused and left as it was",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      // A first start with nothing saved, a start after four, three starts in a row.
      for (const { saved, starts, epochs } of [
        { saved: undefined, starts: 1, epochs: [1] },
        { saved: "4\n", starts: 1, epochs: [5] },
        { saved: undefined, starts: 3, epochs: [1, 2, 3] },
      ]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const dir = yield* fs.makeTempDirectoryScoped();
            const path = `${dir}/mate-epoch`;
            if (saved !== undefined) yield* fs.writeFileString(path, saved);
            const seen: Array<number> = [];
            for (let start = 0; start < starts; start += 1) seen.push(yield* nextMateEpoch(path));
            assert.deepStrictEqual(
              { seen, saved: (yield* fs.readFileString(path)).trim() },
              { seen: epochs, saved: String(epochs.at(-1)) },
            );
          }),
        );
      }
      // No number, zero, a fraction.
      for (const saved of ["boot", "0", "2.5"]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const dir = yield* fs.makeTempDirectoryScoped();
            const path = `${dir}/mate-epoch`;
            yield* fs.writeFileString(path, saved);
            const exit = yield* Effect.exit(nextMateEpoch(path));
            assert.deepStrictEqual(
              { failed: exit._tag === "Failure", saved: yield* fs.readFileString(path) },
              { failed: true, saved },
            );
          }),
        );
      }
    }).pipe(Effect.provide(NodeServices.layer)),
);
