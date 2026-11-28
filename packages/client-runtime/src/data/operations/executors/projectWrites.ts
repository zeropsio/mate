/**
 * Zerops writes to one project, each answered as its end (`answeredReceipt`).
 *
 * @module data/operations/executors/projectWrites
 */
import * as Effect from "effect/Effect";

import type { IntentOf } from "../kind.ts";
import { answeredReceipt } from "./answered.ts";
import { verb } from "./write.ts";

export function startProjectExecutor(platform: {
  readonly startProject: (projectId: string) => Promise<void>;
}) {
  return (requestId: string, intent: IntentOf<"start-project">) =>
    Effect.as(
      verb(() => platform.startProject(intent.projectId)),
      answeredReceipt(requestId, { family: "project", id: intent.projectId }),
    );
}
