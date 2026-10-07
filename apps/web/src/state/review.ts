import { executeAtomQuery, type AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { WorkspaceTarget, WorkspaceValue, StreamFault } from "@t3tools/client-runtime/data";
import { workspaceQuery } from "./workspace";
const files = workspaceQuery("reviewFile");
const diffFileContents: AtomCommand<
  WorkspaceTarget<"reviewFile">,
  WorkspaceValue<"reviewFile">,
  StreamFault
> = {
  label: "data:review-file",
  run: (registry, target) => executeAtomQuery(registry, files(target), { reportFailure: false }),
};
export const reviewEnvironment = { diffPreview: workspaceQuery("reviewPreview"), diffFileContents };
