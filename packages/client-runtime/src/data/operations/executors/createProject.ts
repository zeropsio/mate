/**
 * A project's creation, at Zerops: `POST /client/{id}/project`, answered with the project — the
 * operation's handle and its result.
 *
 * @module data/operations/executors/createProject
 */
import * as Effect from "effect/Effect";

import type { OperationReceipt } from "../../model.ts";
import type { IntentOf } from "../kind.ts";
import { verb } from "./write.ts";

export function createProjectExecutor(platform: {
  readonly createProject: (input: {
    readonly clientId: string;
    readonly name: string;
    readonly tagList: ReadonlyArray<string>;
    readonly location?: string;
  }) => Promise<{ readonly id: string }>;
}) {
  return (requestId: string, intent: IntentOf<"create-project">) =>
    Effect.map(
      verb(() =>
        platform.createProject({
          clientId: intent.orgId,
          name: intent.name,
          tagList: intent.tagList,
          ...(intent.location === undefined ? {} : { location: intent.location }),
        }),
      ),
      ({ id }): OperationReceipt => ({
        requestId,
        operationId: id,
        executor: "zerops",
        affected: [{ family: "project", id }],
        handles: [id],
        acceptance: { kind: "accepted", result: { projectId: id } },
        outcome: { kind: "pending" },
      }),
    );
}
