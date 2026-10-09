import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { MateEngine } from "../engine/MateEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

/** Metadata and protected bytes use the same conversation owner, whichever engine serves it. */
export const resolveAssetContext = Effect.fn("resolveAssetContext")(function* (thread: ThreadId) {
  const engine = yield* Effect.serviceOption(MateEngine);
  if (Option.isSome(engine) && engine.value.live) return yield* engine.value.assetContext(thread);
  const query = yield* ProjectionSnapshotQuery;
  const row = yield* query.getThreadShellById(thread);
  if (Option.isNone(row)) return undefined;
  const project = yield* query.getProjectShellById(row.value.projectId);
  if (Option.isNone(project)) return undefined;
  return { workspaceRoot: row.value.worktreePath ?? project.value.workspaceRoot };
});
