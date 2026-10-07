import { createVcsActionManager } from "@t3tools/client-runtime/state/vcs";
import { connectionAtomRuntime } from "../connection/runtime";
import { workspaceQuery, workspaceCommand, vcsStatus } from "./workspace";
export const vcsEnvironment = {
  listRefs: workspaceQuery("refs"),
  status: vcsStatus,
  pull: workspaceCommand("mate-vcs-pull"),
  refreshStatus: workspaceCommand("mate-vcs-refresh-status"),
  createWorktree: workspaceCommand("mate-vcs-create-worktree"),
  removeWorktree: workspaceCommand("mate-vcs-remove-worktree"),
  createRef: workspaceCommand("mate-vcs-create-ref"),
  switchRef: workspaceCommand("mate-vcs-switch-ref"),
  init: workspaceCommand("mate-vcs-init"),
};
export const vcsActionManager = createVcsActionManager(connectionAtomRuntime);
