// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { git, read, write } from "./testing/crewGitFixture.ts";
import { applied, crewJourney, everyCopyReady, eventually } from "./testing/crewWorld.ts";

const mountPath = (root: string) => `${root}-mounted`;

const cleanMount = (root: string) =>
  Effect.sync(() => NodeFS.rmSync(mountPath(root), { recursive: true, force: true }));

describe("Crew mounted workspace readiness", () => {
  it.live(
    "A remotely created copy is ready only when its mounted working directory is observed usable.",
    () =>
      crewJourney(
        (world) =>
          Effect.gen(function* () {
            // Existence is insufficient: this mount has a directory but cannot read the copy's Git identity.
            NodeFS.mkdirSync(`${mountPath(world.root)}/.crew/backend`, { recursive: true });
            world.writeHome();
            yield* world.press({ _tag: "apply" });
            yield* eventually(
              Effect.map(
                world.copyAttempt,
                (row) =>
                  row !== undefined &&
                  row.attempt > 0 &&
                  row.state !== "running" &&
                  row.state !== "settling",
              ),
            );
            const attempt = yield* world.copyAttempt;
            const waiting = yield* world.snapshot;
            assert.deepStrictEqual(
              {
                effect: attempt?.state,
                ready: waiting.crewmates[0]?.lane?.state === "ready",
                starts: (yield* world.providerSessions).starts,
              },
              { effect: "pending", ready: false, starts: 0 },
            );
            const refused = yield* Effect.flip(
              world.press({
                _tag: "message",
                handle: "backend",
                text: "Use the copy now",
                attachments: [],
              }),
            );
            assert.deepStrictEqual(
              { reason: refused.reason, detail: refused.detail },
              {
                reason: "wrong-state",
                detail: "@backend is busy with its copy of the code; try again in a moment",
              },
            );
            assert.strictEqual((yield* world.providerSessions).starts, 0);
            const before = git(world.root, ["rev-parse", "crew/backend"]);
            write(world.root, ".crew/backend/wip.txt", "work made before the mount arrived\n");
            NodeFS.rmSync(mountPath(world.root), { recursive: true, force: true });
            NodeFS.symlinkSync(world.root, mountPath(world.root), "dir");
            yield* world.advanceTime(60_000);
            yield* world.snapshotWhere(everyCopyReady);
            yield* world.press({
              _tag: "message",
              handle: "backend",
              text: "Continue the preserved work",
              attachments: [],
            });
            yield* eventually(
              Effect.map(world.providerSessions, (sessions) => sessions.starts > 0),
            );
            assert.deepStrictEqual(
              {
                provider: yield* world.providerSessions,
                tip: git(world.root, ["rev-parse", "crew/backend"]),
                wip: read(mountPath(world.root), ".crew/backend/wip.txt"),
              },
              {
                provider: { starts: 1, cwds: [`${mountPath(world.root)}/.crew/backend`] },
                tip: before,
                wip: "work made before the mount arrived\n",
              },
            );
          }).pipe(Effect.ensuring(cleanMount(world.root))),
        { mountPath },
      ),
  );

  it.live("An unreadable crewmate copy opens nowhere, never in the Mate's tree.", () =>
    crewJourney(
      (world) =>
        Effect.gen(function* () {
          NodeFS.symlinkSync(world.root, mountPath(world.root), "dir");
          yield* applied(world);
          yield* world.press({
            _tag: "message",
            handle: "backend",
            text: "Start in the copy",
            attachments: [],
          });
          yield* eventually(Effect.map(world.providerSessions, (sessions) => sessions.starts > 0));
          const snapshot = yield* world.snapshot;
          const conversation = snapshot.crewmates[0]!.currentThreadId!;
          assert.strictEqual(
            (yield* world.agentWorkspace(conversation)).cwd,
            `${mountPath(world.root)}/.crew/backend`,
          );
          NodeFS.unlinkSync(mountPath(world.root));
          const unavailable = yield* Effect.flip(world.agentWorkspace(conversation));
          assert.deepStrictEqual(
            { tag: unavailable._tag, message: unavailable.message },
            {
              tag: "WorkspaceUnavailable",
              message: "The crewmate's copy cannot be read now.",
            },
          );
          assert.deepStrictEqual(yield* world.providerSessions, {
            starts: 1,
            cwds: [`${mountPath(world.root)}/.crew/backend`],
          });
        }).pipe(Effect.ensuring(cleanMount(world.root))),
      { mountPath },
    ),
  );
});
