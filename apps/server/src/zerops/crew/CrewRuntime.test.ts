// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { claimTransition } from "./crewMachines.ts";
import {
  claimEventFromServed,
  claimOf,
  claimRequest,
  CrewRuntime,
  holdsClaim,
  makeCrewRuntime,
  servedFrom,
  showOnDevAnswer,
} from "./CrewRuntime.ts";
import { CrewStore } from "./CrewStore.ts";
import * as CrewWorkspace from "./CrewWorkspace.ts";
import { crewGitLayer, TEST_HOST, withCrewService } from "./testing/crewGitFixture.ts";

const HANDLES = ["backend", "frontend"];

describe("servedFrom", () => {
  it.each([
    ["the tree", "/var/www", { by: "tree" }],
    ["a directory of the tree", "/var/www/web", { by: "tree" }],
    ["a crewmate's copy", "/var/www/.crew/backend", { by: "crewmate", handle: "backend" }],
    [
      "a directory of a copy",
      "/var/www/.crew/frontend/web",
      { by: "crewmate", handle: "frontend" },
    ],
    ["a copy nobody on the crew owns", "/var/www/.crew/ghost", { by: "unknown" }],
    ["the lanes' parent", "/var/www/.crew", { by: "unknown" }],
    ["a deleted copy", "/var/www/.crew/backend (deleted)", { by: "unknown" }],
    ["a sibling that shares the prefix", "/var/www2", { by: "unknown" }],
    ["somewhere else", "/srv/app", { by: "unknown" }],
    ["no running dev server", undefined, { by: "unknown" }],
  ] as const)("%s", (_name, cwd, served) => {
    expect(servedFrom(cwd, "/var/www", HANDLES)).toEqual(served);
  });
});

describe("claimEventFromServed", () => {
  const tree = { by: "tree" } as const;
  const holder = { by: "crewmate", handle: "backend" } as const;
  const other = { by: "crewmate", handle: "frontend" } as const;
  const unknown = { by: "unknown" } as const;

  // [claim state, what dev serves, the event, the state it moves to]
  it.each([
    ["starting", holder, "serves-lane", "held"],
    ["starting", tree, "serves-other", "releasing"],
    ["starting", other, "serves-other", "releasing"],
    ["starting", unknown, "serves-other", "releasing"],
    ["held", holder, undefined, "held"],
    ["held", tree, "person-dev-server", "none"],
    ["held", unknown, "person-dev-server", "none"],
    ["releasing", tree, "serves-tree", "none"],
    ["releasing", holder, "turn-failed", "release-failed"],
    ["releasing", unknown, "turn-failed", "release-failed"],
    ["release-failed", tree, "serves-tree", "none"],
    ["release-failed", holder, undefined, "release-failed"],
    ["none", tree, undefined, "none"],
    ["requested", holder, undefined, "requested"],
  ] as const)("%s, serving %j → %s", (state, served, event, to) => {
    expect(claimEventFromServed(state, served, "backend")).toBe(event);
    if (event !== undefined) expect(claimTransition(state, event)).toEqual({ kind: "moved", to });
  });
});

describe("claimRequest", () => {
  // [the host's claim, whether backend has a copy there, outcome, answer, isError]
  it.each([
    [undefined, true, { kind: "requested" }, false],
    [{ state: "none", handle: null }, true, { kind: "requested" }, false],
    [{ state: "requested", handle: "backend" }, true, { kind: "pending" }, false],
    [{ state: "starting", handle: "backend" }, true, { kind: "pending" }, false],
    [{ state: "held", handle: "backend" }, true, { kind: "shown" }, false],
    [{ state: "requested", handle: "frontend" }, true, { kind: "busy", by: "frontend" }, true],
    [{ state: "held", handle: "frontend" }, true, { kind: "busy", by: "frontend" }, true],
    [{ state: "releasing", handle: "backend" }, true, { kind: "releasing" }, true],
    [{ state: "release-failed", handle: "frontend" }, true, { kind: "releasing" }, true],
    [undefined, false, { kind: "no-lane" }, true],
  ] as const)("%j (copy: %s) → %j", (claim, lane, outcome, isError) => {
    expect(claimRequest(claim, "backend", lane)).toEqual(outcome);
    const answer = showOnDevAnswer(outcome, "appdev");
    expect(answer.isError).toBe(isError);
    expect(answer.text).not.toBe("");
  });

  it("names the host and what happens next", () => {
    expect(showOnDevAnswer({ kind: "requested" }, "appdev").text).toBe(
      "Asked the person to show your copy on appdev. If they grant it, a short turn in this conversation restarts appdev's dev server from your copy.",
    );
    expect(showOnDevAnswer({ kind: "busy", by: "frontend" }, "appdev").text).toBe(
      "appdev is taken by @frontend's work; ask again once it is released.",
    );
  });
});

describe("holdsClaim", () => {
  it.each([
    [{ state: "held", handle: "backend" }, true],
    [{ state: "starting", handle: "backend" }, false],
    [{ state: "held", handle: "frontend" }, false],
    [undefined, false],
  ] as const)("%j → %s", (claim, holds) => {
    expect(holdsClaim(claim, "backend")).toBe(holds);
  });

  it("reads a stored claim by its member", () => {
    const row = {
      host: TEST_HOST,
      crew: "game",
      member: "backend",
      lane: "backend",
      state: "held",
      requestedAt: "2026-09-27T20:00:00.000Z",
      grantedBy: "user-1",
      grantedAt: "2026-09-27T20:01:00.000Z",
      expiresAt: null,
      releasedAt: null,
    } as const;
    expect(holdsClaim(claimOf(Option.some(row)), "backend")).toBe(true);
    expect(claimOf(Option.none())).toBeUndefined();
  });
});

/** A stand-in for zcp's dev server: a process in `cwd` whose pid is in the pidfile. */
const startDevServer = (pidFile: string, cwd: string): NodeChildProcess.ChildProcess => {
  const child = NodeChildProcess.spawn("sleep", ["30"], { cwd, stdio: "ignore" });
  NodeFS.writeFileSync(pidFile, `${child.pid}\n`);
  return child;
};

const withRuntime = <A, E>(
  body: (context: {
    readonly root: string;
    readonly pidFile: string;
  }) => Effect.Effect<A, E, CrewRuntime | CrewStore | CrewWorkspace.CrewWorkspace>,
) => {
  const pidFile = NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-crew-dev-")),
    "zcp-dev-server.log.pid",
  );
  return withCrewService(
    (root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create({ crew: "game", host: TEST_HOST, handle: "backend" });
        return yield* body({ root, pidFile });
      }),
    (root) =>
      Layer.effect(CrewRuntime, makeCrewRuntime({ devServerPidFile: pidFile })).pipe(
        Layer.provideMerge(crewGitLayer(root)),
      ),
  );
};

describe("CrewRuntime", () => {
  it.effect("reads what dev serves from its process's working directory", () =>
    withRuntime(({ root, pidFile }) =>
      Effect.gen(function* () {
        const runtime = yield* CrewRuntime;
        const nothing = yield* runtime.served(TEST_HOST);
        const lane = startDevServer(pidFile, NodePath.join(root, ".crew/backend"));
        const fromLane = yield* runtime
          .served(TEST_HOST)
          .pipe(Effect.ensuring(Effect.sync(() => lane.kill())));
        const tree = startDevServer(pidFile, root);
        const fromTree = yield* runtime
          .served(TEST_HOST)
          .pipe(Effect.ensuring(Effect.sync(() => tree.kill())));
        expect([nothing, fromLane, fromTree]).toEqual([
          { by: "unknown" },
          { by: "crewmate", handle: "backend" },
          { by: "tree" },
        ]);
      }),
    ),
  );

  it.effect("takes a claim from a request through held and back to the tree", () =>
    withRuntime(({ root, pidFile }) =>
      Effect.gen(function* () {
        const runtime = yield* CrewRuntime;
        const store = yield* CrewStore;
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create({ crew: "game", host: TEST_HOST, handle: "frontend" });
        const backend = { crew: "game", handle: "backend", host: TEST_HOST };
        const claim = () =>
          Effect.map(store.getClaim(TEST_HOST), (row) =>
            Option.match(row, {
              onNone: () => "none",
              onSome: (value) => `${value.state} ${value.member}`,
            }),
          );
        const seen: Array<unknown> = [];

        seen.push((yield* runtime.request(backend)).outcome, yield* claim());
        seen.push(
          (yield* runtime.request({ ...backend, handle: "frontend" })).outcome,
          (yield* runtime.request({ crew: "game", handle: "lead", host: undefined })).outcome,
        );
        yield* runtime.grant(TEST_HOST, "user-1");
        seen.push(
          yield* claim(),
          Option.map(yield* store.getClaim(TEST_HOST), (row) => row.grantedBy),
        );

        const lane = startDevServer(pidFile, NodePath.join(root, ".crew/backend"));
        yield* runtime.settle(TEST_HOST).pipe(Effect.ensuring(Effect.sync(() => lane.kill())));
        seen.push(yield* claim());

        yield* runtime.apply(TEST_HOST, "report");
        seen.push(yield* claim());
        const tree = startDevServer(pidFile, root);
        yield* runtime.settle(TEST_HOST).pipe(Effect.ensuring(Effect.sync(() => tree.kill())));
        seen.push(yield* claim());

        expect(seen).toEqual([
          { kind: "requested" },
          "requested backend",
          { kind: "busy", by: "backend" },
          { kind: "no-lane" },
          "starting backend",
          Option.some("user-1"),
          "held backend",
          "releasing backend",
          "none",
        ]);
      }),
    ),
  );

  it.effect("refuses an event the claim's state does not take", () =>
    withRuntime(() =>
      Effect.gen(function* () {
        const runtime = yield* CrewRuntime;
        const refused = yield* runtime.grant(TEST_HOST, "user-1").pipe(Effect.flip);
        expect(refused).toMatchObject({
          _tag: "CrewClaimRefused",
          host: TEST_HOST,
          state: "none",
          event: "grant",
        });
      }),
    ),
  );
});
