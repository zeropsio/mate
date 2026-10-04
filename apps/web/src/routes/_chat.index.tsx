import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import { EnvironmentId, type ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { HomeOpeningView } from "../components/zerops/MateLinkStage";
import { PageWaitLine } from "../components/zerops/WaitLine";
import { ZeropsHostedLanding } from "../components/zerops/landing/ZeropsHostedLanding";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { useEnvironments } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell, environmentsWithSnapshotAtom } from "../state/shell";
import { buildThreadRouteParams } from "../threadRoutes";
import { mateDeleting, useDeletingMates } from "../zerops/deletingMates";
import { useZeropsCandidates } from "../zerops/useZeropsCandidates";
import { useOpenMate } from "../zerops/useOpenMate";
import { useZeropsSession } from "../zerops/ZeropsSessionProvider";
import { hqMatesAtom } from "../state/zerops";
import { hqHomeMate, homeView } from "../zerops/homeLanding.logic";
import { rememberedHomeLanding } from "../zerops/lastConversationMemory";
import { useHqMatesRead } from "../zerops/useHqMatesRead";
import { useMatesSettled } from "../zerops/useMatesSettled";
import { BOOT_WAIT_LINE_MS, READING_PROJECTS_LINE } from "../zerops/waitLine.logic";
import { countDoorEnvironments, resolveDoor } from "./-door";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { status } = useZeropsSession();
  const { environments } = useEnvironments();

  const door = resolveDoor(authGateState, {
    pathname: "/",
    environmentCount: countDoorEnvironments(environments),
  });

  if (door.surface === "zerops-onboarding" && status !== "signed-in") {
    // Upstream's empty state is kept whole and handed to the landing, which
    // offers it as the manual fallback.
    return <ZeropsHostedLanding />;
  }

  return <IndexDraftLanding />;
}

/**
 * Where landing on the index goes.
 *
 * With an environment named in the search (`?environmentId=…`, which is how
 * a connect hands over), the landing is *that* environment's, and nothing at
 * all until its shell has arrived — never some other environment's project
 * because that one happened to be cached first.
 *
 * Without one, HQ names the most recently active Mate, preferring an online one. Opening it
 * holds just its route lease. Local environments fall back to their connected projects.
 *
 * Either way the landing is the environment's main chat when it has one
 * (`resolvePrimaryConversation`), else a draft in the project: a Mate's other
 * chats are opened from its conversation strip, never by landing.
 */
type IndexLanding =
  | { readonly kind: "mate"; readonly projectId: string }
  | {
      readonly kind: "thread";
      readonly ref: ScopedThreadRef;
    }
  | {
      readonly kind: "draft";
      readonly project: { readonly environmentId: EnvironmentId; readonly id: ProjectId };
    }
  | { readonly kind: "none" };

/**
 * Landing on the index route drops straight into the conversation or a draft
 * for the right project, so the first screen is a prompt instead of a dead
 * end. Falls back to an add-project hero when no project exists yet.
 */
function IndexDraftLanding() {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const matesSettled = useMatesSettled();
  const { settled: hqMatesRead } = useHqMatesRead();
  const hqMates = useAtomValue(hqMatesAtom);
  const openMate = useOpenMate();
  const { activeOrganization } = useZeropsSession();
  const deleting = useDeletingMates();
  const { listing } = useZeropsCandidates();
  const unavailable = useMemo(
    () =>
      new Set([
        ...deleting,
        ...heldCandidates(listing)
          .rows.filter((row) => mateDeleting(row.project, deleting))
          .map((row) => row.project.id),
      ]),
    [deleting, listing],
  );
  // Read once, as the page opens: what it waits with never changes under the eye.
  const [remembered] = useState(() => rememberedHomeLanding(activeOrganization?.id));
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const navigate = useNavigate();
  const { environmentId: targetSearch } = Route.useSearch();
  const targetEnvironmentId = useMemo(
    () => (targetSearch === undefined ? null : EnvironmentId.make(targetSearch)),
    [targetSearch],
  );
  const targetShell = useEnvironmentQuery(
    targetEnvironmentId === null ? null : environmentShell.stateAtom(targetEnvironmentId),
  );
  const targetBootstrapped = targetShell.data?.snapshot._tag === "Some";
  const withSnapshot = useAtomValue(environmentsWithSnapshotAtom);
  // Keyed by the chosen destination, not a bare flag: a better target that
  // arrives a tick later (the named environment's own project) must be able
  // to supersede an earlier pick.
  const startedForKeyRef = useRef<string | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });

  const landing = useMemo((): IndexLanding | null => {
    /** The environment's one conversation when it has one, else a draft in the project. */
    const landingIn = (
      project: { readonly environmentId: EnvironmentId; readonly id: ProjectId } | undefined,
    ): IndexLanding => {
      if (project === undefined) return { kind: "none" };
      const { primary } = resolvePrimaryConversation(
        threads.filter((thread) => thread.environmentId === project.environmentId),
      );
      return primary === undefined
        ? { kind: "draft", project }
        : { kind: "thread", ref: scopeThreadRef(project.environmentId, primary.id) };
    };

    if (targetEnvironmentId !== null) {
      if (!targetBootstrapped) return null;
      const environmentThreads = threads.filter(
        (thread) => thread.environmentId === targetEnvironmentId,
      );
      const { primary } = resolvePrimaryConversation(environmentThreads);
      if (primary !== undefined) {
        return { kind: "thread", ref: scopeThreadRef(targetEnvironmentId, primary.id) };
      }
      return landingIn(
        sortScopedProjectsForSidebar(
          projects.filter((entry) => entry.environmentId === targetEnvironmentId),
          environmentThreads,
          "updated_at",
        )[0],
      );
    }

    // HQ names unopened Mates too; opening only the chosen route holds its lease (A9).
    const projectId = hqHomeMate(hqMates?.mates ?? null, unavailable);
    if (projectId !== undefined) return { kind: "mate", projectId };
    if (!hqMatesRead) return null;

    // A socket on its first attempt is about to tell us something; a live
    // one whose shell has not arrived yet is about to hand us its projects.
    // Either is worth a moment. A registration stuck reconnecting is not.
    if (environments.some((environment) => environment.connection.phase === "connecting")) {
      return null;
    }
    const live = environments.filter((environment) => environment.connection.phase === "connected");
    if (live.some((environment) => !withSnapshot.has(environment.environmentId))) return null;
    if (live.length > 0) {
      const liveIds = new Set(live.map((environment) => environment.environmentId));
      return landingIn(
        sortScopedProjectsForSidebar(
          projects.filter((entry) => liveIds.has(entry.environmentId)),
          threads,
          "updated_at",
        )[0],
      );
    }
    if (!bootstrapped) return null;
    return landingIn(sortScopedProjectsForSidebar(projects, threads, "updated_at")[0]);
  }, [
    bootstrapped,
    hqMates,
    hqMatesRead,
    unavailable,
    environments,
    projects,
    targetBootstrapped,
    targetEnvironmentId,
    threads,
    withSnapshot,
  ]);

  useEffect(() => {
    // A retry re-runs this effect; the key below was cleared by the failure.
    void startState.retryRequest;
    if (landing === null || landing.kind === "none") return;
    const key =
      landing.kind === "mate"
        ? `mate:${landing.projectId}`
        : landing.kind === "thread"
          ? `thread:${landing.ref.environmentId}:${landing.ref.threadId}`
          : `draft:${landing.project.environmentId}:${landing.project.id}`;
    if (startedForKeyRef.current === key) return;
    startedForKeyRef.current = key;

    if (landing.kind === "mate") {
      openMate({ projectId: landing.projectId });
      return;
    }
    if (landing.kind === "thread") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(landing.ref),
        replace: true,
      });
      return;
    }
    const { project } = landing;
    void handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      replace: true,
    }).catch(() => {
      startedForKeyRef.current = null;
      setStartState((state) => ({ ...state, failed: true }));
    });
  }, [handleNewThread, landing, navigate, openMate, startState.retryRequest]);

  const view = homeView({
    landing: landing === null ? "unknown" : landing.kind === "none" ? "none" : "going",
    startFailed: startState.failed,
    targeted: targetEnvironmentId !== null,
    remembered,
    hqMatesRead,
    // A negative answer needs both the platform/registration read and HQ's unopened Mates.
    projectsRead: matesSettled,
  });
  switch (view.kind) {
    case "start-failed":
      return (
        <DraftStartError
          onRetry={() => {
            setStartState((state) => ({
              failed: false,
              retryRequest: state.retryRequest + 1,
            }));
          }}
        />
      );
    case "hero":
      return <NoProjectsHero />;
    // While it works out where to land, and on its way there: its guess, never blank — nothing
    // in it takes input, so a wrong guess gives way, without motion, losing nothing typed.
    case "opening":
      return <HomeOpeningView environmentId={view.ref.environmentId} />;
    case "wait":
      return (
        <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh">
          <PageWaitLine delayMs={BOOT_WAIT_LINE_MS} from="mount" text={READING_PROJECTS_LINE} />
        </SidebarInset>
      );
  }
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>Couldn’t start a new thread</EmptyTitle>
          <EmptyDescription>
            The project is still available. Try opening the draft again.
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RotateCcwIcon className="size-4" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

function NoProjectsHero() {
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-2xl sm:text-3xl">
                What should we work on?
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-muted-foreground/78">
                Add a project to start your first thread.
              </EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button size="sm" onClick={openAddProject}>
                  <PlusIcon className="size-4" />
                  Add project
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  // A connect hands over the environment it just made ours, so the landing
  // opens that one rather than whichever project was cached first.
  validateSearch: (raw: Record<string, unknown>): { environmentId?: string } =>
    typeof raw.environmentId === "string" && raw.environmentId.length > 0
      ? { environmentId: raw.environmentId }
      : {},
  component: ChatIndexRouteView,
});
