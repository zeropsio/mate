import { assert, describe, it } from "@effect/vitest";
import type { MateState, MateSummary } from "@t3tools/shared/mateLink";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  type HqEnrollment,
  type HqOutcome,
  type LinkSocket,
  makeZeropsHqLink,
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

const summary = (lastRequest: string): MateSummary => ({
  main: {
    threadId: "t1",
    status: "working",
    lastRequest,
    lastWords: null,
    lastTurnAt: null,
    waitingQuestion: null,
    firstError: null,
    liveStep: null,
  },
  running: 1,
  waiting: 0,
  signers: {},
});

/** A Mate in no application, with no changes yet. */
const STATE: MateState = {
  projectId: "P_MATE",
  name: "Ada",
  face: "face-1",
  standupRequestedBy: "owner",
  closedOff: true,
  appId: null,
  changes: [],
};

/** A link over a fake HQ: tickets for `cred` while `refusing` is off, a socket per connect. */
const rig = Effect.gen(function* () {
  const enrollment = yield* Ref.make<Option.Option<HqEnrollment>>(Option.none());
  const outcome = yield* Ref.make<Option.Option<HqOutcome>>(Option.none());
  const current = yield* Ref.make(summary("Add a login page"));
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
    summary: Effect.map(Ref.get(current), Option.some),
    changes: Stream.fromPubSub(changes),
    reconnectDelaysMs: [20],
    summaryEveryMs: 10,
    refreshEveryMs: 60_000,
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
  return { link, enrollment, outcome, current, changes, sockets, asked, hq, until };
});

describe("ZeropsHqLink", () => {
  it.live(
    "waits for an enrollment, links with a ticket for its credential, sends its summary, answers pings and keeps HQ's state",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { link, enrollment, sockets, until } = yield* rig;
          yield* Effect.sleep(Duration.millis(60));
          assert.strictEqual(sockets.length, 0);
          yield* Ref.set(enrollment, Option.some({ hq: "https://hq.test", credential: "cred" }));
          const socket = yield* until(() => sockets[0]);
          assert.strictEqual(socket.url, "wss://hq.test/api/mate/link?ticket=t1");
          socket.emit("open");
          const first = yield* until(() => socket.sent[0]);
          assert.deepStrictEqual(first, { type: "summary", summary: summary("Add a login page") });
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
        const { link, enrollment, sockets, until } = yield* rig;
        yield* Ref.set(enrollment, Option.some({ hq: "https://hq.test", credential: "cred" }));
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        const placed: MateState = {
          ...STATE,
          appId: "app-1",
          changes: [
            {
              repo: "shop",
              number: 3,
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

  // Until zcp enrolls, the Mate says why it is not linked as far as zcp said: its last word on
  // the enrollment, beside it — none from a zcp that says nothing.
  it.live("says why it is not linked yet, as zcp's last word on its enrollment has it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { link, outcome } = yield* rig;
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

  it.live("sends its summary again when it changed, never the same twice", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { enrollment, current, changes, sockets, until } = yield* rig;
        yield* Ref.set(enrollment, Option.some({ hq: "https://hq.test", credential: "cred" }));
        const socket = yield* until(() => sockets[0]);
        socket.emit("open");
        yield* until(() => socket.sent[0]);
        yield* PubSub.publish(changes, undefined);
        yield* Effect.sleep(Duration.millis(60));
        assert.strictEqual(socket.sent.filter((message) => message.type === "summary").length, 1);
        yield* Ref.set(current, summary("Now a sign-up page"));
        yield* PubSub.publish(changes, undefined);
        const second = yield* until(
          () => socket.sent.filter((message) => message.type === "summary")[1],
        );
        assert.deepStrictEqual(second, { type: "summary", summary: summary("Now a sign-up page") });
      }),
    ),
  );

  it.live("links again after the link closes, with a new ticket, and after a refused one", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { enrollment, sockets, hq, asked, until } = yield* rig;
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
});
