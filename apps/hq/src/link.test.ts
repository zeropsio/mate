// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- the tests reach Core as zcp and a Mate do: over HTTP and a WebSocket.
import { assert, describe, it } from "@effect/vitest";
import { MATE_LINK_FRAME_MAX, linkFrameBytes } from "@t3tools/shared/mateLink";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";

import { memoryStore } from "../test/harness/overviews.ts";
import { enrollMate, setUpMate, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { Changes } from "./changes.ts";
import { Leader, NotLeader } from "./leader.ts";
import { UsageLane, type UsageLedgerService } from "./usageLedger.ts";
import { MateAccess } from "./mateAccess.ts";
import { serveMateLink } from "./link.ts";
import { MateCredentials } from "./mateCredentials.ts";
import { makeMateOverviews, MateOverviews } from "./mateOverviews.ts";
import { liveSocketsLayer } from "./stream.ts";
import { Structure } from "./structure.ts";
import { AutoUpdatePolicy } from "./autoUpdate.ts";

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** A running Core with one Mate enrolled, its link open and its first state read. */
const linked = Effect.gen(function* () {
  const core = yield* startCore(true);
  yield* untilHealth(core.call, "active");
  const owner = yield* setUpMate(core.call, "P_MATE");
  const credential = yield* enrollMate(core.call, core.fake, "P_MATE");
  const { ticket } = (yield* core.call("POST", "/api/mate/link-ticket", {
    headers: { authorization: `Mate ${credential}` },
  })).body as { readonly ticket: string };
  const link = yield* core.socket(`/api/mate/link?ticket=${ticket}`);
  yield* link.next("state");
  return { ...core, owner, link };
});

describe("a Mate's link", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("sends the organization hold to every authenticated Mate without a restart", () =>
      Effect.gen(function* () {
        const { call, owner, link } = yield* linked;
        yield* call("PUT", "/api/auto-update", { session: owner, body: { enabled: false } });
        const frame = yield* link.takeWhere(
          "the held update policy",
          (frame) =>
            frame.type === "state" &&
            (frame["autoUpdate"] as { readonly enabled?: boolean } | undefined)?.enabled === false,
        );
        assert.deepStrictEqual(frame["autoUpdate"], { orgId: "ORG", enabled: false, revision: 1 });
      }),
    );
    it.effect(
      "answers a Mate's policy verification with its request identity and the committed org policy",
      () =>
        Effect.gen(function* () {
          const { call, owner, link } = yield* linked;
          yield* call("PUT", "/api/auto-update", { session: owner, body: { enabled: false } });
          yield* link.send({ type: "auto-update-policy", requestId: "before-switch" });
          assert.deepStrictEqual(yield* link.next("auto-update-policy"), {
            requestId: "before-switch",
            policy: { orgId: "ORG", enabled: false, revision: 1 },
          });
        }),
    );
    it.effect("passes by a frame whose type it does not know and keeps the link", () =>
      Effect.gen(function* () {
        const { call, owner, link } = yield* linked;
        // A newer Mate's word for something this HQ does not know.
        yield* link.send({ type: "usage", windows: [] });
        yield* call("POST", "/api/mates/P_MATE/closed-off", { session: owner });
        // A state re-sent as the capture lane opens may come first.
        const { mate } = (yield* link.takeWhere(
          "the closed-off state",
          (message) =>
            message.type === "state" &&
            (message["mate"] as { readonly closedOff?: boolean }).closedOff === true,
        )) as unknown as { readonly mate: { readonly closedOff: boolean } };
        assert.isTrue(mate.closedOff);
      }),
    );

    it.effect("closes on a frame past 64 KiB counted in bytes", () =>
      Effect.gen(function* () {
        const { link } = yield* linked;
        // Two bytes a letter: under the bound by its length, over it by its bytes.
        const frame = { type: "usage", text: "ж".repeat(40_000) };
        assert.isBelow(toJson(frame).length, MATE_LINK_FRAME_MAX);
        assert.isAbove(linkFrameBytes(toJson(frame)), MATE_LINK_FRAME_MAX);
        yield* link.send(frame);
        assert.strictEqual(yield* link.closedWith, 1009);
      }),
    );

    // R6: HQ relays who the Mate's project lets in, from the org's view it reads anyway — at once
    // on the link, then whole and aged after every view it reads, a member gone with the view.
    it.effect("relays the Mate's access, aged, and again after each view it reads", () =>
      Effect.gen(function* () {
        const { link, fake } = yield* linked;
        type Access = {
          readonly ageMs: number;
          readonly members: ReadonlyArray<{
            readonly userId: string;
            readonly role: string;
            readonly visibility: string;
          }>;
        };
        const said = (access: Access) =>
          access.members.map((member) => `${member.userId} ${member.role} ${member.visibility}`);
        const first = (yield* link.next("access")) as Access;
        assert.deepStrictEqual(said(first), [
          "owner OWNER open",
          "reader READ_ONLY listed",
          "T-hq READ_ONLY listed",
          "T-anchor ADMIN open",
        ]);
        assert.isAtLeast(first.ageMs, 0);
        fake.members.set(
          "ORG",
          (fake.members.get("ORG") ?? []).filter((member) => member.userId !== "reader"),
        );
        let later = first;
        for (
          let frames = 0;
          frames < 50 && said(later).includes("reader READ_ONLY listed");
          frames++
        ) {
          later = (yield* link.next("access")) as Access;
        }
        assert.deepStrictEqual(said(later), [
          "owner OWNER open",
          "T-hq READ_ONLY listed",
          "T-anchor ADMIN open",
        ]);
      }),
    );

    it.effect("closes on an overview that does not decode", () =>
      Effect.gen(function* () {
        const { link } = yield* linked;
        yield* link.send({ type: "overview", full: true, overview: { main: null } });
        assert.strictEqual(yield* link.closedWith, 1007);
      }),
    );
  });
});

// F26: the live HQ's sockets ended every 120 s with no word of who ended them.
describe("serveMateLink: who ended a link, and with what code", () => {
  /** A Mate's side of the link: frames it sends, then a close with a code. */
  const mateSocket = Effect.gen(function* () {
    const incoming = yield* Queue.unbounded<string | number>();
    const socket = Socket.make({
      reader: Effect.succeed({
        pull: Effect.flatMap(Queue.take(incoming), (frame) =>
          typeof frame === "number"
            ? Effect.fail(
                new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: frame }) }),
              )
            : Effect.succeed([frame] as const),
        ),
        upgrade: () => Effect.void,
      }),
      writer: Effect.succeed({ write: () => Effect.void, writeAll: () => Effect.void }),
    });
    return { socket, send: (frame: string | number) => Queue.offer(incoming, frame) };
  });

  /** HQ's services as a link reads them: a Mate it holds no state for, under a Core that leads. */
  const services = Layer.unwrap(
    Effect.map(makeMateOverviews(memoryStore().store), (overviews) =>
      Layer.mergeAll(
        Layer.succeed(AutoUpdatePolicy, {
          current: Effect.succeed({ orgId: "ORG", enabled: true, revision: 0 }),
          changes: Stream.make(0),
          read: () => Effect.succeed({ orgId: "ORG", enabled: true, revision: 0 }),
          set: () => Effect.die("no policy writes"),
        }),
        liveSocketsLayer,
        Layer.succeed(MateOverviews, overviews),
        Layer.succeed(
          Structure,
          Structure.of({
            mateState: () => Effect.succeed(Option.none()),
            mateChanges: Stream.never,
          } as unknown as Structure["Service"]),
        ),
        Layer.succeed(
          Changes,
          Changes.of({ changes: Stream.never } as unknown as Changes["Service"]),
        ),
        Layer.succeed(
          MateCredentials,
          MateCredentials.of({
            whoami: () => Effect.succeed(Option.some({ projectId: "P_MATE" })),
          } as unknown as MateCredentials["Service"]),
        ),
        Layer.succeed(
          Leader,
          Leader.of({
            status: Effect.succeed({ state: "active" }),
          } as unknown as Leader["Service"]),
        ),
        Layer.succeed(MateAccess, MateAccess.of({ frames: () => Stream.never })),
      ),
    ),
  );

  it.effect("the Mate, with the code its close carried", () =>
    Effect.gen(function* () {
      const { socket, send } = yield* mateSocket;
      const serving = yield* Effect.forkChild(serveMateLink(socket, "P_MATE", "cred", {}));
      yield* send(1006);
      assert.deepStrictEqual(yield* Fiber.join(serving), { by: "client", code: 1006 });
    }).pipe(Effect.provide(services)),
  );

  /** HQ's capture lane as a link reads it: `open` answers with `opened`. */
  const usageLane = (opened: ReturnType<UsageLedgerService["open"]>) =>
    Layer.succeed(UsageLane, {
      ledger: {
        open: () => opened,
        receive: () => Effect.die("unused"),
        changes: Stream.never,
        notify: Effect.void,
      },
    });

  /** A link to a Mate HQ holds a state for: every state frame it wrote, as JSON. */
  const statesOf = (opened: ReturnType<UsageLedgerService["open"]>) =>
    Effect.gen(function* () {
      const written: string[] = [];
      const socket = Socket.make({
        reader: Effect.succeed({ pull: Effect.never, upgrade: () => Effect.void }),
        writer: Effect.succeed({
          write: (frame: unknown) =>
            Effect.sync(() => {
              written.push(String(frame));
            }),
          writeAll: () => Effect.void,
        }),
      });
      const serving = yield* Effect.forkChild(serveMateLink(socket, "P_MATE", "cred", {}));
      const states = () =>
        written
          .map((frame) => JSON.parse(frame) as { type: string; usage?: unknown })
          .filter((frame) => frame.type === "state");
      /** The first state `matches` accepts, waited for. */
      const state = (matches: (frame: { usage?: unknown }) => boolean) =>
        Effect.suspend(() => {
          const found = states().find(matches);
          return found === undefined ? Effect.fail("no such state") : Effect.succeed(found);
        }).pipe(Effect.retry(Schedule.spaced(Duration.millis(10))), Effect.timeout("5 seconds"));
      return { serving, state };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          services,
          Layer.succeed(
            Structure,
            Structure.of({
              mateState: () => Effect.succeed(Option.some({ projectId: "P_MATE" })),
              mateChanges: Stream.make("P_MATE"),
            } as unknown as Structure["Service"]),
          ),
          Layer.succeed(
            Changes,
            Changes.of({
              changes: Stream.never,
              mateChanges: () => Effect.succeed({}),
            } as unknown as Changes["Service"]),
          ),
          usageLane(opened),
        ),
      ),
    );
  const sender = {
    projectId: "P_MATE",
    credential: "cred",
    channel: "C",
    mateId: "M",
    orgId: "ORG",
  };

  it.live("a link offers capture with the org HQ holds the Mate in", () =>
    Effect.gen(function* () {
      const { state } = yield* statesOf(Effect.succeed(sender));
      const offered = yield* state((frame) => frame.usage !== undefined);
      assert.deepStrictEqual(offered.usage, { capture: 1, report: 1, mateId: "M", orgId: "ORG" });
    }),
  );

  it.live(
    "a link sends the Mate's state without waiting for a slow capture lane, then offers capture",
    () =>
      Effect.gen(function* () {
        const opening = yield* Deferred.make<typeof sender>();
        const { state } = yield* statesOf(Deferred.await(opening));
        yield* state((frame) => frame.usage === undefined);
        yield* Deferred.succeed(opening, sender);
        const offered = yield* state((frame) => frame.usage !== undefined);
        assert.deepStrictEqual(offered.usage, { capture: 1, report: 1, mateId: "M", orgId: "ORG" });
      }),
  );

  // Answer (3): "a socket whose accept failed" is the link's accept, never its usage lane.
  it.live("a link whose capture lane cannot open stays up without capture", () =>
    Effect.gen(function* () {
      const { serving, state } = yield* statesOf(Effect.fail(new NotLeader({ reason: "standby" })));
      yield* state((frame) => frame.usage === undefined);
      yield* Effect.sleep("200 millis");
      assert.isUndefined(serving.pollUnsafe());
    }),
  );

  it.effect("HQ, with the code it closed with", () =>
    Effect.gen(function* () {
      const { socket, send } = yield* mateSocket;
      const serving = yield* Effect.forkChild(serveMateLink(socket, "P_MATE", "cred", {}));
      yield* send("not a link message");
      assert.deepStrictEqual(yield* Fiber.join(serving), { by: "hq", code: 1007 });
    }).pipe(Effect.provide(services)),
  );
});
