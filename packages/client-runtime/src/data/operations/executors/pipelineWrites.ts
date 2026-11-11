/**
 * Zerops writes to one pipeline, each answered as its end (`answeredReceipt`).
 *
 * @module data/operations/executors/pipelineWrites
 */
import * as Effect from "effect/Effect";

import type { IntentOf } from "../kind.ts";
import { answeredReceipt } from "./answered.ts";
import { verb } from "./write.ts";

export function cancelBuildExecutor(platform: {
  readonly cancelBuild: (appVersionId: string) => Promise<void>;
}) {
  return (requestId: string, intent: IntentOf<"cancel-build">) =>
    Effect.as(
      verb(() => platform.cancelBuild(intent.appVersionId)),
      answeredReceipt(requestId, { family: "pipeline", id: intent.appVersionId }),
    );
}
