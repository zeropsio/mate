/**
 * Fits a picture on a worker thread of its own (`attachmentFitWorker.ts`): a
 * camera photo takes up to a second of decoding and encoding and hundreds of
 * megabytes, which the server's own thread must not wait on, and which go
 * with the worker when it ends. A picture within the limits never leaves the
 * server's thread, and one picture is fitted at a time, so the memory a fit
 * takes never stacks up.
 */
// @effect-diagnostics nodeBuiltinImport:off -- a worker thread, which Effect's platform does not wrap
import * as NodeWorkerThreads from "node:worker_threads";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import { type PictureFit, type PictureInput, needsFit } from "./attachmentFit.ts";

/** The worker failed to start, or stopped before it answered. */
export class PictureFitError extends Data.TaggedError("PictureFitError")<{
  readonly cause: unknown;
}> {}

/** Runs one fit to its answer, stopping when the signal says nobody waits for it. */
export type RunPictureFit = (input: PictureInput, signal: AbortSignal) => Promise<PictureFit>;

// The server runs from its sources in development and as a bundle next to
// the worker's own bundle otherwise.
const WORKER_URL = new URL(
  import.meta.url.endsWith(".ts") ? "./attachmentFitWorker.ts" : "./attachmentFitWorker.mjs",
  import.meta.url,
);

const fitOnWorker: RunPictureFit = (input, signal) =>
  new Promise((resolve, reject) => {
    const worker = new NodeWorkerThreads.Worker(WORKER_URL, { workerData: input });
    const stop = () => void worker.terminate();
    signal.addEventListener("abort", stop, { once: true });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      signal.removeEventListener("abort", stop);
      reject(new Error(`The picture's worker stopped with code ${code} before it answered.`));
    });
  });

/** A fit that runs `run` for each picture over the limits, one at a time. */
export function makePictureFitter(
  run: RunPictureFit,
): (input: PictureInput) => Effect.Effect<PictureFit, PictureFitError> {
  const oneAtATime = Semaphore.makeUnsafe(1);
  return (input) =>
    needsFit(input)
      ? oneAtATime.withPermits(1)(
          Effect.tryPromise({
            try: (signal) => run(input, signal),
            catch: (cause) => new PictureFitError({ cause }),
          }),
        )
      : Effect.succeed({ _tag: "unchanged" });
}

export const fitPictureOffThread = makePictureFitter(fitOnWorker);
