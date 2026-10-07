/** Each workspace write has its own intent and retained receipt; no write is retried blindly. */
import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentRpcInput, EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { RegisteredOperationKind } from "./kind.ts";

export const WORKSPACE_MUTATIONS = {
  "mate-attachment-create-upload": WS_METHODS.attachmentsCreateUploadUrl,
  "mate-attachment-delete": WS_METHODS.attachmentsDelete,
  "mate-mcp-add": WS_METHODS.mcpServersAdd,
  "mate-mcp-remove": WS_METHODS.mcpServersRemove,
  "mate-mcp-set-enabled": WS_METHODS.mcpServersSetEnabled,
  "mate-mcp-reconnect": WS_METHODS.mcpServersReconnect,
  "mate-vcs-pull": WS_METHODS.vcsPull,
  "mate-vcs-refresh-status": WS_METHODS.vcsRefreshStatus,
  "mate-vcs-create-worktree": WS_METHODS.vcsCreateWorktree,
  "mate-vcs-remove-worktree": WS_METHODS.vcsRemoveWorktree,
  "mate-vcs-create-ref": WS_METHODS.vcsCreateRef,
  "mate-vcs-switch-ref": WS_METHODS.vcsSwitchRef,
  "mate-vcs-init": WS_METHODS.vcsInit,
  "mate-prepare-pull-request-thread": WS_METHODS.gitPreparePullRequestThread,
} as const;
export type WorkspaceMutation = keyof typeof WORKSPACE_MUTATIONS;
export type MutationTarget<K extends WorkspaceMutation> = {
  readonly environmentId: EnvironmentId;
  readonly input: EnvironmentRpcInput<(typeof WORKSPACE_MUTATIONS)[K]>;
};
export type MutationValue<K extends WorkspaceMutation> = EnvironmentRpcSuccess<
  (typeof WORKSPACE_MUTATIONS)[K]
>;
type Intents = { readonly [K in WorkspaceMutation]: MutationTarget<K> };
type Results = { readonly [K in WorkspaceMutation]: MutationValue<K> };
declare module "../model.ts" {
  interface OperationIntents extends Intents {}
  interface OperationResults extends Results {}
}
export const WORKSPACE_MUTATION_KINDS: ReadonlyArray<RegisteredOperationKind> = Object.keys(
  WORKSPACE_MUTATIONS,
).map((kind) => ({
  kind,
  executor: "mate",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
}));
