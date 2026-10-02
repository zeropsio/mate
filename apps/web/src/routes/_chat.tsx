import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useClientSettings } from "../hooks/useSettings";
import { openCommandPalette } from "../commandPaletteBus";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { SidebarInset } from "~/components/ui/sidebar";
import { PageWaitLine } from "~/components/zerops/WaitLine";
import { MateOpeningView } from "~/components/zerops/MateLinkStage";
import { rememberedMateIdentity } from "~/zerops/mateIdentityMemory";
import { BOOT_WAIT_LINE_MS, READING_PROJECTS_LINE } from "~/zerops/waitLine.logic";
import { resolveDoor } from "./-door";
import { environmentIdFromPathname } from "./-environmentRoute";
import { resolveThreadRouteRef } from "../threadRoutes";
import { loadDoorEnvironmentCount } from "./-doorEnvironments";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupCount = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: () => null,
      }).length,
    [primaryEnvironmentId, projectGroupingSettings, projects],
  );
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      if (isCommandPaletteOpen()) {
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        // Route creation through the command palette whenever there is a real
        // project choice; single-project setups create in context immediately.
        if (projectGroupCount > 1) {
          openCommandPalette({ open: "new-thread-in" });
          return;
        }
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    projectGroupCount,
    routeThreadRef,
    selectedThreadKeysSize,
    terminalOpen,
  ]);

  return null;
}

function ChatRouteLayout() {
  return (
    <>
      <ChatRouteGlobalShortcuts />
      <Outlet />
    </>
  );
}

function ChatRoutePending() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const routed = environmentIdFromPathname(pathname);
  const threadId = pathname.split("/").filter((part) => part.length > 0)[1];
  const threadRef =
    routed === null || threadId === undefined
      ? null
      : resolveThreadRouteRef({ environmentId: routed, threadId });
  if (threadRef !== null && rememberedMateIdentity(threadRef.environmentId) !== undefined) {
    return <MateOpeningView threadRef={threadRef} />;
  }
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh">
      <PageWaitLine delayMs={BOOT_WAIT_LINE_MS} from="mount" text={READING_PROJECTS_LINE} />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: await loadDoorEnvironmentCount(),
    });
    if (door.redirect !== null) {
      // The product entry is Zerops account sign-in. Standalone pairing stays
      // available at `/pair`, but it must not replace the login just because a
      // fresh browser opened the bare localhost origin.
      const destination =
        location.pathname === "/" && door.redirect === "/pair" ? "/zerops" : door.redirect;
      throw redirect({ to: destination, replace: true });
    }
  },
  component: ChatRouteLayout,
  // Its guard waits on the environment catalog: meanwhile the layout draws what the reload was
  // drawing — the Mate's own view where this browser remembers it, else the page quiet with the
  // boot's one line — and hands over the moment the guard answers.
  pendingComponent: ChatRoutePending,
  pendingMs: 0,
  pendingMinMs: 0,
});
