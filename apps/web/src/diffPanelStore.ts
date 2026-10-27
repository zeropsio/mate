import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  accountLocalStorage,
  onAccountLifetimeOpen,
  onAccountLifetimeClose,
} from "./zerops/accountLifetime";

let resettingAccount = false;
const storage = {
  ...accountLocalStorage,
  setItem(key: string, value: string) {
    if (!resettingAccount) accountLocalStorage.setItem(key, value);
  },
};

/**
 * What a thread's Diff shows: a repository's changes not committed (`unstaged`), or its commits
 * not on main (`branch`). Without a repository, the first of the conversation's repositories.
 */
export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null; repository?: string }
  | { kind: "unstaged"; repository?: string };

export type DiffRenderMode = "stacked" | "split";

const DEFAULT_SELECTION: DiffPanelSelection = { kind: "unstaged" };

/** A repository's comparison bases are its own: by thread, then by repository (`""`: none named). */
type BranchBaseRefs = Record<string, Record<string, string | null>>;

interface DiffPanelStoreState {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: BranchBaseRefs;
  diffRenderMode: DiffRenderMode;
  setDiffRenderMode: (mode: DiffRenderMode) => void;
  selectGitScope: (ref: ScopedThreadRef, scope: "branch" | "unstaged", repository?: string) => void;
  selectBranchBaseRef: (ref: ScopedThreadRef, baseRef: string | null) => void;
  /** Forgets what the thread showed: its Diff opens on what is not on main yet. */
  clearSelection: (ref: ScopedThreadRef) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim();
  return normalized ? normalized : null;
}

function withBaseRef(
  baseRefs: BranchBaseRefs,
  threadKey: string,
  repository: string | undefined,
  baseRef: string | null,
): BranchBaseRefs {
  return { ...baseRefs, [threadKey]: { ...baseRefs[threadKey], [repository ?? ""]: baseRef } };
}

export const useDiffPanelStore = create<DiffPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      diffRenderMode: "stacked",
      setDiffRenderMode: (diffRenderMode) => set({ diffRenderMode }),
      selectGitScope: (ref, scope, repository) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const branchBaseRefByThreadKey =
            previous?.kind === "branch"
              ? withBaseRef(
                  state.branchBaseRefByThreadKey,
                  threadKey,
                  previous.repository,
                  previous.baseRef,
                )
              : state.branchBaseRefByThreadKey;
          const baseRef = branchBaseRefByThreadKey[threadKey]?.[repository ?? ""] ?? null;
          const inRepository = repository === undefined ? {} : { repository };
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]:
                scope === "branch"
                  ? { kind: "branch", baseRef, ...inRepository }
                  : { kind: "unstaged", ...inRepository },
            },
            branchBaseRefByThreadKey,
          };
        }),
      selectBranchBaseRef: (ref, baseRef) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const normalizedBaseRef = normalizeBaseRef(baseRef);
          const repository = state.byThreadKey[threadKey]?.repository;
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                kind: "branch",
                baseRef: normalizedBaseRef,
                ...(repository === undefined ? {} : { repository }),
              },
            },
            branchBaseRefByThreadKey: withBaseRef(
              state.branchBaseRefByThreadKey,
              threadKey,
              repository,
              normalizedBaseRef,
            ),
          };
        }),
      clearSelection: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.byThreadKey)) return state;
          const { [threadKey]: _cleared, ...byThreadKey } = state.byThreadKey;
          return { byThreadKey };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.byThreadKey) && !(threadKey in state.branchBaseRefByThreadKey)) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } =
            state.branchBaseRefByThreadKey;
          return { byThreadKey, branchBaseRefByThreadKey };
        }),
    }),
    {
      name: "t3code:diff-panel-state:v1",
      version: 3,
      // Version 1 also held a turn's diff, which no longer exists: those selections are dropped.
      // Versions before 3 held one comparison base per thread: it stays as the base of none named.
      migrate: (persisted) => {
        const state = persisted as Partial<
          Pick<DiffPanelStoreState, "byThreadKey" | "diffRenderMode">
        > & { branchBaseRefByThreadKey?: Record<string, unknown> };
        return {
          ...state,
          byThreadKey: Object.fromEntries(
            Object.entries(state.byThreadKey ?? {}).filter(
              ([, selection]) => selection.kind === "branch" || selection.kind === "unstaged",
            ),
          ),
          branchBaseRefByThreadKey: Object.fromEntries(
            Object.entries(state.branchBaseRefByThreadKey ?? {}).map(([key, baseRef]) => [
              key,
              { "": typeof baseRef === "string" ? baseRef : null },
            ]),
          ),
        };
      },
      skipHydration: true,
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
        diffRenderMode: state.diffRenderMode,
      }),
    },
  ),
);

export function selectThreadDiffPanelSelection(
  byThreadKey: Record<string, DiffPanelSelection>,
  ref: ScopedThreadRef | null | undefined,
): DiffPanelSelection {
  if (!ref) return DEFAULT_SELECTION;
  return byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_SELECTION;
}

onAccountLifetimeOpen(() => {
  void useDiffPanelStore.persist.rehydrate();
});
onAccountLifetimeClose(() => {
  resettingAccount = true;
  try {
    useDiffPanelStore.setState(useDiffPanelStore.getInitialState(), true);
  } finally {
    resettingAccount = false;
  }
});
