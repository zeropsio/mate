/**
 * Which project's Delete dialog is open (`ZeropsDeleteApplicationDialog`): one at a time, opened
 * from the menu row of a project without a Mate, or by its last Mate's Delete, which deletes that
 * Mate first. Closed by the person, or once HQ deleted the project; closed while its last Mate's
 * deletion runs, it is only out of sight, and still starts the project's once HQ let go of the Mate.
 */
import { create } from "zustand";

import { randomUUID } from "~/lib/utils";
import type { DeleteApplicationTarget } from "./ZeropsDeleteApplicationDialog.logic";

/** The project's last Mate, which its Delete deletes before the project. */
export interface DeleteApplicationMate {
  readonly projectId: string;
  readonly name: string;
  /** Every service that goes with its environment (`deleteMateServiceCount`); unread: `undefined`. */
  readonly services: number | undefined;
  /** HQ took its deletion: a viewer in its conversation leaves it. */
  readonly leave: () => void;
}

interface DeleteApplicationRequest {
  /** One per opening: a project opened again is a new dialog. */
  readonly id: string;
  readonly target: DeleteApplicationTarget;
  readonly mate?: DeleteApplicationMate | undefined;
  /** Out of sight while what it started runs on. */
  readonly hidden: boolean;
}

interface DeleteApplicationDialogState {
  readonly request: DeleteApplicationRequest | null;
  readonly open: (request: Pick<DeleteApplicationRequest, "target" | "mate">) => void;
  readonly hide: () => void;
  readonly close: () => void;
}

export const useDeleteApplicationDialog = create<DeleteApplicationDialogState>((set) => ({
  request: null,
  open: (request) => set({ request: { ...request, id: randomUUID(), hidden: false } }),
  hide: () => set(({ request }) => ({ request: request && { ...request, hidden: true } })),
  close: () => set({ request: null }),
}));
