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

/** Newest first unless the viewer chose otherwise (the owner, 2026-09-24). */
export const DEFAULT_PROJECT_ORDER: ZeropsProjectOrder = "newest";

export const ProjectOrderSchema = Schema.Literals(["newest", "name"]);

/**
 * The one order both surfaces read and the page's sort control writes —
 * `useLocalStorage`'s `storage` and same-tab change events keep every reader
 * in the same state without any one of them owning it. A stored value that
 * no longer decodes (the removed *Next step first*) reads as the default.
 */
export function useProjectOrderPreference(): readonly [
  ZeropsProjectOrder,
  (next: ZeropsProjectOrder) => void,
] {
  return useLocalStorage(PROJECT_ORDER_STORAGE_KEY, DEFAULT_PROJECT_ORDER, ProjectOrderSchema);
}
