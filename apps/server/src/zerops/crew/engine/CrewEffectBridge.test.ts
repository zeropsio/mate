// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ConversationId,
  type ConversationAgent,
  type CrewCard,
  type Principal,
  type RunId,
} from "@t3tools/contracts";

import { handlersOf } from "../../../engine/outbox/EffectWorker.ts";
import type { HandlerResult } from "../../../engine/outbox/EffectWorker.ts";
import { EngineStore } from "../../../engine/store/EngineStore.ts";
import { engineLayer, tempDb } from "../../../engine/testing/world.ts";
import * as CrewWorkspace from "../CrewWorkspace.ts";
import { CrewPlatformProcesses } from "../crewDeployState.ts";
import {
  attempt,
  createLane,
  type CrewEffectServices,
  devServerPidFile,
  effectRow,
  okValue,
  personCommits,
  withCrewEffects,
} from "../testing/crewEffectFixture.ts";
import {
  exists,
  git,
  read,
  remoteEnvWithSetsid,
  TEST_HOST,
  waitUntil,
  write,
} from "../testing/crewGitFixture.ts";
import { makeCrewEngineEffectHandlers } from "./CrewEffectBridge.ts";
import { CrewDeliveryContext } from "./CrewDeliveryContext.ts";
import { CREW_EFFECT_KINDS, type CrewEffectKind, type CrewEffectPayload } from "./command.ts";
import { crewDeliveryLayer, CrewDelivery } from "./effects/deliver.ts";
import { laneKey } from "./effects/shared.ts";

const SETSID = { remoteEnv: remoteEnvWithSetsid() };
const BACKEND = ConversationId.make("crew-main-backend-1");
const ANA: Principal = { kind: "person", subject: "ana" };
const CREW: Principal = { kind: "crew", startedBy: "ana" };
const ASSIGNMENT = "task-1-k0";
const CARD: CrewCard = {
  kind: "task",
  taskId: "task-1",
  number: 1,
  title: "Add the score API",
  why: "Scores per player.",
  doneWhen: null,
  links: [],
};
const AGENT: ConversationAgent = {
  instanceId: "claude-ana",
  driver: "claudeAgent",
  model: "opus",
  profile: { kind: "crewmate", id: "backend", name: "Backend" },
};

/** A payload of `kind`, as the crew's decider asks for it. */
type Asked<K extends CrewEffectKind> = Omit<Extract<CrewEffectPayload, { kind: K }>, "kind">;

/** One attempt of the bridged handler for `kind`, on effect `n` (its `attempt`th try). */
const ask = <K extends CrewEffectKind>(
  kind: K,
  payload: Asked<K>,
  options: { readonly effect?: number; readonly attempt?: number } = {},
) =>
  Effect.gen(function* () {
    const handlers = handlersOf(...(yield* makeCrewEngineEffectHandlers));
    const handler = handlers.get(kind);
    if (handler === undefined) throw new Error(`no handler for ${kind}`);
    return yield* attempt(
      handler,
      effectRow(
        kind,
        { kind, ...payload },
        {
          effectId: `crew/main/e/${kind}/${options.effect ?? 1}`,
          attempt: options.attempt ?? 1,
          lane: `${CREW_EFFECT_KINDS[kind]}/backend`,
        },
      ),
    );
  });

const value = <K extends CrewEffectKind>(kind: K, payload: Asked<K>, effect = 1) =>
  Effect.map(ask(kind, payload, { effect }), okValue);

const lane = (root: string, handle = "backend") => `${root}/.crew/${handle}`;
const tipOf = (root: string, handle = "backend") => git(lane(root, handle), ["rev-parse", "HEAD"]);
const NO_ENV = { crewPort: null, env: {} } as const;

const checkpoint = (fields: Partial<Asked<"crew.checkpoint">> = {}): Asked<"crew.checkpoint"> => ({
  handle: "backend",
  taskId: "task-1",
  attempt: 1,
  purpose: "turn-end",
  assignment: ASSIGNMENT,
  turn: 1,
  checked: false,
  refTasks: [],
  ...fields,
});

const check = (fields: Partial<Asked<"crew.check">> = {}): Asked<"crew.check"> => ({
  handle: "backend",
  taskId: "task-1",
  attempt: 1,
  command: "true",
  setup: null,
  host: TEST_HOST,
  tip: null,
  ...NO_ENV,
  ...fields,
});

const SPEC = { handle: "backend", setup: null, ...NO_ENV } as const;

/** A copy with one saved turn on it: work a landing takes. */
const savedWork = (root: string) =>
  Effect.gen(function* () {
    const workspace = yield* CrewWorkspace.CrewWorkspace;
    yield* createLane("backend");
    write(lane(root), "src/score.ts", "export const score = 1;\n");
    yield* workspace.commitTurn(laneKey("backend"), { assignment: ASSIGNMENT, turn: 1 });
  });

/** A copy whose saved turn landed on your tree. */
const landedWork = (root: string) =>
  Effect.gen(function* () {
    yield* savedWork(root);
    yield* value("crew.land", {
      handle: "backend",
      taskId: "task-1",
      attempt: 1,
      title: "Add the score API",
      checkedTip: null,
      assignment: ASSIGNMENT,
    });
  });

/** zcp's dev server as its pidfile names it, run from `cwd` until the scope closes. */
const devServer = (root: string, cwd: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const child = NodeChildProcess.spawn("sleep", ["30"], { cwd, stdio: "ignore" });
      NodeFS.writeFileSync(devServerPidFile(root), `${child.pid}\n`);
      return child;
    }),
    (child) =>
      Effect.sync(() => {
        child.kill("SIGKILL");
        NodeFS.rmSync(devServerPidFile(root), { force: true });
      }),
  );

/* ------------------------------------------------------------ ports */

/** What the deliveries told, and what the platform answers. */
interface Told {
  readonly envelopes: Array<unknown>;
  platform: ReadonlyArray<unknown> | undefined;
}

const ports = <A = never, E = never>(told: Told, delivery?: Layer.Layer<A | CrewDelivery, E>) =>
  Layer.mergeAll(
    Layer.succeed(CrewPlatformProcesses, { read: Effect.sync(() => told.platform) }),
    delivery ??
      Layer.succeed(CrewDelivery, {
        deliver: (envelope) =>
          Effect.sync(() => {
            told.envelopes.push(envelope);
            return { _tag: "Accepted", seq: 1 } as const;
          }),
      }),
    Layer.succeed(CrewDeliveryContext, {
      seed: ({ handle, taskId }) =>
        Effect.succeed(`packet of @${handle} on ${taskId ?? "nothing"}`),
      agentOf: (asked) => Effect.succeed(asked.instanceId === AGENT.instanceId ? AGENT : undefined),
      seamWords: (seam) => (seam.seam === "landed" ? `#${seam.number} landed.` : null),
    }),
  );

type Services = CrewEffectServices | CrewPlatformProcesses | CrewDelivery | CrewDeliveryContext;

interface Row {
  readonly sentence: string;
  readonly scene: (root: string, told: Told) => Effect.Effect<unknown, Error, Services>;
  readonly expected: (root: string) => unknown;
}

const scene = (body: Row["scene"]) => body;

/* ------------------------------------------------------------ git rows */

const rows: ReadonlyArray<Row> = [
  {
    sentence: "a copy the crew asks for reads as ready once its setup passed",
    scene: scene(() =>
      value("crew.lane.create", {
        handle: "backend",
        host: TEST_HOST,
        branch: "crew/backend",
        setup: "true",
        ...NO_ENV,
      }),
    ),
    expected: () => ({ _tag: "ready" }),
  },
  {
    sentence: "a copy whose setup failed reads as failed, in its setup's words",
    scene: scene(() =>
      value("crew.lane.create", {
        handle: "backend",
        host: TEST_HOST,
        branch: "crew/backend",
        setup: "echo no lockfile; exit 3",
        ...NO_ENV,
      }),
    ),
    expected: () => ({
      _tag: "failed",
      detail: "setup (echo no lockfile; exit 3) failed: no lockfile",
    }),
  },
  {
    sentence:
      "a task's start on a copy whose work all landed resets it to your tree's head, and says so",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* landedWork(root);
        const head = personCommits(root, "src/hud.ts", "hud\n");
        const reset = yield* value("crew.lane.reset", {
          handle: "backend",
          taskId: "task-2",
          attempt: 1,
        });
        return { reset, copy: tipOf(root) === head };
      }),
    ),
    expected: (root) => ({
      reset: {
        _tag: "ready",
        resetTo: git(root, ["rev-parse", "HEAD"]),
        stats: { ahead: 0, insertions: 0, deletions: 0, dirty: false },
      },
      copy: true,
    }),
  },
  {
    sentence: "a task's start on a copy that still has preserved edits reads as dirty",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* landedWork(root);
        personCommits(root, "src/hud.ts", "hud\n");
        write(lane(root), "README.md", "preserved\n");
        return yield* value("crew.lane.reset", { handle: "backend", taskId: "task-2", attempt: 1 });
      }),
    ),
    expected: () => ({ _tag: "dirty" }),
  },
  {
    sentence: "a task's start on a copy moved outside the engine reads as moved",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        write(lane(root), "src/stray.ts", "stray\n");
        git(lane(root), ["add", "-A"]);
        git(lane(root), ["commit", "-q", "-m", "a hand-made commit"]);
        return yield* value("crew.lane.reset", { handle: "backend", taskId: "task-1", attempt: 1 });
      }),
    ),
    expected: () => ({ _tag: "moved" }),
  },
  {
    sentence: "a discard keeps the attempt aside, resets the copy and reads as kept",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        const start = tipOf(root);
        write(lane(root), "src/score.ts", "export const score = 1;\n");
        const kept = yield* value("crew.lane.keep", {
          handle: "backend",
          taskId: "task-1",
          attempt: 1,
          assignment: ASSIGNMENT,
          run: "run-1",
        });
        const ref = git(root, ["rev-parse", `refs/t3/crew/run-1/${ASSIGNMENT}/1`]);
        return {
          kept,
          copyAtStart: tipOf(root) === start,
          refHolds: git(root, ["show", `${ref}:src/score.ts`]),
        };
      }),
    ),
    expected: () => ({
      kept: { _tag: "kept" },
      copyAtStart: true,
      refHolds: "export const score = 1;",
    }),
  },
  {
    sentence: "a discard of a copy that is gone reads as kept: nothing is left to keep",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        NodeFS.rmSync(lane(root), { recursive: true, force: true });
        return yield* value("crew.lane.keep", {
          handle: "backend",
          taskId: "task-1",
          attempt: 1,
          assignment: ASSIGNMENT,
          run: null,
        });
      }),
    ),
    expected: () => ({ _tag: "kept" }),
  },
  {
    sentence: "a crewmate's removal takes its clean copy away, and a re-run reads it removed",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        const removed = yield* value("crew.lane.remove", {
          handle: "backend",
          discardUnlanded: false,
        });
        const again = yield* value("crew.lane.remove", {
          handle: "backend",
          discardUnlanded: false,
        });
        return { removed, again, copy: exists(root, ".crew/backend") };
      }),
    ),
    expected: () => ({
      removed: { _tag: "removed" },
      again: { _tag: "removed" },
      copy: false,
    }),
  },
  {
    sentence: "a crewmate's removal keeps a copy with work not landed",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* savedWork(root);
        const kept = yield* value("crew.lane.remove", {
          handle: "backend",
          discardUnlanded: false,
        });
        return { kept, copy: exists(root, ".crew/backend") };
      }),
    ),
    expected: () => ({ kept: { _tag: "unlanded-commits" }, copy: true }),
  },
  {
    sentence: "a turn's save the decider asked for reads as committed with the copy's stats",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        write(lane(root), "src/score.ts", "export const score = 1;\n");
        const saved = yield* value("crew.checkpoint", checkpoint({ turn: 2 }));
        return { saved, subject: git(lane(root), ["log", "-1", "--format=%s"]) };
      }),
    ),
    expected: () => ({
      saved: {
        _tag: "committed",
        stats: { ahead: 1, insertions: 1, deletions: 0, dirty: false },
      },
      subject: `wip(${ASSIGNMENT}): turn 2`,
    }),
  },
  {
    sentence:
      "a turn's save its earlier attempt finished before a restart reads as committed, never twice",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        const start = tipOf(root);
        write(lane(root), "src/score.ts", "export const score = 1;\n");
        // The service finished the commit; the Mate stopped before the effect settled.
        git(lane(root), ["add", "-A"]);
        git(lane(root), [
          "commit",
          "-q",
          "-m",
          `wip(${ASSIGNMENT}): turn 1\n\nCrew-Operation: crew/main/e/crew.checkpoint/1`,
        ]);
        const adopted = yield* ask("crew.checkpoint", checkpoint(), { attempt: 2 });
        return {
          adopted: okValue(adopted),
          commits: git(lane(root), ["rev-list", "--count", `${start}..HEAD`]),
        };
      }),
    ),
    expected: () => ({
      adopted: {
        _tag: "committed",
        stats: { ahead: 1, insertions: 1, deletions: 0, dirty: false },
      },
      commits: "1",
    }),
  },
  {
    sentence: "a turn's save that finds a secret file parks its task in the guard's words",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        write(lane(root), ".env", "TOKEN=1\n");
        return yield* value("crew.checkpoint", checkpoint());
      }),
    ),
    // The copy reads as the guard left it: dirty with what it held back.
    expected: () => ({
      _tag: "park",
      detail: "the WIP commit stopped on a secret file: .env",
      stats: { ahead: 0, insertions: 0, deletions: 0, dirty: true },
    }),
  },
  {
    sentence: "a turn's save on a checked copy with edits reads as edited after its check",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        write(lane(root), "README.md", "edited after the check\n");
        return yield* value("crew.checkpoint", checkpoint({ checked: true }));
      }),
    ),
    expected: () => ({
      _tag: "edited-after-check",
      stats: { ahead: 0, insertions: 0, deletions: 0, dirty: true },
    }),
  },
  {
    sentence:
      "a ref the engine wrote for a task is never blamed on a turn; one moved outside it parks the task",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        yield* value("crew.lane.reset", { handle: "backend", taskId: "task-1", attempt: 1 });
        const head = git(root, ["rev-parse", "HEAD"]);
        git(root, ["update-ref", `refs/t3/crew/run-1/task-2-k1/1`, head]);
        write(lane(root), "src/score.ts", "export const score = 1;\n");
        const explained = yield* value(
          "crew.checkpoint",
          checkpoint({ refTasks: [{ assignment: "task-2-k1", run: "run-1", attempt: 1 }] }),
          1,
        );
        write(lane(root), "src/score.ts", "export const score = 2;\n");
        const blamed = yield* value("crew.checkpoint", checkpoint(), 2);
        return [explained, blamed];
      }),
    ),
    expected: () => [
      { _tag: "committed", stats: { ahead: 1, insertions: 1, deletions: 0, dirty: false } },
      {
        _tag: "park",
        detail: "a ref changed outside the engine: refs/t3/crew/run-1/task-2-k1/1",
        stats: { ahead: 2, insertions: 1, deletions: 0, dirty: false },
      },
    ],
  },
  {
    sentence: "a merge-in reads as merged with the tree its check is for",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* savedWork(root);
        const head = personCommits(root, "src/hud.ts", "hud\n");
        const merged = yield* value("crew.mergeIn", {
          handle: "backend",
          taskId: "task-1",
          attempt: 1,
        });
        return { merged, head, tip: tipOf(root) };
      }),
    ),
    expected: (root) => {
      const tip = git(lane(root), ["rev-parse", "HEAD"]);
      return {
        merged: {
          _tag: "merged",
          head: git(root, ["rev-parse", "HEAD"]),
          tip,
          lockfileChanged: false,
          stats: { ahead: 2, insertions: 1, deletions: 0, dirty: false },
        },
        head: git(root, ["rev-parse", "HEAD"]),
        tip,
      };
    },
  },
  {
    sentence: "a merge-in that conflicts reads as a conflict naming its files",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* savedWork(root);
        personCommits(root, "src/score.ts", "export const score = 2;\n");
        return yield* value("crew.mergeIn", { handle: "backend", taskId: "task-1", attempt: 1 });
      }),
    ),
    expected: (root) => ({
      _tag: "conflict",
      head: git(root, ["rev-parse", "HEAD"]),
      paths: ["src/score.ts"],
    }),
  },
  {
    sentence: "a check the decider asked for passes on the tree it was asked for, naming it",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        return yield* value("crew.check", check({ tip: tipOf(root) }));
      }),
    ),
    expected: (root) => ({ _tag: "passed", tail: "", tip: git(lane(root), ["rev-parse", "HEAD"]) }),
  },
  {
    sentence: "a check on a copy that moved since reads as moved, and nothing is checked",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        const moved = yield* value(
          "crew.check",
          check({ tip: "0".repeat(40), command: "touch ../checked" }),
        );
        return { moved, checked: exists(root, ".crew/checked") };
      }),
    ),
    expected: () => ({ moved: { _tag: "moved" }, checked: false }),
  },
  {
    sentence: "a failed check reads as failed with its output",
    scene: scene(() =>
      Effect.gen(function* () {
        yield* createLane("backend");
        return yield* value("crew.check", check({ command: "echo FAIL score.test.ts; exit 1" }));
      }),
    ),
    expected: () => ({ _tag: "failed", tail: "FAIL score.test.ts\n" }),
  },
  {
    sentence: "a check whose setup failed reads as setup failed, and the check never runs",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        const failed = yield* value(
          "crew.check",
          check({ setup: "exit 2", command: "touch ../checked" }),
        );
        return { failed, checked: exists(root, ".crew/checked") };
      }),
    ),
    expected: () => ({ failed: { _tag: "setup-failed" }, checked: false }),
  },
  {
    sentence: "a landing the decider asked for lands once and reads as landed with its commit",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* savedWork(root);
        const payload: Asked<"crew.land"> = {
          handle: "backend",
          taskId: "task-1",
          attempt: 1,
          title: "Add the score API",
          checkedTip: tipOf(root),
          assignment: ASSIGNMENT,
        };
        const landed = yield* value("crew.land", payload);
        const again = yield* value("crew.land", payload);
        return { landed, again };
      }),
    ),
    expected: (root) => {
      const commit = git(root, ["rev-parse", "HEAD"]);
      const stats = { ahead: 0, insertions: 0, deletions: 0, dirty: false };
      return {
        landed: { _tag: "landed", commit, stats },
        again: { _tag: "already-landed", commit, stats },
      };
    },
  },
  {
    sentence: "a landing over an untracked file in your tree waits on your tree, naming the file",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* savedWork(root);
        write(root, "src/score.ts", "the person's own edit\n");
        return yield* value("crew.land", {
          handle: "backend",
          taskId: "task-1",
          attempt: 1,
          title: "Add the score API",
          checkedTip: null,
          assignment: ASSIGNMENT,
        });
      }),
    ),
    expected: () => ({ _tag: "untracked-in-way", paths: ["src/score.ts"] }),
  },
  {
    sentence: "a landing of a copy that moved after its check lands nothing",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* savedWork(root);
        return yield* value("crew.land", {
          handle: "backend",
          taskId: "task-1",
          attempt: 1,
          title: "Add the score API",
          checkedTip: "0".repeat(40),
          assignment: ASSIGNMENT,
        });
      }),
    ),
    expected: () => ({ _tag: "unchecked" }),
  },
  {
    sentence: "the claim read names what dev serves, its dev server, and the copy's directory",
    scene: scene((root) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* createLane("backend");
          write(
            root,
            "zerops.yaml",
            "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n",
          );
          yield* devServer(root, lane(root));
          return yield* value("crew.claim.read", {
            host: TEST_HOST,
            handle: "backend",
            purpose: "grant",
          });
        }),
      ),
    ),
    expected: (root) => ({
      served: { by: "crewmate", handle: "backend" },
      devServer: { port: 3000, command: "sleep 30" },
      workDir: `${root}/.crew/backend`,
    }),
  },
  {
    sentence: "the claim read a flip's import asks reads the host as a grant's does",
    scene: scene((root) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* createLane("backend");
          write(
            root,
            "zerops.yaml",
            "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n",
          );
          yield* devServer(root, lane(root));
          return yield* value("crew.claim.read", {
            host: TEST_HOST,
            handle: "backend",
            purpose: "import",
          });
        }),
      ),
    ),
    expected: (root) => ({
      served: { by: "crewmate", handle: "backend" },
      devServer: { port: 3000, command: "sleep 30" },
      workDir: `${root}/.crew/backend`,
    }),
  },
  {
    sentence: "a crewmate's app runs on its crew port, and stops",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        const running = yield* value("crew.app.run", {
          handle: "backend",
          host: TEST_HOST,
          command: 'echo "$CREW_PORT" > ../backend.port; exec sleep 30',
          crewPort: 3001,
          env: {},
        });
        waitUntil(() => exists(root, ".crew/backend.port"));
        const stopped = yield* value("crew.app.stop", { handle: "backend", host: TEST_HOST });
        return { running, port: read(root, ".crew/backend.port").trim(), stopped };
      }),
    ),
    expected: () => ({
      running: { state: "running" },
      port: "3001",
      stopped: { state: "stopped" },
    }),
  },
  {
    sentence:
      "a redeploy still running reads as running, one that ended as ended, an unread one as unreadable",
    scene: scene((_root, told) =>
      Effect.gen(function* () {
        const poll = () => value("crew.deploy.poll", { host: TEST_HOST });
        const deploy = (status: string) => [
          { serviceStackName: TEST_HOST, actionName: "stack.deploy", status },
        ];
        told.platform = deploy("RUNNING");
        const running = yield* poll();
        told.platform = deploy("FINISHED");
        const ended = yield* poll();
        told.platform = undefined;
        const unreadable = yield* poll();
        return [running, ended, unreadable];
      }),
    ),
    expected: () => [{ phase: "running" }, { phase: "ended" }, { phase: "unreadable" }],
  },
  {
    sentence: "a copy a redeploy took is brought back; one whose branch is gone reads as lost",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        NodeFS.rmSync(lane(root), { recursive: true, force: true });
        const back = yield* value("crew.recover", {
          host: TEST_HOST,
          handles: ["backend"],
          specs: [SPEC],
          landings: [],
        });
        const copy = exists(root, ".crew/backend");
        NodeFS.rmSync(lane(root), { recursive: true, force: true });
        git(root, ["worktree", "prune"]);
        git(root, ["branch", "-q", "-D", "crew/backend"]);
        const gone = yield* value(
          "crew.recover",
          { host: TEST_HOST, handles: ["backend"], specs: [SPEC], landings: [] },
          2,
        );
        return { back, copy, gone };
      }),
    ),
    expected: () => ({
      back: { lost: [], losses: [] },
      copy: true,
      gone: { lost: ["backend"], losses: ["crew/backend"] },
    }),
  },
  {
    sentence: "a recovery that finds a landing gone brings nothing back and reads its copies lost",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        NodeFS.rmSync(lane(root), { recursive: true, force: true });
        return yield* value("crew.recover", {
          host: TEST_HOST,
          handles: ["backend"],
          specs: [SPEC],
          landings: [{ assignment: "task-9-k9", title: "A landing your tree lost" }],
        });
      }),
    ),
    expected: () => ({ lost: ["backend"], losses: ["landing of A landing your tree lost"] }),
  },
  {
    sentence: "work a restart left in a copy is saved, and the decider reads its files",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        write(lane(root), "src/left.ts", "left\n");
        return yield* value("crew.sweep", { handle: "backend", host: TEST_HOST, checked: false });
      }),
    ),
    expected: (root) => ({
      swept: true,
      stats: { ahead: 1, insertions: 1, deletions: 0, dirty: false },
      copy: {
        _tag: "committed",
        commit: git(lane(root), ["rev-parse", "HEAD"]),
        paths: ["src/left.ts"],
      },
    }),
  },
  {
    sentence: "one copy's sweep never commits another crewmate's copy",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        yield* createLane("frontend");
        write(lane(root, "frontend"), "src/busy.ts", "mid-turn\n");
        const swept = yield* value("crew.sweep", {
          handle: "backend",
          host: TEST_HOST,
          checked: false,
        });
        return { swept, frontend: git(lane(root, "frontend"), ["status", "--porcelain"]) };
      }),
    ),
    expected: () => ({
      swept: {
        swept: false,
        stats: { ahead: 0, insertions: 0, deletions: 0, dirty: false },
        copy: { _tag: "clean" },
      },
      frontend: "?? src/",
    }),
  },
  {
    sentence: "edits on a checked copy a restart found are held, never committed",
    scene: scene((root) =>
      Effect.gen(function* () {
        yield* createLane("backend");
        write(lane(root), "README.md", "edited after the check\n");
        const swept = yield* value("crew.sweep", {
          handle: "backend",
          host: TEST_HOST,
          checked: true,
        });
        return { copy: (swept as { readonly copy: unknown }).copy };
      }),
    ),
    expected: () => ({ copy: { _tag: "held" } }),
  },
];

/* ------------------------------------------------------------ delivery rows */

const deliver = (
  command: Asked<"crew.deliver">["command"],
  principal: Principal = ANA,
  effect = 1,
) =>
  ask(
    "crew.deliver",
    { conversationId: BACKEND, handle: "backend", command, principal },
    { effect },
  );

const deliveries: ReadonlyArray<Row> = [
  {
    sentence: "a delivery of a person's message queues a run of theirs with its words",
    scene: scene((_root, told) =>
      Effect.gen(function* () {
        const result = yield* deliver({
          _tag: "Send",
          text: "Also sort them.",
          card: null,
          principal: ANA,
        });
        return { result, told: told.envelopes };
      }),
    ),
    expected: () => ({
      result: { _tag: "Done", outcome: { kind: "ok", value: { seq: 1 } } },
      told: [
        {
          commandId: "crew-deliver:crew/main/e/crew.deliver/1",
          conversationId: BACKEND,
          principal: ANA,
          command: { _tag: "Send", text: "Also sort them." },
        },
      ],
    }),
  },
  {
    sentence: "a new session starts from the crewmate's packet when the crew gave it no seed",
    scene: scene((_root, told) =>
      Effect.gen(function* () {
        yield* deliver(
          {
            _tag: "RotateSession",
            reason: "task",
            fresh: true,
            seed: null,
            packet: { handle: "backend", taskId: "task-1" },
          },
          CREW,
        );
        return told.envelopes.map((envelope) => (envelope as { command: unknown }).command);
      }),
    ),
    expected: () => [
      {
        _tag: "RotateSession",
        reason: "task",
        fresh: true,
        seed: "packet of @backend on task-1",
      },
    ],
  },
  {
    sentence: "a crewmate's agent is the one its login runs",
    scene: scene((_root, told) =>
      Effect.gen(function* () {
        yield* deliver({
          _tag: "AssignAgent",
          instanceId: AGENT.instanceId,
          model: "opus",
          effort: null,
          profile: AGENT.profile as Extract<
            Asked<"crew.deliver">["command"],
            { _tag: "AssignAgent" }
          >["profile"],
        });
        return told.envelopes.map((envelope) => (envelope as { command: unknown }).command);
      }),
    ),
    expected: () => [{ _tag: "AssignAgent", agent: AGENT }],
  },
  {
    sentence: "an agent no live login serves fails the assignment for good, naming the login",
    scene: scene((_root, told) =>
      Effect.gen(function* () {
        const result = yield* deliver({
          _tag: "AssignAgent",
          instanceId: "codex-gone",
          model: null,
          effort: null,
          profile: { kind: "crewmate", id: "backend", name: "Backend" },
        });
        return { result, told: told.envelopes.length };
      }),
    ),
    expected: () => ({
      result: {
        _tag: "Done",
        outcome: {
          kind: "failed",
          reason: "no signed-in agent runs the login codex-gone",
          refused: true,
        },
      },
      told: 0,
    }),
  },
  {
    sentence: "a seam is marked in the crewmate's chat with its words",
    scene: scene((_root, told) =>
      Effect.gen(function* () {
        yield* deliver(
          {
            _tag: "Seam",
            seam: { seam: "landed", taskId: "task-1", number: 1, commit: "abc1234" },
          },
          { kind: "engine" },
        );
        return told.envelopes.map((envelope) => (envelope as { command: unknown }).command);
      }),
    ),
    expected: () => [
      {
        _tag: "MarkSeam",
        seam: { seam: "landed", taskId: "task-1", number: 1, commit: "abc1234" },
        words: "#1 landed.",
      },
    ],
  },
];

/** The crewmate's conversation as the engine recorded it. */
const recorded = Effect.flatMap(EngineStore, (store) => store.events(BACKEND, 0));

describe("the crew's effects on the git core", () => {
  it.effect("every kind the crew asks for has exactly one handler", () =>
    withCrewEffects(() =>
      Effect.gen(function* () {
        const handlers = yield* makeCrewEngineEffectHandlers;
        const kinds = handlers.map((handler) => handler.kind);
        assert.deepStrictEqual(
          {
            unique: new Set(kinds).size === kinds.length,
            crew: Object.keys(CREW_EFFECT_KINDS).every((kind) => kinds.includes(kind)),
            besides: kinds.filter((kind) => !(kind in CREW_EFFECT_KINDS)).toSorted(),
          },
          { unique: true, crew: true, besides: ["crew.inspect"] },
        );
      }).pipe(Effect.provide(ports({ envelopes: [], platform: undefined }))),
    ),
  );

  for (const row of [...rows, ...deliveries]) {
    it.effect(row.sentence, () => {
      const told: Told = { envelopes: [], platform: undefined };
      return withCrewEffects(
        (root) =>
          Effect.map(row.scene(root, told).pipe(Effect.provide(ports(told))), (actual) => {
            assert.deepStrictEqual(actual, row.expected(root));
          }),
        SETSID,
      );
    });
  }

  it.effect("a delivery of a card queues a run whose first item is the card", () =>
    withCrewEffects(() =>
      Effect.gen(function* () {
        const result = yield* deliver({
          _tag: "Send",
          text: "[Crew task card]\n#1 Add the score API",
          card: CARD,
          principal: CREW,
        });
        const opened = (yield* recorded).flatMap((event) =>
          event._tag === "ItemOpened" ? [event.body] : [],
        );
        assert.deepStrictEqual(
          { ok: result._tag === "Done" && result.outcome.kind === "ok", first: opened[0] },
          {
            ok: true,
            first: {
              kind: "note",
              text: "[Crew task card]\n#1 Add the score API",
              streaming: false,
              answer: false,
              card: CARD,
            },
          },
        );
      }).pipe(
        Effect.provide(
          ports(
            { envelopes: [], platform: undefined },
            Layer.provideMerge(
              crewDeliveryLayer,
              engineLayer(tempDb("crew-bridge-card"), handlersOf()),
            ),
          ),
        ),
      ),
    ),
  );

  it.effect("a Stop on a run that already ended settles, never fails", () =>
    withCrewEffects(() =>
      Effect.gen(function* () {
        const sent = okValue(
          yield* deliver({ _tag: "Send", text: "Go on.", card: null, principal: ANA }),
        ) as { readonly runId: RunId };
        const stops: Array<HandlerResult> = [];
        // The first ends the queued run; the second finds it ended; the third finds none running.
        stops.push(yield* deliver({ _tag: "Stop", runId: sent.runId }, ANA, 2));
        stops.push(yield* deliver({ _tag: "Stop", runId: sent.runId }, ANA, 3));
        stops.push(yield* deliver({ _tag: "Stop", runId: null }, ANA, 4));
        return stops.map((stop) => (stop._tag === "Done" ? stop.outcome.kind : stop._tag));
      }).pipe(
        Effect.map((stops) => assert.deepStrictEqual(stops, ["ok", "ok", "ok"])),
        Effect.provide(
          ports(
            { envelopes: [], platform: undefined },
            Layer.provideMerge(
              crewDeliveryLayer,
              engineLayer(tempDb("crew-bridge-stop"), handlersOf()),
            ),
          ),
        ),
      ),
    ),
  );
});
