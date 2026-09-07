import {
  CheckpointRef,
  type OrchestrationCheckpointSummary,
  type CheckpointDiffRootResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { CheckpointStore } from "./CheckpointStore.ts";
import type { ZeropsRepositories } from "../zerops/ZeropsRepositorySource.ts";
import { prefixUnifiedPatch, resolveCheckpointTargets } from "../zerops/ZeropsCheckpointTargets.ts";
import type { WorkspaceDiff } from "./WorkspaceHistory.ts";

/** Old summaries prove paths, not service-instance identity. Never claim complete coverage. */
export const readLegacyWorkspaceDiff = Effect.fn("readLegacyWorkspaceDiff")(function* (
  store: CheckpointStore["Service"],
  input: {
    cwd: string;
    repositories: ZeropsRepositories;
    checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
    fromCheckpointRef: CheckpointRef;
    toCheckpointRef: CheckpointRef;
    ignoreWhitespace: boolean;
  },
): Effect.fn.Return<WorkspaceDiff> {
  const paths = input.checkpoints.flatMap((c) => c.files.map((f) => f.path));
  const allTargets = resolveCheckpointTargets(input.cwd, input.repositories);
  const targets =
    input.repositories._tag === "disabled"
      ? [...allTargets]
      : allTargets.filter(
          (target) => target.prefix !== "" && paths.some((path) => path.startsWith(target.prefix)),
        );
  // A thread rooted at a single service has unprefixed paths. Its original cwd
  // remains evidence; lack of a mount never permits a local fallback.
  if (
    targets.length === 0 &&
    input.repositories._tag === "available" &&
    input.repositories.repositories.some((r) => r.mountPath === input.cwd)
  )
    targets.push({ cwd: input.cwd, prefix: "" });
  const results: Array<CheckpointDiffRootResult> = [];
  const patches: string[] = [];
  let remainingBytes = 2_000_000;
  for (const target of targets.slice(0, 32)) {
    const base = {
      rootId: `legacy:${target.cwd}`,
      label: target.prefix.replace(/\/$/, "") || input.cwd.split("/").at(-1) || "Workspace",
      pathPrefix: target.prefix,
    };
    if (remainingBytes <= 0) {
      results.push({
        ...base,
        status: "oversized",
        reason: "The combined diff exceeds the review limit.",
      });
      continue;
    }
    const result = yield* store
      .diffCheckpoints({
        cwd: target.cwd,
        fromCheckpointRef: input.fromCheckpointRef,
        toCheckpointRef: input.toCheckpointRef,
        fallbackFromToHead: false,
        ignoreWhitespace: input.ignoreWhitespace,
        maxOutputBytes: remainingBytes,
      })
      .pipe(
        Effect.timeout("15 seconds"),
        Effect.map((patch) => ({ patch })),
        Effect.catch((error) => Effect.succeed({ error })),
      );
    if ("error" in result) {
      results.push({ ...base, status: "unavailable", reason: result.error.message });
    } else {
      const patch = prefixUnifiedPatch(result.patch, target.prefix);
      remainingBytes -= Buffer.byteLength(patch) + 1;
      if (remainingBytes < 0)
        results.push({
          ...base,
          status: "oversized",
          reason: "The combined diff exceeds the review limit.",
        });
      else {
        patches.push(patch);
        results.push({ ...base, status: "available" });
      }
    }
  }
  const unresolved = paths.filter(
    (path) => !targets.some((t) => t.prefix === "" || path.startsWith(t.prefix)),
  );
  if (unresolved.length > 0 || targets.length === 0 || targets.length > 32)
    results.push({
      rootId: "legacy:unresolved",
      label: "Unresolved historical sources",
      pathPrefix: "",
      status: "identity-unresolved",
      reason:
        "This older run did not record service identities. Some sources cannot be resolved safely from its saved file list.",
    });
  return { diff: patches.filter(Boolean).join("\n"), roots: results, coverage: "unknown" };
});
