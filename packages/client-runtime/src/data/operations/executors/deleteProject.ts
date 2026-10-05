/**
 * A project's deletion, at Zerops: `DELETE /project/{id}`, answered with its delete process — the
 * operation's handle.
 *
 * @module data/operations/executors/deleteProject
 */
import * as Effect from "effect/Effect";

import type { OperationReceipt } from "../../model.ts";
import type { IntentOf } from "../kind.ts";
import { verb } from "./write.ts";

export function deleteProjectExecutor(platform: {
  readonly deleteProject: (projectId: string) => Promise<{ readonly processId: string }>;
}) {
  return (requestId: string, intent: IntentOf<"delete-project">) =>
    Effect.map(
      verb(() => platform.deleteProject(intent.projectId)),
      ({ processId }): OperationReceipt => ({
        requestId,
        operationId: processId,
        executor: "zerops",
        affected: [{ family: "process", id: processId }],
        handles: [processId],
        acceptance: { kind: "accepted" },
        outcome: { kind: "pending" },
      }),
    );
}
