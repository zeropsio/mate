/**
 * The crew RPCs' inert form (ARCHITECTURE §2 *Activation*): where crew mode is
 * not on, the feed says so once and every request is refused as unavailable.
 */
import { WS_METHODS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { CREW_OFF_SNAPSHOT, registerCrewRpc } from "./registerCrewRpc.ts";

const handlers = registerCrewRpc({
  observeRpcEffect: (_method, effect) => effect,
  observeRpcStream: (_method, stream) => stream,
});

describe("registerCrewRpc, inert", () => {
  it.effect("streams one snapshot saying crew mode is off", () =>
    Effect.gen(function* () {
      const frames = yield* Stream.runCollect(handlers[WS_METHODS.subscribeZeropsCrew]({}));
      expect(frames).toEqual([CREW_OFF_SNAPSHOT]);
      expect(CREW_OFF_SNAPSHOT.status).toBe("off");
    }),
  );

  it.effect.each([
    ["files.get", handlers[WS_METHODS.zeropsCrewFilesGet]({})],
    ["files.put", handlers[WS_METHODS.zeropsCrewFilesPut]({ files: [] })],
    ["command", handlers[WS_METHODS.zeropsCrewCommand]({ _tag: "apply" })],
  ] as const)("refuses %s as unavailable", ([, request]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(request);
      expect(error).toMatchObject({ _tag: "CrewCommandError", reason: "unavailable" });
    }),
  );
});
