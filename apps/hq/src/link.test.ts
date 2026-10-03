// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- the tests reach Core as zcp and a Mate do: over HTTP and a WebSocket.
import { assert, describe, it } from "@effect/vitest";
import { MATE_LINK_FRAME_MAX, linkFrameBytes } from "@t3tools/shared/mateLink";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { enrollMate, setUpMate, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

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
    it.effect("passes by a frame whose type it does not know and keeps the link", () =>
      Effect.gen(function* () {
        const { call, owner, link } = yield* linked;
        // A newer Mate's word for something this HQ does not know.
        yield* link.send({ type: "usage", windows: [] });
        yield* call("POST", "/api/mates/P_MATE/closed-off", { session: owner });
        const { mate } = (yield* link.next("state")) as {
          readonly mate: { readonly closedOff: boolean };
        };
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

    it.effect("closes on an overview that does not decode", () =>
      Effect.gen(function* () {
        const { link } = yield* linked;
        yield* link.send({ type: "overview", full: true, overview: { main: null } });
        assert.strictEqual(yield* link.closedWith, 1007);
      }),
    );
  });
});
