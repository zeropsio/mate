/**
 * Which project's Delete dialog is open (`ZeropsDeleteApplicationDialog`): one at a time, opened
 * from the menu row of a project without a Mate, or by the Delete of a project's last Mate the
 * person may delete with its project (`deletionOffer`'s `last-choice`). Closed by the person, or
 * once HQ deleted the project. Its start runs at HQ: closing it stops nothing.
 */
import { create } from "zustand";

import { randomUUID } from "~/lib/utils";

/** The project's last Mate, whose Delete opened it. */
export interface DeleteApplicationMate {
  readonly projectId: string;
  readonly name: string;
  /** Every service that goes with its environment (`deleteMateServiceCount`); unread: `undefined`. */
  readonly services: number | undefined;
  /** Whose Mate it is, where that is a colleague, as its own dialog says it. */
  readonly owner: string | undefined;
  /** HQ took its deletion: a viewer in its conversation leaves it. */
  readonly leave: (
    where: { readonly place: "menu" | "git"; readonly line: string } | undefined,
  ) => void;
}

interface DeleteApplicationRequest {
  /** One per opening: a project opened again is a new dialog. */
  readonly id: string;
  readonly appId: string;
  /** Its name, as HQ holds it: the dialog asks for it typed. */
  readonly name: string;
  readonly mate?: DeleteApplicationMate | undefined;
}

interface DeleteApplicationDialogState {
  readonly request: DeleteApplicationRequest | null;
  readonly open: (request: Omit<DeleteApplicationRequest, "id">) => void;
  readonly close: () => void;
}

export const useDeleteApplicationDialog = create<DeleteApplicationDialogState>((set) => ({
  request: null,
  open: (request) => set({ request: { ...request, id: randomUUID() } }),
  close: () => set({ request: null }),
}));
