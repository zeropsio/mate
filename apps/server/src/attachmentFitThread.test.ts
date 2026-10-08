import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as JpegJs from "jpeg-js";
import { vi } from "vite-plus/test";

import { type PictureFit, type PictureInput, fitImageForProviders } from "./attachmentFit.ts";
import { PictureFitError, fitPictureOffThread, makePictureFitter } from "./attachmentFitThread.ts";

/** A smooth 2400×1800 photo: over the edge, well under the bytes. */
function photo(): PictureInput {
  const width = 2400;
  const height = 1800;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set([(x * 255) / width, (y * 255) / height, 128, 255], (y * width + x) * 4);
    }
  }
  return { bytes: JpegJs.encode({ width, height, data }, 90).data, mimeType: "image/jpeg" };
}

/** A PNG header naming 40×30 pixels: within every limit. */
function smallPicture(): PictureInput {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 40);
  new DataView(bytes.buffer).setUint32(20, 30);
  return { bytes, mimeType: "image/png" };
}

const fitted: PictureFit = { _tag: "unsupported" };

describe("fitPictureOffThread", () => {
  it.effect("fits a picture as the server's own fit would", () =>
    Effect.gen(function* () {
      const input = photo();
      const fit = yield* fitPictureOffThread(input);
      const expected = fitImageForProviders(input);
      if (fit._tag !== "fitted" || expected._tag !== "fitted") throw new Error("Expected a fit.");
      expect({ ...fit, bytes: null }).toEqual({ ...expected, bytes: null });
      expect(Buffer.from(fit.bytes).equals(Buffer.from(expected.bytes))).toBe(true);
    }),
  );
});

describe("makePictureFitter", () => {
  it.effect("a picture within the limits comes back as it is, with no thread started", () =>
    Effect.gen(function* () {
      const run = vi.fn(() => Promise.resolve(fitted));
      const fit = yield* makePictureFitter(run)(smallPicture());
      expect(fit).toEqual({ _tag: "unchanged" });
      expect(run).not.toHaveBeenCalled();
    }),
  );

  it.live("fits one picture at a time", () =>
    Effect.gen(function* () {
      const finish = [Promise.withResolvers<PictureFit>(), Promise.withResolvers<PictureFit>()];
      let started = 0;
      const admitted = [yield* Deferred.make<void>(), yield* Deferred.make<void>()];
      const fit = makePictureFitter(() => {
        started += 1;
        Deferred.doneUnsafe(admitted[started - 1]!, Effect.void);
        return finish[started - 1]!.promise;
      });
      const first = yield* Effect.forkChild(fit(photo()));
      yield* Deferred.await(admitted[0]!).pipe(Effect.timeout("5 seconds"), Effect.orDie);
      // Execute the contender until it suspends while the first worker is still blocked.
      const second = yield* Effect.forkChild(fit(photo()), { startImmediately: true });
      expect(started).toBe(1);

      finish[0]!.resolve(fitted);
      yield* Fiber.join(first);
      yield* Deferred.await(admitted[1]!).pipe(Effect.timeout("5 seconds"), Effect.orDie);
      expect(started).toBe(2);

      finish[1]!.resolve(fitted);
      expect(yield* Fiber.join(second)).toEqual(fitted);
    }),
  );

  it.effect("a thread that fails is a PictureFitError", () =>
    Effect.gen(function* () {
      const cause = new Error("worker exited");
      const failure = yield* makePictureFitter(() => Promise.reject(cause))(photo()).pipe(
        Effect.flip,
      );
      expect(failure).toBeInstanceOf(PictureFitError);
      expect(failure.cause).toBe(cause);
    }),
  );

  it.live("stops the thread of a fit nobody waits for any more", () =>
    Effect.gen(function* () {
      const signals: AbortSignal[] = [];
      const admitted = yield* Deferred.make<void>();
      const fit = makePictureFitter((_input, signal) => {
        signals.push(signal);
        Deferred.doneUnsafe(admitted, Effect.void);
        return new Promise<PictureFit>(() => {});
      });
      const fiber = yield* Effect.forkChild(fit(photo()));
      yield* Deferred.await(admitted).pipe(Effect.timeout("5 seconds"), Effect.orDie);
      yield* Fiber.interrupt(fiber);
      expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    }),
  );
});
