/**
 * "Add stage" and "Add production", asked from a project's menu in the left menu or from the
 * project's own page: they open the form the projects page's own ⋯ opens, on that
 * page, where the creation's checklist runs. They only landed on the page once, leaving the person
 * to find the verb again (the owner, 2026-09-30: a menu item must open what it names).
 *
 * The store holds the one ask in the air; the projects page takes it as it draws, so the form
 * opens once per ask and never again on a later visit.
 */
import type { GroupEnvironmentTier } from "@t3tools/client-runtime/zerops";
import { create } from "zustand";

/** A stage or a production asked for in a project. */
export interface SetUpEnvironmentAsk {
  readonly groupId: string;
  readonly role: "stage" | "prod";
}

interface SetUpEnvironmentState {
  readonly asked: SetUpEnvironmentAsk | null;
  readonly ask: (groupId: string, tier: GroupEnvironmentTier) => void;
  /** The ask in the air, handed over once: it is gone after. */
  readonly take: () => SetUpEnvironmentAsk | null;
}

export const useSetUpEnvironment = create<SetUpEnvironmentState>((set, get) => ({
  asked: null,
  ask: (groupId, tier) => {
    set({ asked: { groupId, role: tier === "production" ? "prod" : "stage" } });
  },
  take: () => {
    const { asked } = get();
    if (asked !== null) set({ asked: null });
    return asked;
  },
}));
