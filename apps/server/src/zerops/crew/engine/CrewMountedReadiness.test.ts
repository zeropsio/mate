// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { handlersOf } from "../../../engine/outbox/EffectWorker.ts";
import { CrewStore } from "../CrewStore.ts";
import { CrewWorkspace } from "../CrewWorkspace.ts";
import { attempt, crewEffectLayer, effectRow, okValue } from "../testing/crewEffectFixture.ts";
import {
  git,
  read,
  TEST_HOST,
  withCrewService,
  write,
  zcpDeploys,
} from "../testing/crewGitFixture.ts";
import { makeCrewEngineEffectHandlers } from "./CrewEffectBridge.ts";
import { CrewPlatformProcesses } from "../crewDeployState.ts";
import { CrewDeliveryContext } from "./CrewDeliveryContext.ts";
import { CrewDelivery } from "./effects/deliver.ts";
import { laneKey } from "./effects/shared.ts";

const handlersEffect = makeCrewEngineEffectHandlers.pipe(
  Effect.provideService(CrewPlatformProcesses, { read: Effect.succeed([]) }),
  Effect.provideService(CrewDeliveryContext, {
    seed: () => Effect.succeed("packet"),
    agentOf: () => Effect.succeed(undefined),
    seamWords: () => null,
  }),
  Effect.provideService(CrewDelivery, {
    deliver: () => Effect.succeed({ _tag: "Accepted", seq: 1 }),
  }),
);

const KEY = laneKey("backend");
const spec = { ...KEY, host: TEST_HOST };
const create = effectRow("crew.lane.create", {
  kind: "crew.lane.create",
  handle: "backend",
  host: TEST_HOST,
  branch: "crew/backend",
  setup: "touch setup-ran",
  crewPort: null,
  env: {},
});
const recover = effectRow("crew.recover", {
  kind: "crew.recover",
  host: TEST_HOST,
  handles: ["backend"],
  landings: [],
  specs: [{ handle: "backend", setup: "touch setup-ran", crewPort: null, env: {} }],
});

const hideMount = (root: string) => {
  NodeFS.unlinkSync(`${root}/view`);
  // Existence alone cannot prove this is a usable working directory.
  write(root, "view/.crew/backend", "unreadable mount entry");
};
const showMount = (root: string) => {
  NodeFS.rmSync(`${root}/view`, { recursive: true, force: true });
  NodeFS.symlinkSync(root, `${root}/view`);
};
const layer = (root: string) => {
  NodeFS.symlinkSync(root, `${root}/view`);
  return crewEffectLayer(root, { mountPath: `${root}/view` });
};

it.effect.each(["first creation", "unrecorded replay", "recorded replay"])(
  "a mounted copy stays pending during %s until its directory is usable",
  (path) =>
    withCrewService(
      (root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace;
          const store = yield* CrewStore;
          const handlers = handlersOf(...(yield* handlersEffect));
          const handler = handlers.get(create.kind)!;
          if (path !== "first creation") {
            yield* workspace.create(spec);
            write(root, ".crew/backend/wip.txt", "saved work\n");
            if (path === "unrecorded replay") yield* store.deleteLane(KEY.crew, KEY.handle);
          }
          const before = yield* store.getLane(KEY.crew, KEY.handle);
          hideMount(root);
          const pending = yield* attempt(handler, create);
          assert.deepStrictEqual(
            {
              result: pending._tag,
              pending: pending._tag === "Retry" && pending.pending,
              setup: NodeFS.existsSync(`${root}/.crew/backend/setup-ran`),
            },
            { result: "Retry", pending: true, setup: false },
          );
          assert.deepStrictEqual(yield* store.getLane(KEY.crew, KEY.handle), before);
          const tip = git(root, ["rev-parse", "crew/backend"]);
          showMount(root);
          assert.deepStrictEqual(okValue(yield* attempt(handler, { ...create, attempt: 2 })), {
            _tag: "ready",
          });
          const after = Option.getOrThrow(yield* store.getLane(KEY.crew, KEY.handle));
          assert.strictEqual(after.recordedTip, tip);
          if (path !== "first creation")
            assert.strictEqual(read(root, ".crew/backend/wip.txt"), "saved work\n");
        }),
      layer,
    ),
);

it.effect.each([
  {
    title: "Recovery does not thaw a copy into ready solely because its remote directory exists.",
    readd: false,
  },
  { title: "a re-added copy keeps its saved work while recovery waits for its mount", readd: true },
])("$title", ({ readd }) =>
  withCrewService(
    (root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace;
        const store = yield* CrewStore;
        const handlers = handlersOf(...(yield* handlersEffect));
        const handler = handlers.get(recover.kind)!;
        yield* workspace.create(spec);
        write(root, ".crew/backend/wip.txt", "saved work\n");
        yield* workspace.freeze(TEST_HOST);
        if (readd) {
          zcpDeploys(root);
          NodeFS.rmSync(`${root}/.crew`, { recursive: true });
        }
        const before = Option.getOrThrow(yield* store.getLane(KEY.crew, KEY.handle));
        hideMount(root);
        const result = yield* attempt(handler, recover);
        assert.deepStrictEqual(
          {
            result: result._tag,
            pending: result._tag === "Retry" && result.pending,
            frozen: Option.getOrThrow(yield* store.getLane(KEY.crew, KEY.handle)).frozenSince,
          },
          { result: "Retry", pending: true, frozen: before.frozenSince },
        );
        showMount(root);
        assert.deepStrictEqual(okValue(yield* attempt(handler, { ...recover, attempt: 2 })), {
          lost: [],
          losses: [],
        });
        assert.strictEqual(
          Option.getOrThrow(yield* store.getLane(KEY.crew, KEY.handle)).frozenSince,
          null,
        );
        assert.strictEqual(read(root, ".crew/backend/wip.txt"), "saved work\n");
      }),
    layer,
  ),
);

it.effect.each([false, true])(
  "a rebuild waits for its mounted copy, including replay after re-add: %s",
  (readd) =>
    withCrewService(
      (root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace;
          const store = yield* CrewStore;
          yield* workspace.create(spec);
          const before = Option.getOrThrow(yield* store.getLane(KEY.crew, KEY.handle));
          yield* workspace.freeze(TEST_HOST);
          if (readd) NodeFS.rmSync(`${root}/.crew`, { recursive: true });
          hideMount(root);
          assert.deepStrictEqual(yield* workspace.rebuild(KEY), { _tag: "mount-unseen" });
          assert.notStrictEqual(
            Option.getOrThrow(yield* store.getLane(KEY.crew, KEY.handle)).frozenSince,
            null,
          );
          showMount(root);
          assert.deepStrictEqual(yield* workspace.rebuild(KEY), { _tag: "present" });
          const after = Option.getOrThrow(yield* store.getLane(KEY.crew, KEY.handle));
          assert.deepStrictEqual(
            {
              tip: after.recordedTip,
              branch: after.branch,
              frozen: after.frozenSince,
              state: after.state,
            },
            { tip: before.recordedTip, branch: before.branch, frozen: null, state: "ready" },
          );
        }),
      layer,
    ),
);
