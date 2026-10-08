// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PIXEL } from "../testing/bridge/callHeavy.ts";
import { makeCallPictures } from "./callPictures.ts";

const thread = ThreadId.make("mate/s/1");

const fixture = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "call-pictures-"));
  const cwd = NodePath.join(root, "work");
  NodeFS.mkdirSync(NodePath.join(cwd, "shots"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(cwd, "shots", "home.png"), Buffer.from(PIXEL, "base64"));
  return makeCallPictures(NodePath.join(root, "state"), () => Effect.succeed(cwd));
};

describe("a call's pictures in the Mate's asset store", () => {
  it.effect("stores a result's picture once, however often its batch is told", () =>
    Effect.gen(function* () {
      const pictures = fixture();
      const image = { mimeType: "image/png", data: PIXEL };
      const first = yield* pictures.results(thread, "call-1", [image]);
      const again = yield* pictures.results(thread, "call-1", [image]);
      assert.isFalse(first.dropped);
      assert.strictEqual(first.images.length, 1);
      const idOf = (stored: typeof first) =>
        (stored.images[0]?.asset as { id?: string } | undefined)?.id;
      assert.strictEqual(idOf(again), idOf(first));
      assert.include(first.images[0], { mimeType: "image/png", width: 1, height: 1 });
    }),
  );

  it.effect("names a workspace picture a call looked at by its asset, with its name and size", () =>
    Effect.gen(function* () {
      const looked = yield* fixture().looked(thread, "call-3", "shots/home.png");
      assert.match(looked?.imagePath ?? "", /^mate-asset:[0-9a-f-]{36}$/);
      assert.strictEqual(looked?.imageName, "home.png");
      assert.deepStrictEqual(looked?.imageDimensions, { width: 1, height: 1 });
    }),
  );
});
