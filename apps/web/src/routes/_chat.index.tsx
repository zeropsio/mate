import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import { EnvironmentId, type ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { LinkIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { ZeropsHostedLanding } from "../components/zerops/landing/ZeropsHostedLanding";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
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
import { APP_DISPLAY_NAME } from "~/branding";
import { countDoorEnvironments, resolveDoor } from "./-door";
import { composeZeropsFirstPrompt } from "~/zerops/composeFirstPrompt";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments } = useEnvironments();

  const door = resolveDoor(authGateState, {
    pathname: "/",
    environmentCount: countDoorEnvironments(environments),
  });

  if (door.surface === "zerops-onboarding") {
    // Upstream's empty state is kept whole and handed to the landing, which
    // offers it as the manual fallback.
    return <ZeropsHostedLanding manualFallback={<HostedStaticOnboardingState />} />;
  }

  return <IndexDraftLanding />;
}

/**
 * Where landing on the index goes.
 *
 * With an environment named in the search (`?environmentId=…`, which is how
 * a connect hands over), the landing is *that* environment's: its one
 * conversation when it has one, else a draft in its most recent project, and
 * nothing at all until its shell has arrived — never some other environment's
 * project because that one happened to be cached first.
 *
 * Without one, the most recently active project wins, but only among
 * environments whose socket is up: a registration whose container is gone
 * keeps its cached projects, and those must not claim the landing.
 */
type IndexLanding =
  | { readonly kind: "thread"; readonly ref: ScopedThreadRef }
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
    if (targetEnvironmentId !== null) {
      if (!targetBootstrapped) return null;
      const environmentThreads = threads.filter(
        (thread) => thread.environmentId === targetEnvironmentId,
      );
      const { primary } = resolvePrimaryConversation(environmentThreads);
      if (primary !== undefined) {
        return { kind: "thread", ref: scopeThreadRef(targetEnvironmentId, primary.id) };
      }
      const project = sortScopedProjectsForSidebar(
        projects.filter((entry) => entry.environmentId === targetEnvironmentId),
        environmentThreads,
        "updated_at",
      )[0];
      return project === undefined ? { kind: "none" } : { kind: "draft", project };
    }

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
      const project = sortScopedProjectsForSidebar(
        projects.filter((entry) => liveIds.has(entry.environmentId)),
        threads,
        "updated_at",
      )[0];
      return project === undefined ? { kind: "none" } : { kind: "draft", project };
    }
    if (!bootstrapped) return null;
    const project = sortScopedProjectsForSidebar(projects, threads, "updated_at")[0];
    return project === undefined ? { kind: "none" } : { kind: "draft", project };
  }, [
    bootstrapped,
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
      landing.kind === "thread"
        ? `thread:${landing.ref.environmentId}:${landing.ref.threadId}`
        : `draft:${landing.project.environmentId}:${landing.project.id}`;
    if (startedForKeyRef.current === key) return;
    startedForKeyRef.current = key;

    if (landing.kind === "thread") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(landing.ref),
        replace: true,
      });
      return;
    }
    const { project } = landing;
    void handleNewThread(scopeProjectRef(project.environmentId, project.id), { replace: true })
      .then((started) => {
        // A project reached through the Zerops door opens with zcp's own
        // introduction already written, once.
        if (started) {
          composeZeropsFirstPrompt({
            environmentId: project.environmentId,
            draftId: started.draftId,
          });
        }
      })
      .catch(() => {
        startedForKeyRef.current = null;
        setStartState((state) => ({ ...state, failed: true }));
      });
  }, [handleNewThread, landing, navigate, startState.retryRequest]);

  if (landing === null) {
    return null;
  }
  if (landing.kind !== "none") {
    return startState.failed ? (
      <DraftStartError
        onRetry={() => {
          setStartState((state) => ({
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    ) : null;
  }
  return <NoProjectsHero />;
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle className="text-foreground text-xl">Couldn’t start a new thread</EmptyTitle>
          <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
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
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-2xl sm:text-3xl">
                What should we work on?
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
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

function HostedStaticOnboardingState() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle className="text-foreground text-xl">
                Connect an environment to get started
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm leading-relaxed text-muted-foreground/78">
                Add a reachable backend manually to start working from this browser.
              </EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<Link to="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  Add environment
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
