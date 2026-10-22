/**
 * Which project's Delete dialog is open (`ZeropsDeleteApplicationDialog`): one at a time, opened
 * from the menu row of a project without a Mate, or — already confirmed — by a Mate's own Delete
 * that asked to delete its project too, and closed by the person or once HQ deleted it.
 */
import { create } from "zustand";

import type { DeleteApplicationTarget } from "~/components/zerops/ZeropsDeleteApplicationDialog.logic";

export interface DeleteApplicationRequest {
  readonly target: DeleteApplicationTarget;
  /** The person confirmed it already, in its last Mate's Delete: it starts deleting as it opens. */
  readonly confirmed?: boolean;
}

interface DeleteApplicationDialogState {
  readonly request: DeleteApplicationRequest | null;
  readonly open: (request: DeleteApplicationRequest) => void;
  readonly close: () => void;
}

export const useDeleteApplicationDialog = create<DeleteApplicationDialogState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));
