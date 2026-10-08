/**
 * The crew RPCs over the engine: inert where crew mode is off, live
 * otherwise, and a command always runs as the connecting session.
 */
import {
  WS_METHODS,
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ZEROPS_SUBJECT_PREFIX } from "../ZeropsMembershipWatch.ts";
import { CrewEngine, inertCrewEngine } from "./CrewEngine.ts";
import { registerCrewRpc } from "./registerCrewRpc.ts";
import { eventually, withCrewEngine } from "./testing/crewEngineFixture.ts";
import { makeRpcUpdateAdmission } from "../../RpcUpdateAdmission.ts";

const passThrough = {
  admit: <A, E, R>(_method: string, effect: Effect.Effect<A, E, R>) => effect,
};

const SUBJECT = `${ZEROPS_SUBJECT_PREFIX}user-karel`;

describe("registerCrewRpc", () => {
  const inert = registerCrewRpc({ crew: inertCrewEngine, subject: SUBJECT, ...passThrough });

  it.effect(
    "during update, an accepted crew can pause or stop while new crew work is refused",
    () =>
      Effect.gen(function* () {
        const admission = yield* makeRpcUpdateAdmission;
        yield* admission.begin;
        const handlers = registerCrewRpc({
          crew: { ...inertCrewEngine, command: () => Effect.succeed({ _tag: "done" }) },
          subject: SUBJECT,
          admit: (_method, effect, continuation = false) =>
            admission.run(
              effect,
              new EnvironmentAuthorizationError({
                message: "Update waiting",
                requiredScope: AuthOrchestrationOperateScope,
              }),
              continuation,
            ),
        });
        expect(
          yield* handlers[WS_METHODS.zeropsCrewCommand]({ _tag: "pause", runId: "run-1" }),
        ).toEqual({ _tag: "done" });
        expect(
          yield* handlers[WS_METHODS.zeropsCrewCommand]({ _tag: "stop", runId: "run-1" }),
        ).toEqual({ _tag: "done" });
        const denied = yield* handlers[WS_METHODS.zeropsCrewCommand]({ _tag: "apply" }).pipe(
          Effect.flip,
        );
        expect(denied).toMatchObject({ _tag: "EnvironmentAuthorizationError" });
      }).pipe(Effect.scoped),
  );

  it.effect("inert: streams one snapshot saying crew mode is off", () =>
    Effect.gen(function* () {
      const frames = yield* Stream.runCollect(inert[WS_METHODS.subscribeZeropsCrew]({}));
      expect(frames.map((frame) => frame.status)).toEqual(["off"]);
    }),
  );

  it.effect.each([
    ["files.get", inert[WS_METHODS.zeropsCrewFilesGet]({})],
    ["files.put", inert[WS_METHODS.zeropsCrewFilesPut]({ files: [] })],
    ["command", inert[WS_METHODS.zeropsCrewCommand]({ _tag: "apply" })],
  ] as const)("inert: refuses %s as unavailable", ([, request]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(request);
      expect(error).toMatchObject({ _tag: "CrewCommandError", reason: "unavailable" });
    }),
  );

  it.live("live: saves the crew home, applies it as the session, and streams the crew", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const handlers = registerCrewRpc({
          crew: yield* CrewEngine,
          subject: SUBJECT,
          ...passThrough,
        });
        const latest = handlers[WS_METHODS.subscribeZeropsCrew]({}).pipe(
          Stream.take(1),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        const before = yield* latest;
        yield* handlers[WS_METHODS.zeropsCrewFilesPut]({
          files: [
            {
              path: "crew.yaml",
              content:
                "name: Game team\nbriefTitle: Space shooter\nmembers:\n  - handle: erik\n    displayName: Erik\n    kind: reader\n",
            },
            { path: "brief.md", content: "Ship it.\n" },
            { path: "jobs/erik.md", content: "Write the plan.\n" },
          ],
        });
        const files = yield* handlers[WS_METHODS.zeropsCrewFilesGet]({});
        yield* handlers[WS_METHODS.zeropsCrewCommand]({ _tag: "apply" });
        yield* eventually(Effect.map(latest, (snapshot) => snapshot.status === "applied"));
        const after = yield* latest;
        expect({
          before: before.status,
          files: files.files.map((file) => file.path),
          after: [after.crew?.name, after.crewmates.map((mate) => mate.handle)],
          seq: after.seq > before.seq,
          installs: yield* Ref.get(world.installs),
        }).toEqual({
          before: "none",
          files: ["brief.md", "crew.yaml", "jobs/erik.md"],
          after: ["Game team", ["erik"]],
          seq: true,
          installs: 1,
        });
      }),
    ),
  );
});
