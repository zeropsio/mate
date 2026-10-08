import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type * as ServerConfig from "../../config.ts";
import { CrewEngine } from "./CrewEngine.ts";
import { crewLayerInert, crewModeOn } from "./crewLayer.ts";
import { CrewThreadDirectory } from "./crewSeams.ts";
import { ZEROPS } from "./testing/crewEngineFixture.ts";

const config = (fields: Partial<ServerConfig.ServerConfig["Service"]>) =>
  fields as ServerConfig.ServerConfig["Service"];

describe("crewLayer", () => {
  it.each([
    ["a Zerops project with the switch on", config({ zerops: ZEROPS, zeropsCrew: true }), true],
    ["a Zerops project with the switch off", config({ zerops: ZEROPS, zeropsCrew: false }), false],
    ["no Zerops project, switch on", config({ zerops: undefined, zeropsCrew: true }), false],
    [
      "a Zerops project whose conversation runs on the Mate engine",
      config({ zerops: ZEROPS, zeropsCrew: true, mateEngine: "mate" }),
      false,
    ],
    [
      "a Zerops project whose conversation runs on V1",
      config({ zerops: ZEROPS, zeropsCrew: true, mateEngine: "v1" }),
      true,
    ],
  ])("runs crew mode live in %s: %s", (_, value, expected) => {
    assert.strictEqual(crewModeOn(value), expected);
  });

  it.effect(
    "inert: the feed says off, every request is unavailable, no thread is a crewmate's",
    () =>
      Effect.gen(function* () {
        const engine = yield* CrewEngine;
        const directory = yield* CrewThreadDirectory;
        const frames = yield* Stream.runCollect(engine.snapshot);
        const refused = yield* Effect.flip(
          engine.command({ _tag: "apply" }, { kind: "session", subject: "anyone" }),
        );
        assert.deepStrictEqual(
          {
            statuses: frames.map((frame) => frame.status),
            refused: refused.reason,
            member: Option.isNone(yield* directory.memberFor(ThreadId.make("thread-1"))),
          },
          { statuses: ["off"], refused: "unavailable", member: true },
        );
      }).pipe(Effect.provide(crewLayerInert)),
  );
});
