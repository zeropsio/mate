// @effect-diagnostics nodeBuiltinImport:off -- the worker side of attachmentFitThread.ts
import * as NodeWorkerThreads from "node:worker_threads";

import { type PictureInput, fitImageForProviders } from "./attachmentFit.ts";

// One picture's fit on a thread of its own, started by `attachmentFitThread.ts`
// with the picture as its data. This entry is bundled alongside the server.
const fit = fitImageForProviders(NodeWorkerThreads.workerData as PictureInput);
// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's port has no origin
NodeWorkerThreads.parentPort?.postMessage(fit);
