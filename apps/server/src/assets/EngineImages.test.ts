import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthOrchestrationReadScope, AuthSessionId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpRouter } from "effect/http";
import sharp from "sharp";
import { EnvironmentAuth } from "../auth/EnvironmentAuth.ts";
import { ServerConfig, layerTest } from "../config.ts";
import { MateEngine } from "../engine/MateEngine.ts";
import { makeEngineWorld, mate } from "../engine/testing/pump/engineWorld.ts";
import { assetRouteLayer } from "../http.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as AssetSigningKey from "./AssetSigningKey.ts";
import { contentAssetsAt } from "./ContentAssets.ts";
import { resolveImageAsset } from "./ImageAsset.ts";

const layer = Layer.mergeAll(
  layerTest(process.cwd(), { prefix: "engine-images-" }),
  WorkspacePaths.layer,
  ProjectFaviconResolver.layer.pipe(
    Layer.provide(WorkspacePaths.layer),
    Layer.provide(T3ProjectFileLoader.layer),
  ),
  Layer.succeed(AssetSigningKey.AssetSigningKey, { get: Effect.die("signed images are not used") }),
  Layer.mock(ProjectionSnapshotQuery)({
    getThreadShellById: () => Effect.succeedNone,
    getProjectShellById: () => Effect.succeedNone,
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

// Decision: V1 behaviour unchanged; engine gets image parity.
it.effect.each(["screenshot", "attachment"] as const)(
  "an engine %s serves retained original and preview bytes only with current access",
  (kind) =>
    Effect.gen(function* () {
      const w = yield* makeEngineWorld({ driver: "codex" });
      yield* w.boot;
      yield* w.tell({ _tag: "Send", text: "Look at this image" });
      const engine = yield* w.engine;
      const config = yield* ServerConfig;
      const bytes = yield* Effect.promise(() =>
        sharp({ create: { width: 200, height: 120, channels: 4, background: "blue" } })
          .png()
          .toBuffer(),
      );
      const store = contentAssetsAt(config.stateDir);
      const occurrence = yield* Effect.promise(() =>
        store.ingestBytes(bytes, {
          threadId: ThreadId.make(kind === "screenshot" ? `${mate}/s/1` : mate),
          ownerId: kind,
          name: `${kind}.png`,
          provenance: kind === "screenshot" ? "capture" : "upload",
        }),
      );
      if (occurrence.original.status !== "ready") throw new Error("image not retained");
      let allowed = true;
      const auth = Layer.mock(EnvironmentAuth)({
        authenticateHttpRequest: () =>
          Effect.sync(() => ({
            sessionId: AuthSessionId.make("session"),
            subject: "owner",
            method: "bearer-access-token" as const,
            scopes: allowed ? [AuthOrchestrationReadScope] : [],
          })),
      });
      yield* Effect.gen(function* () {
        yield* Layer.build(HttpRouter.serve(assetRouteLayer));
        const preview = yield* Effect.promise(() => store.preview(occurrence.id, 100, 60));
        for (const url of [
          `/api/assets/objects/${occurrence.original.status === "ready" ? occurrence.original.digest : ""}/original`,
          preview.relativeUrl,
        ]) {
          const response = yield* HttpClient.get(url);
          expect(
            response.status,
            "ASSERTION: retained engine image bytes are readable without a V1 thread",
          ).toBe(200);
          expect((yield* response.arrayBuffer).byteLength).toBeGreaterThan(0);
          allowed = false;
          for (const headers of [{}, { "if-none-match": "*" }, { range: "bytes=0-20" }]) {
            expect((yield* HttpClient.get(url, { headers })).status).toBe(403);
          }
          allowed = true;
        }
        const resource =
          kind === "screenshot"
            ? {
                _tag: "media-file" as const,
                threadId: ThreadId.make(mate),
                path: `mate-asset:${occurrence.id}`,
              }
            : {
                _tag: "attachment" as const,
                attachmentId: "attached",
                occurrenceId: occurrence.id,
                mimeType: "image/png",
              };
        const resolved = yield* resolveImageAsset({
          resource,
          imageMode: "reference",
          preview: { width: 100, height: 60 },
        });
        expect(resolved?.relativeUrl).toBe(preview.relativeUrl);
      }).pipe(
        Effect.provideService(MateEngine, engine),
        Effect.provideService(ServerConfig, { ...config, mateEngine: "mate" }),
        Effect.provide(Layer.mergeAll(auth, NodeHttpServer.layerTest)),
      );
      yield* w.shutdown;
    }).pipe(Effect.provide(layer)),
);
