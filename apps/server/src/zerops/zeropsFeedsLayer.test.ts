import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  ShowcaseSceneJson,
  SHOWCASE_SCENE_IDS,
  loadShowcaseScene,
} from "@t3tools/shared/showcaseScenes";

import * as ServerConfig from "../config.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import { loadFixtureScene } from "./ZeropsFixtureFeeds.ts";
import { selectZeropsFeedsLayer, ZeropsLayerLive } from "./zeropsFeedsLayer.ts";

const encodeScene = Schema.encodeSync(Schema.fromJsonString(ShowcaseSceneJson));

it.layer(NodeServices.layer)("zerops feed layer selection", (it) => {
  it.effect("loads a configured scene without constructing live feed dependencies", () =>
    Effect.gen(function* () {
      const selected = yield* selectZeropsFeedsLayer("web:service-map-live");
      assert.equal(selected.kind, "fixture");
      if (selected.kind !== "fixture") {
        return;
      }
      const agentAuth = yield* ZeropsAgentAuth.ZeropsAgentAuth.pipe(Effect.provide(selected.layer));

      assert.deepEqual(
        (yield* agentAuth.latest).agents.map((agent) => agent.agentId),
        ["claude-code", "codex"],
      );
    }),
  );

  it.effect("selects the live layer when fixtures are not configured", () =>
    Effect.gen(function* () {
      const selected = yield* selectZeropsFeedsLayer(undefined);
      assert.equal(selected.kind, "live");
      assert.isTrue(Layer.isLayer(selected.layer));
    }),
  );

  it.effect("wires fixture config without constructing live feed dependencies", () =>
    Effect.gen(function* () {
      // `Layer.unwrap` retains the live branch's requirements in its static
      // type; this configured branch proves they are not requested at runtime.
      // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
      const agentAuth = yield* ZeropsAgentAuth.ZeropsAgentAuth.pipe(
        Effect.provide(ZeropsLayerLive),
        Effect.orDie,
      ) as Effect.Effect<
        ZeropsAgentAuth.ZeropsAgentAuth["Service"],
        never,
        ServerConfig.ServerConfig
      >;
      assert.deepEqual(
        (yield* agentAuth.latest).agents.map((agent) => agent.agentId),
        ["claude-code", "codex"],
      );
    }).pipe(
      Effect.provide(
        Layer.effect(
          ServerConfig.ServerConfig,
          Effect.gen(function* () {
            const config = yield* ServerConfig.ServerConfig;
            return ServerConfig.make({
              ...config,
              zeropsFixtures: "web:service-map-live",
              zerops: undefined,
            });
          }),
        ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "fixture-layer-" }))),
      ),
    ),
  );

  it.effect("loads an absolute JSON scene through the shared scene schema", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* fs.makeTempFileScoped({ prefix: "zerops-scene-", suffix: ".json" });
      const source = loadShowcaseScene("web:service-map-live");
      yield* fs.writeFileString(path, encodeScene(source));

      const loaded = yield* loadFixtureScene(path);
      assert.equal(loaded.id, source.id);
      assert.deepEqual(loaded.topologySource, source.topologySource);
    }),
  );

  it.effect("fails fast and names an undecodable scene", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* fs.makeTempFileScoped({
        prefix: "zerops-invalid-scene-",
        suffix: ".json",
      });
      yield* fs.writeFileString(path, '{"version":1}');

      const result = yield* Effect.result(loadFixtureScene(path));
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.include(result.failure.message, path);
      }
    }),
  );

  it.effect("names every valid scene id when a web selector is mistyped", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(loadFixtureScene("web:service-map-liv"));
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        for (const id of SHOWCASE_SCENE_IDS) {
          assert.include(result.failure.message, id);
        }
      }
    }),
  );
});
