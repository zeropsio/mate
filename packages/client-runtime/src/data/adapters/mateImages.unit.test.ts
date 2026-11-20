import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { mateImageId, type MateImageKey } from "../families/mateImage.ts";
import { mateImage } from "../projections/mateImage.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { classifyImageHttp, makeMateImages } from "./mateImages.ts";

const key: MateImageKey = {
  environmentId: EnvironmentId.make("mate"),
  resource: { _tag: "attachment", attachmentId: "image", mimeType: "image/png" },
  rendition: { width: 80, height: 40 },
};

// witness: packages/client-runtime/src/data/adapters/mateImages.ts | access: fault.outcome === "authoritative-denial" ? "denied" : "unverified", → access: fault.outcome !== "authoritative-denial" ? "denied" : "unverified",
it.effect(
  "AD59: A retained image preview is withheld while access is unverified and purged on an authoritative denial",
  () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const store = makeAccountStore(registry);
      const blob = new Blob(["picture"]);
      let receive: (fault: StreamFault | null) => void = () => {};
      const images = makeMateImages({
        store,
        wire: {
          read: () => Effect.succeed({ blob, digest: "picture" }),
          // The session is never repaired here: what is retained stays as access left it.
          repair: () => Effect.never,
          watch: (_, callback) =>
            Effect.sync(() => {
              receive = callback;
            }).pipe(Effect.andThen(Effect.never)),
        },
      });
      const preview = () => mateImage.derive(readsOfState(store.state()), key);
      // The bytes a later read of the same picture may reuse: listed only while they are kept.
      const retained = () => [...readsOfState(store.state()).index("mateImageDigest", "picture")];
      const release = images.demand(key);
      yield* Effect.gen(function* () {
        yield* settle;
        expect(preview()).toMatchObject({ kind: "ready", blob });
        receive(classifyImageHttp(503, "access-unverified"));
        yield* settle;
        expect(preview().kind).toBe("failed");
        expect(retained()).toEqual([mateImageId(key)]);
        receive(classifyImageHttp(403));
        yield* settle;
        expect(preview().kind).toBe("failed");
        expect(retained()).toEqual([]);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            release();
            images.stop();
            store.close();
            registry.dispose();
          }),
        ),
      );
    }),
);
