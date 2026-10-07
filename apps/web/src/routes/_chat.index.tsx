import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import { EnvironmentId, type ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { RotateCcwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PageWaitLine } from "../components/zerops/WaitLine";
import { ZeropsHostedLanding } from "../components/zerops/landing/ZeropsHostedLanding";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "../state/entities";
import { environmentCatalog } from "../connection/catalog";
import { useEnvironments } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell, environmentsWithSnapshotAtom } from "../state/shell";
import { buildThreadRouteParams } from "../threadRoutes";
import { mateDeleting, useDeletingMates } from "../zerops/deletingMates";
import { useZeropsCandidates } from "../zerops/useZeropsCandidates";
import { useOpenMate } from "../zerops/useOpenMate";
import { useZeropsInventory } from "../zerops/inventoryContext";
import { useZeropsSession } from "../zerops/ZeropsSessionProvider";
import { hqMatesAtom, zeropsEnvironmentsAtom } from "../state/zerops";
import { homeTarget, homeView, hqHomeMate } from "../zerops/homeLanding.logic";
import { useHqMatesRead } from "../zerops/useHqMatesRead";
import { useDiscoveryStatus } from "../zerops/useDiscoveryStatus";
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
 * holds just its route lease. Else the connected environments' projects; a registration that does
 * not answer never claims the landing with its cached projects, and only the organization in view
 * lands anything (`homeTarget`).
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
 * end. With nowhere to land it is the projects page, where New project works.
 */
function IndexDraftLanding() {
  const projects = useProjects();
  const threads = useThreadShells();
  const discovery = useDiscoveryStatus();
  const { settled: hqMatesRead } = useHqMatesRead();
  const hqMates = useAtomValue(hqMatesAtom);
  const openMate = useOpenMate();
  const { activeOrganization, organizationStatus } = useZeropsSession();
  const inventory = useZeropsInventory();
  const catalogFailed = AsyncResult.isFailure(useAtomValue(environmentCatalog.catalogAtom));
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
  // Every organization's registrations; each says the Zerops project it serves.
  const zeropsEnvironments = useAtomValue(zeropsEnvironmentsAtom);
  const organizationProjects = useMemo(
    () => new Set(heldCandidates(listing).rows.map((row) => row.project.id)),
    [listing],
  );
  // Keyed by the chosen destination, not a bare flag: a better target that
  // arrives a tick later (the named environment's own project) must be able
  // to supersede an earlier pick.
  const startedForKeyRef = useRef<string | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });
  const [projectsShown, setProjectsShown] = useState<{
    readonly organizationId: string | null;
  } | null>(null);

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

    // HQ names unopened Mates too; opening only the chosen route holds its lease (A9).
    const hqMate = hqHomeMate(hqMates?.mates ?? null, unavailable);
    const target = homeTarget({
      target:
        targetEnvironmentId === null
          ? null
          : { environmentId: targetEnvironmentId, bootstrapped: targetBootstrapped },
      hqMate:
        hqMates === null || hqMate === undefined
          ? null
          : { organizationId: hqMates.organizationId, projectId: hqMate },
      hqMatesRead,
      organizationId: activeOrganization?.id ?? null,
      organizationProjects,
      environments: zeropsEnvironments.map((environment) => ({
        environmentId: environment.environmentId,
        phase: environment.connection.phase,
        snapshot: withSnapshot.has(environment.environmentId),
        zeropsProjectId: environment.zeropsProjectId,
      })),
    });
    if (target === null || target.kind === "none" || target.kind === "mate") return target;
    if (target.kind === "environment") {
      const environmentThreads = threads.filter(
        (thread) => thread.environmentId === target.environmentId,
      );
      const { primary } = resolvePrimaryConversation(environmentThreads);
      if (primary !== undefined) {
        return { kind: "thread", ref: scopeThreadRef(target.environmentId, primary.id) };
      }
      return landingIn(
        sortScopedProjectsForSidebar(
          projects.filter((entry) => entry.environmentId === target.environmentId),
          environmentThreads,
          "updated_at",
        )[0],
      );
    }
    const among = new Set<EnvironmentId>(target.environmentIds);
    return landingIn(
      sortScopedProjectsForSidebar(
        projects.filter((entry) => among.has(entry.environmentId)),
        threads,
        "updated_at",
      )[0],
    );
  }, [
    activeOrganization,
    hqMates,
    hqMatesRead,
    unavailable,
    organizationProjects,
    zeropsEnvironments,
    projects,
    targetBootstrapped,
    targetEnvironmentId,
    threads,
    withSnapshot,
  ]);

  const view = homeView({
    landing: landing === null ? "unknown" : landing.kind === "none" ? "none" : "going",
    startFailed: startState.failed,
    targeted: targetEnvironmentId !== null,
    hqMatesRead,
    organizationId: activeOrganization?.id ?? null,
    organization: organizationStatus,
    accountTrouble: inventory.error !== null || discovery === "unavailable",
    catalogFailed,
    // A negative answer needs both the platform/registration read and HQ's unopened Mates.
    projectsRead: discovery === "complete",
    projectsShown,
  });
  // Kept from the render that painted it, so nothing it holds — an open row, a dialog — is torn
  // down by a read unsettled again.
  if (
    view.kind === "projects" &&
    (projectsShown === null || projectsShown.organizationId !== view.organizationId)
  ) {
    setProjectsShown({ organizationId: view.organizationId });
  }
  const held = view.kind === "projects";

  useEffect(() => {
    // A retry re-runs this effect; the key below was cleared by the failure.
    void startState.retryRequest;
    if (held || landing === null || landing.kind === "none") return;
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
  }, [handleNewThread, held, landing, navigate, openMate, startState.retryRequest]);

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
    case "projects":
      return <ZeropsHostedLanding />;
    // While it works out where to land, and on its way there: the wait line, never a guess.
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

export const Route = createFileRoute("/_chat/")({
  // A connect hands over the environment it just made ours, so the landing
  // opens that one rather than whichever project was cached first.
  validateSearch: (raw: Record<string, unknown>): { environmentId?: string } =>
    typeof raw.environmentId === "string" && raw.environmentId.length > 0
      ? { environmentId: raw.environmentId }
      : {},
  component: ChatIndexRouteView,
});
