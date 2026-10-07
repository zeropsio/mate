// @effect-diagnostics nodeBuiltinImport:off - byte fixtures prove protected HTTP responses.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServerResponse } from "effect/unstable/http";
import { afterEach, expect, it } from "@effect/vitest";
import sharp from "sharp";
import { ContentAssets } from "./ContentAssets.ts";
import { contentAssetFailure, protectedContentAsset } from "./ContentAssetHttp.ts";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-http-image-"));
  roots.push(root);
  const store = new ContentAssets(root);
  const occurrence = await store.ingestBytes(
    await sharp({ create: { width: 240, height: 160, channels: 4, background: "blue" } })
      .png()
      .toBuffer(),
    {
      threadId: ThreadId.make("thread"),
      ownerId: "message",
      name: "shot.png",
      provenance: "capture",
    },
  );
  return {
    store,
    original:
      occurrence.original.status === "ready"
        ? await store.object(occurrence.original.digest)
        : null,
    object: await store.object((await store.preview(occurrence.id, 120, 80)).digest, true),
  };
}
it.effect.each([
  { method: "GET", headers: { "if-none-match": "*" } },
  { method: "HEAD", headers: {} },
  { method: "GET", headers: { range: "bytes=0-20" } },
] as const)(
  "authorizes %s before resolving an object or conditional/range headers",
  ({ method, headers }) =>
    Effect.gen(function* () {
      let resolutions = 0;
      const response = yield* protectedContentAsset(
        Effect.succeed(contentAssetFailure("access-denied", 403)),
        Effect.sync(() => {
          resolutions++;
          throw new Error("unauthorized resolution");
        }),
        { method, headers },
      );
      expect(response.status).toBe(403);
      expect(resolutions).toBe(0);
    }),
);
it.effect("reload revalidates a cached preview with a strong digest ETag and no body", () =>
  Effect.gen(function* () {
    const { object } = yield* Effect.promise(fixture);
    let checks = 0;
    const serve = (headers: Record<string, string>) =>
      protectedContentAsset(
        Effect.sync(() => {
          checks++;
          return null;
        }),
        Effect.succeed(object),
        { method: "GET", headers },
      );
    const first = yield* serve({});
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-cache");
    expect(first.headers.etag).toBe(`"sha256-${object.digest}"`);
    const reload = yield* serve({ "if-none-match": first.headers.etag! });
    expect(reload.status).toBe(304);
    expect(reload.body._tag).toBe("Empty");
    expect(checks).toBe(2);
  }),
);
it.effect(
  "a missing original cannot answer 304 and a byte range contains exact retained bytes",
  () =>
    Effect.gen(function* () {
      const { object } = yield* Effect.promise(fixture);
      const ranged = yield* protectedContentAsset(Effect.succeed(null), Effect.succeed(object), {
        method: "GET",
        headers: { range: "bytes=0-20" },
      });
      const bytes = yield* Effect.promise(async () =>
        Buffer.from(await HttpServerResponse.toWeb(ranged).arrayBuffer()),
      );
      expect(ranged.status).toBe(206);
      expect(bytes).toEqual(
        (yield* Effect.promise(() => NodeFSP.readFile(object.path))).subarray(0, 21),
      );
      yield* Effect.promise(() => NodeFSP.unlink(object.path));
      const missing = yield* protectedContentAsset(Effect.succeed(null), Effect.succeed(object), {
        method: "GET",
        headers: { "if-none-match": "*" },
      });
      expect(missing.status).toBe(404);
    }),
);

it.effect.each([
  { method: "GET", headers: {} },
  { method: "HEAD", headers: {} },
  { method: "GET", headers: { range: "bytes=0-20" } },
  { method: "GET", headers: { "if-none-match": "*" } },
] as const)(
  "a previously readable original requires current access on every request: %s",
  ({ method, headers }) =>
    Effect.gen(function* () {
      const { original } = yield* Effect.promise(fixture);
      if (original === null) throw new Error("missing original");
      let allowed = true;
      let resolutions = 0;
      const serve = () =>
        protectedContentAsset(
          Effect.sync(() => (allowed ? null : contentAssetFailure("access-denied", 403))),
          Effect.sync(() => {
            resolutions++;
            return original;
          }),
          { method, headers },
        );
      expect((yield* serve()).status).toBe(
        method === "GET" && "range" in headers ? 206 : "if-none-match" in headers ? 304 : 200,
      );
      allowed = false;
      expect((yield* serve()).status).toBe(403);
      expect(resolutions).toBe(1);
    }),
);
