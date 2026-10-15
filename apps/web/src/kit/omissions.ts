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
  {
    name: "Loading: RouteStandIn, useConversationPanelStandIn",
    source:
      "apps/web/src/components/zerops/RouteStandIn.tsx, apps/web/src/components/chat/ConversationPanelStandIn.tsx",
    reason:
      "They read the composer's draft store and the right panel's store; their looks are the held room and SurfaceLoading, both shown.",
  },
  {
    name: "Waiting: native progress bar",
    source: "apps/web/src/components/settings/ProviderSetupSection.tsx:274",
    reason:
      "Inline in a provider's setup, drawn only while that provider downloads; no component of its own.",
  },
  {
    name: "Waiting: Mac setup numbered steps",
    source: "apps/web/src/components/zerops/ZeropsMacPanel.tsx:155",
    reason: "Inline in the Mac panel, which reads its conversation's thread.",
  },
  {
    name: "Waiting: elapsed words (“Running for 1m 12s”)",
    source:
      "apps/web/src/components/GitActionsControl.tsx:274, apps/web/src/components/AgentsPanel.tsx:97",
    reason: "Inline in components that read git and helper state; no component of their own.",
  },
  {
    name: "Waiting: ConversationWorking",
    source: "apps/web/src/components/chat/ConversationWorking.tsx:836",
    reason:
      "Reads its conversation's environment, thread and incidents; its working line is shown as RunLine.",
  },
  {
    name: "Empty: centred title and line, inline",
    source:
      "apps/web/src/components/DiffPanel.tsx:937, AgentsPanel.tsx:756, settings/ThemeSearchSection.tsx:368, ThreadTerminalDrawer.tsx:1521, Sidebar.tsx:3317",
    reason:
      "Five inline blocks inside components that read app state; none is a component to render.",
  },
  {
    name: "Empty: RightPanelEmptyState",
    source: "apps/web/src/components/RightPanelTabs.tsx:229",
    reason:
      "The panel's launcher focuses itself on mount and takes letter keys page-wide, opening panels the page does not have.",
  },
  {
    name: "Empty: TimelineEmptyState, ZeropsMateEmptyState, CrewmateEmptyState",
    source:
      "apps/web/src/components/chat/MessagesTimeline.tsx:4771, zerops/ZeropsMateEmptyState.tsx:85, zerops/crew/CrewmateEmptyState.tsx:55",
    reason:
      "They read the Mate, its account and its crew from the data layer; the stage they draw is MateEmptyStateView, shown.",
  },
  {
    name: "Failure: RootRouteErrorView, DraftStartError, DiffFailure, FailedTake",
    source:
      "apps/web/src/routes/__root.tsx:497, routes/_chat.index.tsx:293, components/chat/ReviewCommentDiff.tsx:11, components/chat/BrowserStrip.tsx:645",
    reason:
      "The router's error for a route, a draft's start, a live diff's context and a browser operation's take: each needs the thing that failed.",
  },
];
