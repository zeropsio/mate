/** A write is reflected only by a later, complete owner read of the same contents. */
import type { ProjectWriteFileInput, ProjectWriteFileResult } from "@t3tools/contracts";
import type { WorkspaceTarget } from "../families/mateWorkspace.ts";
import { workspaceId } from "../families/mateWorkspace.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "mate-write-file": WorkspaceTarget<"file"> & {
      readonly input: ProjectWriteFileInput;
      readonly beforeSequence: number;
    };
  }
  interface OperationResults {
    readonly "mate-write-file": ProjectWriteFileResult;
  }
}
export const mateWriteFile: OperationKind<"mate-write-file"> = {
  kind: "mate-write-file",
  executor: "mate",
  reflected: (read, intent) => {
    const fact = read.fact(
      "mateWorkspaceFile",
      workspaceId({
        environmentId: intent.environmentId,
        input: { cwd: intent.input.cwd, relativePath: intent.input.relativePath },
      }),
    );
    return (
      fact.kind === "known" &&
      fact.revision.kind === "mate-link" &&
      fact.revision.sequence > intent.beforeSequence &&
      !fact.value.truncated &&
      fact.value.contents === intent.input.contents
    );
  },
  settledBy: (read, intent, receipt) =>
    mateWriteFile.reflected(read, intent, receipt) ? { kind: "succeeded" } : null,
};
