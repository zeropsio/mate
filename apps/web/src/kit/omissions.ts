import type { KitOmission } from "./kitSection";

/** Exports of `components/ui` the kit page does not show, each with its reason. */
export const KIT_OMISSIONS: readonly KitOmission[] = [
  {
    name: "PortalGate, gatedPortal",
    source: "apps/web/src/components/ui/portal-gate.tsx",
    reason:
      "No look of its own: it removes the floating layers below it while something covers the page.",
  },
  {
    name: "stackedThreadToast",
    source: "apps/web/src/components/ui/toastHelpers.ts",
    reason: "Builds a toast for a conversation; it needs a thread from the data layer.",
  },
  {
    name: "useSidebar, useOptionalSidebar, readSidebarOpen",
    source: "apps/web/src/components/ui/sidebar.tsx",
    reason: "Hooks and a cookie read: behaviour, no look.",
  },
  {
    name: "useComboboxFilter, NumberFieldPrimitive, FieldControl, FieldValidity",
    source: "apps/web/src/components/ui",
    reason:
      "Primitives and hooks the shown components are built from; they have no look of their own.",
  },
  {
    name: "SidebarRail",
    source: "apps/web/src/components/ui/sidebar.tsx",
    reason:
      "The resize handle of a resizable sidebar in the app's shell; a fixed box has nothing to resize.",
  },
  {
    name: "Overlays pinned open",
    source: "apps/web/src/components/ui",
    reason:
      "Open on load, a Popover or Menu takes focus and scrolls the page to itself, a Dialog or Sheet covers it, and a Tooltip is placed outside the page's scroller; each overlay has an opener instead.",
  },
  {
    name: "Focus-visible states",
    source: "apps/web/src/components/ui",
    reason: "A page cannot force :focus-visible; Tab through a section to see it.",
  },
];
