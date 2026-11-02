import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { shownHqPersonFactsAtom } from "@t3tools/client-runtime/data";
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import { EnvironmentId, type ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { RotateCcwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import { buildThreadRouteParams } from "../threadRoutes";
import { homeOverviewSearch } from "../zerops/homeLanding.logic";
import { useHqMatesRead } from "../zerops/useHqMatesRead";
import { PageStandIn } from "../components/RoutePending";

function ChatIndexRouteView() {
  const { environmentId } = Route.useSearch();
  return environmentId === undefined ? (
    <HomeOverview />
  ) : (
    <ConnectLanding environmentId={EnvironmentId.make(environmentId)} />
  );
}

/**
 * The empty link opens the overview, on Mine or All (`homeOverviewSearch`) once HQ has answered
 * for the organization in view or is known not to; meanwhile the page's room waits.
 */
function HomeOverview() {
  const { settled } = useHqMatesRead();
  const facts = useAtomValue(shownHqPersonFactsAtom);
  const navigate = useNavigate();
  const sentRef = useRef(false);
  useEffect(() => {
    if (!settled || sentRef.current) return;
    sentRef.current = true;
    void navigate({ to: "/zerops", search: homeOverviewSearch(facts), replace: true });
  }, [facts, navigate, settled]);
  return <PageStandIn />;
}

type ConnectLandingTarget =
  | { readonly kind: "thread"; readonly ref: ScopedThreadRef }
  | {
      readonly kind: "draft";
      readonly project: { readonly environmentId: EnvironmentId; readonly id: ProjectId };
    }
  | { readonly kind: "none" };

/**
 * A connect hands over the environment it just made ours (`?environmentId=…`): the landing is that
 * environment's main chat (`resolvePrimaryConversation`), else a draft in its most recent project,
 * and nothing at all until its shell has arrived — never another environment's project because
 * that one was cached first. A Mate's other chats are opened from its conversation strip, never by
 * landing; with nothing to land on, the overview.
 */
function ConnectLanding({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const projects = useProjects();
  const threads = useThreadShells();
  const handleNewThread = useNewThreadHandler();
  const navigate = useNavigate();
  const shell = useEnvironmentQuery(environmentShell.stateAtom(environmentId));
  const bootstrapped = shell.data?.snapshot._tag === "Some";
  // Keyed by the chosen destination, not a bare flag: a better target that
  // arrives a tick later (the environment's own conversation) must be able
  // to supersede an earlier pick.
  const startedForKeyRef = useRef<string | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });

  const landing = useMemo((): ConnectLandingTarget | null => {
    if (!bootstrapped) return null;
    const environmentThreads = threads.filter((thread) => thread.environmentId === environmentId);
    const { primary } = resolvePrimaryConversation(environmentThreads);
    if (primary !== undefined) {
      return { kind: "thread", ref: scopeThreadRef(environmentId, primary.id) };
    }
    const project = sortScopedProjectsForSidebar(
      projects.filter((entry) => entry.environmentId === environmentId),
      environmentThreads,
      "updated_at",
    )[0];
    return project === undefined ? { kind: "none" } : { kind: "draft", project };
  }, [bootstrapped, environmentId, projects, threads]);

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
    void handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      replace: true,
    }).catch(() => {
      startedForKeyRef.current = null;
      setStartState((state) => ({ ...state, failed: true }));
    });
  }, [handleNewThread, landing, navigate, startState.retryRequest]);

  if (startState.failed) {
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
  }
  if (landing?.kind === "none") return <HomeOverview />;
  return <PageStandIn />;
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
