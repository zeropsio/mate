import type { KitOmission } from "./kitSection";

/** What the kit page does not show — kit exports and home-made looks — each with its reason. */
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
    name: "ChatHeader",
    source: "apps/web/src/components/chat/ChatHeader.tsx",
    reason:
      "Home-made: a conversation's page header. It reads its thread and the thread's menu from the live client; its line, ConversationStripView, is shown under Home-made tabs.",
  },
  {
    name: "ThemeEditorPanel, ThemeEditorHost's loading box",
    source: "apps/web/src/components/settings/ThemeEditorPanel.tsx",
    reason:
      "Home-made role=\"dialog\" surfaces. The panel previews its draft on the whole page and saves themes to the person's settings, so opening it here would retheme /kit; the loading box only stands in while the panel's code loads.",
  },
  {
    name: "PictureViewer",
    source: "apps/web/src/components/zerops/review/ReviewDescription.tsx",
    reason:
      "Home-made: a raw Dialog primitive inside a change's review. Not exported; it opens from a picture in the review's description, behind ZeropsReviewDialog (shown).",
  },
  {
    name: "ProjectSites, ProjectReviewTags, the production chip's popover",
    source: "apps/web/src/components/zerops/SidebarProjectSites.tsx",
    reason:
      "Home-made: raw Popover primitives on a menu project row (SidebarProjectSites, SidebarProjectReview, SidebarProductionChip). They open from a project's flow — its stages, sites and changes — which the census's menu fixture does not hold.",
  },
  {
    name: "HelperCard, AgentsPanel's HelperRow",
    source: "apps/web/src/components/chat/HelperCard.tsx",
    reason:
      "Home-made cards and rows of a conversation's helpers. They read the Mate and its helpers from the data layer.",
  },
  {
    name: "ServiceCard, ServiceRow, ZeropsHqCard",
    source: "apps/web/src/components/zerops/ZeropsServiceMap.tsx",
    reason:
      "Home-made cards of a project's services and its HQ. ServiceCard and ServiceRow are not exported (ZeropsServiceMap draws them); ZeropsHqCard reads the session and the account's HQ.",
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
  // Home-made looks the census sections cannot render without an account, a thread or a project.
  {
    name: "ChiefOverviewButton",
    source: "apps/web/src/components/zerops/chief/ChiefOverviewButton.tsx",
    reason:
      "Home-made action: it opens the Chief's overview through the router and the right panel's store.",
  },
  {
    name: "ReviewButton, OpenButton (menu-wait-button)",
    source: "apps/web/src/components/zerops/SidebarWaiting.tsx",
    reason:
      "Home-made action: they open a review through useOpenReview, an operation on the data layer.",
  },
  {
    name: "FixAction, RestartAction (run-result-action)",
    source: "apps/web/src/components/chat",
    reason:
      "Home-made action: they ask a Mate to fix or restart through the Zerops session and account operations.",
  },
  {
    name: "Row-wide buttons (about 20 raw <button>)",
    source:
      "apps/web/src/components/sidebar/SidebarProjectTree.tsx, zerops/ZeropsDataTree.tsx, chat/RunChat.tsx, chat/DetailRow.tsx",
    reason:
      "Home-made action: each is a row of a list that reads projects, a database or a run; no row renders apart from its list.",
  },
  {
    name: "Square icon-only buttons (12 raw <button>)",
    source:
      "apps/web/src/components/AppSidebarLayout.tsx, settings/DiagnosticsSettings.tsx, sidebar/SidebarProviderUpdatePill.tsx",
    reason:
      "Home-made action: they sit in the app's shell, the diagnostics page and the provider update pill, which read the server and the router.",
  },
  {
    name: "Floating round buttons",
    source: "apps/web/src/components/ChatView.tsx, settings/ThemeColorPicker.tsx",
    reason:
      "Home-made action: the conversation's scroll-to-end button needs a thread; the theme's swatches need the theme being edited.",
  },
  {
    name: "Bordered chip and tab buttons",
    source:
      "apps/web/src/components/zerops/ZeropsMateCard.tsx, zerops/SidebarZeropsTree.tsx, GitActionsControl.tsx, zerops/SidebarProjectReview.tsx",
    reason:
      "Home-made action: they live in a Mate's card, the menu's tree and git actions, which read Mates, projects and git status.",
  },
  {
    name: "Cards and thumbnails as buttons",
    source:
      "apps/web/src/components/chat/RunChat.tsx, chat/BrowserStrip.tsx, chat/MessagePictures.tsx, zerops/ZeropsOrganizationScope.tsx, zerops/ZeropsAgentSignIn.tsx",
    reason: "Home-made action: each is fed by a thread, a run's pictures or the signed-in account.",
  },
  {
    name: "ThreadSyncStatusPill",
    source: "apps/web/src/components/chat/ThreadSyncStatusPill.tsx",
    reason: "Home-made label: it portals into the conversation header's slot (useThreadSyncSlot).",
  },
  {
    name: "SidebarUpdatePill",
    source: "apps/web/src/components/sidebar/SidebarUpdatePill.tsx",
    reason: "Home-made label: desktop only; it reads the desktop app's update state.",
  },
  {
    name: "SidebarProviderUpdatePill",
    source: "apps/web/src/components/sidebar/SidebarProviderUpdatePill.tsx",
    reason: "Home-made label: it reads the server's providers and navigates to their settings.",
  },
  {
    name: "ReleaseTag, ReviewTag (menu-tag)",
    source: "apps/web/src/components/zerops/SidebarProjectReview.tsx",
    reason:
      "Home-made label: they open a review through useOpenReview, an operation on the data layer.",
  },
  {
    name: "ZeropsChangeLinkChip",
    source: "apps/web/src/components/zerops/ZeropsChangeLinkChip.tsx",
    reason: "Home-made label: it resolves its link through HQ's address (useHqAddress).",
  },
  {
    name: "AccessChip",
    source: "apps/web/src/components/zerops/projects/ProjectAccessChips.tsx",
    reason:
      "Home-made label: a person's access to a project, with the menu that changes it; it needs the project's people.",
  },
  {
    name: "MatePill",
    source: "apps/web/src/components/chat/ConversationStrip.tsx",
    reason:
      "Home-made label: private to the conversation strip, which reads the Mate's crew and chats.",
  },
];
