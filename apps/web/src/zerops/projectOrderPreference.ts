/**
 * How this browser likes its projects ordered — the `/zerops` projects page's
 * sort control and the left sidebar tree read the same value, live, so
 * switching it in one place turns both around together.
 *
 * A per-viewer convenience, not product state: it lives in this browser's
 * `localStorage` alone, is never sent anywhere, and a private window or a
 * blocked storage policy just falls back to the default rather than failing
 * the page. `useLocalStorage` is the repo's own idiom for exactly this shape
 * (`editorPreferences.ts`, `useTheme.ts`, `Sidebar.tsx`'s shelf toggles): the
 * read, the decode, the write and the cross-tab/same-tab live sync are all
 * already try/catch-guarded there, so nothing is reimplemented here.
 */
import * as Schema from "effect/Schema";
import type { ZeropsProjectOrder } from "@t3tools/client-runtime/zerops";

import { useLocalStorage } from "../hooks/useLocalStorage";

export const PROJECT_ORDER_STORAGE_KEY = "mate:zerops:project-order";

/**
 * The page's choice: *Next step first* — the groups that wait on somebody,
 * worst first (`orderByNextStep`) — or one of the tree's own orders.
 */
export type ProjectsPageOrder = "next-step" | ZeropsProjectOrder;

/** The groups that need somebody lead, unless the viewer chose otherwise (the owner, 2026-09-23). */
export const DEFAULT_PROJECT_ORDER: ProjectsPageOrder = "next-step";

export const ProjectsPageOrderSchema = Schema.Literals(["next-step", "newest", "name"]);

/**
 * The order the group tree itself takes (`deriveZeropsGroups`). A next step
 * is a page's derivation the tree does not hold, so under *Next step first*
 * the tree reads its tie-break, newest first.
 */
export function projectTreeOrder(order: ProjectsPageOrder): ZeropsProjectOrder {
  return order === "next-step" ? "newest" : order;
}

/**
 * The projects page's sort control — `useLocalStorage`'s `storage` and
 * same-tab change events keep every reader in the same state without any one
 * of them owning it.
 */
export function useProjectsPageOrder(): readonly [
  ProjectsPageOrder,
  (next: ProjectsPageOrder) => void,
] {
  return useLocalStorage(PROJECT_ORDER_STORAGE_KEY, DEFAULT_PROJECT_ORDER, ProjectsPageOrderSchema);
}

/** The same preference as the group tree reads it — the sidebar and the move dialog. */
export function useProjectOrderPreference(): readonly [ZeropsProjectOrder] {
  const [order] = useProjectsPageOrder();
  return [projectTreeOrder(order)];
}
