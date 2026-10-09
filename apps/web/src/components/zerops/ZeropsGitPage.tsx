/** The organization Git overview consumes the shared projection; local state holds presentation IDs only. */
import {
  changeKindTag,
  gitRepositoryLine,
  gitOverviewPresentation,
  type GitOverviewIdentity,
  type GitOverviewView,
} from "@t3tools/client-runtime/zerops";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useContext, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { InventoryContext, useAccountTrouble } from "~/zerops/inventoryContext";
import { useHqAppDetailHold } from "~/zerops/useHqAppDetail";
import { useAccountDataOptional } from "~/zerops/ZeropsAccountData";

import { appBasePath } from "~/basePath";
import { ZeropsRepositoryBrowser } from "./ZeropsRepositoryBrowser";
import { FlatCard, StatusDot } from "./primitives";
import { useMateNames, useProjectFlows } from "~/zerops/projectFlows";
import { useChangeOffers } from "~/zerops/useChangeOffers";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { ZeropsSessionAccountControl } from "./landing/ZeropsAccountControl";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { gitPageState, type GitPageState } from "./ZeropsGitPage.logic";
import { ZeropsOrganizationSwitcher } from "./ZeropsOrganizationScope";

function Reading() {
  return (
    <p className="text-sm text-muted-foreground" role="status" data-zerops-surface="git-reading">
      Reading repositories and changes…
    </p>
  );
}

function ReadTrouble({
  failure,
  onAgain,
}: {
  readonly failure: string | null;
  readonly onAgain?: (() => void) | undefined;
}) {
  if (failure === null) return null;
  return (
    <div className="flex flex-col gap-2" data-zerops-surface="git-read-trouble">
      <p className="text-sm text-status-failed" role="alert">
        {failure}
      </p>
      {onAgain === undefined ? null : (
        <div>
          <Button variant="ghost" size="sm" onClick={onAgain}>
            Read again
          </Button>
        </div>
      )}
    </div>
  );
}

export function ZeropsGitOverview({
  state,
  onOpenChange,
  repositoryHref,
  onOpenRepository,
  onAgain,
}: {
  readonly state: GitPageState;
  readonly onAgain?: (() => void) | undefined;
  readonly repositoryHref?: (appId: string, repo: string) => string;
  readonly onOpenRepository?: (appId: string, repo: string) => void;
  /** Opens a change's own page. */
  readonly onOpenChange?: (appId: string, repository: string, number: number) => void;
}) {
  const [view, setView] = useState<GitOverviewView>("open");
  const [held, setHeld] = useState<ReadonlyArray<GitOverviewIdentity>>();
  const presentation = gitOverviewPresentation(state.kind === "read" ? state.apps : [], view, held);
  // Capture the first readable list; purge identities removed by the authoritative projection.
  if (
    state.kind === "read" &&
    (presentation.rows.length > 0 || (!state.reading && state.failure === null)) &&
    JSON.stringify(held) !== JSON.stringify(presentation.identities)
  ) {
    setHeld(presentation.identities);
  }
  if (state.kind === "refused" && held !== undefined && held.length > 0) setHeld([]);
  if (state.kind === "refused")
    return (
      <p className="text-sm text-status-failed" role="alert" data-zerops-surface="git-refused">
        {state.reason}
      </p>
    );
  if (state.kind === "unread")
    return state.failure === null ? (
      <Reading />
    ) : (
      <ReadTrouble failure={state.failure} onAgain={onAgain} />
    );

  const incomplete = presentation.incomplete || state.reading || state.failure !== null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" role="group" aria-label="Repository view">
          {(
            [
              ["open", "Open changes"],
              ["all", "All repositories"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={view === value ? "outline" : "ghost-muted"}
              size="sm"
              aria-pressed={view === value}
              onClick={() => {
                setView(value);
                setHeld(undefined);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Project, then repository A–Z</span>
      </div>
      <ReadTrouble failure={state.failure} onAgain={onAgain} />
      {state.reading ? <Reading /> : null}
      {state.failure !== null && presentation.rows.some((row) => row.coverage !== "unread") ? (
        <p className="text-xs text-muted-foreground">Showing the last read changes.</p>
      ) : null}
      {state.refusals?.map(({ appId, name, reason }) => (
        <p key={appId} className="text-sm text-muted-foreground" role="status">
          {name}: {reason}
        </p>
      ))}
      {presentation.changed ? (
        <div className="flex items-center gap-3" role="status">
          <span className="text-sm text-muted-foreground">The repository list has changed.</span>
          <Button variant="outline" size="sm" onClick={() => setHeld(undefined)}>
            Update list
          </Button>
        </div>
      ) : null}
      {presentation.rows.length > 0 ? (
        <section aria-label="Repositories" data-zerops-surface="git-overview">
          <FlatCard>
            <div className="divide-y divide-border">
              {presentation.rows.map((repository) => {
                const changeRows = repository.changes.map(({ pull, line, status }) => {
                  return (
                    <div key={pull.number} className="flex min-w-0 items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" data-zerops-surface="pull-request-title">
                          {pull.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{line}</span>
                          <span>{changeKindTag(pull)}</span>
                          {status === undefined ? null : (
                            <StatusDot label={status.word} sentence tone={status.tone} />
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={onOpenChange === undefined}
                        aria-label={`Review ${repository.project} / ${repository.name} #${pull.number}`}
                        onClick={() =>
                          onOpenChange?.(repository.appId, pull.repository, pull.number)
                        }
                      >
                        Review
                      </Button>
                    </div>
                  );
                });
                return (
                  <div
                    className="px-4 py-3"
                    key={JSON.stringify([repository.appId, repository.name])}
                    data-zerops-git-app={repository.appId}
                    data-zerops-git-repository={repository.name}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{repository.project}</span>
                      <span className="text-muted-foreground">/</span>
                      {repositoryHref === undefined ? (
                        <span className="font-medium">{repository.name}</span>
                      ) : (
                        <a
                          className="min-w-0 truncate rounded-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          href={repositoryHref(repository.appId, repository.name)}
                          onClick={(event) => {
                            if (
                              onOpenRepository === undefined ||
                              event.button !== 0 ||
                              event.ctrlKey ||
                              event.metaKey ||
                              event.altKey ||
                              event.shiftKey
                            )
                              return;
                            event.preventDefault();
                            onOpenRepository(repository.appId, repository.name);
                          }}
                        >
                          {repository.name}
                        </a>
                      )}
                      {repository.name === "group" ? (
                        <span className="text-xs text-muted-foreground">Recipe</span>
                      ) : null}
                    </div>
                    {repository.coverage === "unread" ? (
                      <p className="mt-2 text-xs text-muted-foreground">Changes not read yet.</p>
                    ) : null}
                    {changeRows.length > 1 ? (
                      <details>
                        <summary className="mt-2 cursor-pointer text-xs text-muted-foreground">
                          {repository.changes.some(({ pull }) => pull.merged)
                            ? `${changeRows.length} changes`
                            : gitRepositoryLine(changeRows.length)}
                        </summary>
                        {changeRows}
                      </details>
                    ) : changeRows.length === 1 ? (
                      changeRows
                    ) : repository.coverage === "complete" ? (
                      <p className="mt-2 text-xs text-muted-foreground">No open changes.</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </FlatCard>
          <p className="mt-3 text-xs text-muted-foreground">
            {view === "all" ? (
              <>
                {presentation.rows.length}{" "}
                {presentation.rows.length === 1 ? "repository" : "repositories"} ·{" "}
              </>
            ) : null}
            {presentation.openChanges}
            {incomplete ? " known" : ""} open{" "}
            {presentation.openChanges === 1 ? "change" : "changes"}
            {view === "open" ? (
              <>
                {" "}
                in {presentation.rows.length}{" "}
                {presentation.rows.length === 1 ? "repository" : "repositories"}
              </>
            ) : null}
          </p>
        </section>
      ) : incomplete ? null : state.apps.every((app) => app.repositories.length === 0) ? (
        <div className="flex flex-col gap-2" data-zerops-surface="git-empty">
          <p className="text-sm text-muted-foreground">
            No repositories yet. Repositories appear here after a project is set up.
          </p>
          <a
            className="text-sm text-primary underline-offset-2 hover:underline"
            href={`${appBasePath()}/zerops`}
          >
            Open Projects
          </a>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No open changes.</p>
      )}
    </>
  );
}

export function ZeropsGitPage() {
  const { activeOrganization, organizations, organizationStatus, selectOrganization, status } =
    useZeropsSession();
  const retryAccount = useAccountDataOptional()?.retry;
  const flow = useProjectFlows("every");
  const mateNames = useMateNames();
  const registry = useZeropsRegistry();
  const offersOf = useChangeOffers();
  const inventory = useContext(InventoryContext);
  const accountTrouble = useAccountTrouble();
  const navigate = useNavigate();
  const search = useSearch({ from: "/git" });
  // Each application's repositories and changes are its detail: held while the page draws it.
  useHqAppDetailHold(registry.registry.groups.map(({ groupId }) => groupId));
  // Every application the person may read the changes of: the one whose changes HQ's rule keeps
  // from them is listed elsewhere, and is not read here.
  const apps = useMemo(
    () =>
      registry.registry.groups.map((group) => {
        const groupFlow = flow.flows.get(group.groupId);
        const offers = offersOf(group.groupId);
        return {
          appId: group.groupId,
          name: group.name,
          read: offers?.read,
          readReason: offers?.why.read,
          merged: groupFlow?.merged,
          changes: groupFlow?.changesKnown === true ? groupFlow.pullRequests : undefined,
          repositories: groupFlow?.repos,
          failure: flow.releaseFailures.get(group.groupId) ?? groupFlow?.changesFailure,
        };
      }),
    [flow.flows, flow.releaseFailures, offersOf, registry.registry.groups],
  );
  const state = gitPageState({
    appsKnown: !registry.loading,
    apps,
    failure: flow.readFailure ?? inventory?.error ?? undefined,
    mateName: (projectId) => mateNames.get(projectId),
  });
  const scoped =
    status === "signed-in" && organizationStatus === "selected" && activeOrganization !== null;

  return (
    <ZeropsHostedFrame
      width="expanded"
      actions={
        <>
          {scoped ? (
            <ZeropsOrganizationSwitcher
              activeOrganization={activeOrganization}
              organizations={organizations}
              onSelect={(membershipId) => {
                void selectOrganization(membershipId);
              }}
            />
          ) : null}
          <ZeropsSessionAccountControl />
        </>
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5" data-zerops-surface="git-header">
          <h1 className="text-xl font-medium text-foreground">Git</h1>
          <p className="text-sm text-muted-foreground">
            Repositories and open changes across your projects.
          </p>
        </div>
        <Button
          variant="ghost-muted"
          size="sm"
          onClick={() => {
            retryAccount?.();
            if (inventory?.error || accountTrouble?.trouble) accountTrouble?.retry();
          }}
        >
          Read again
        </Button>
      </div>
      {search.appId !== undefined && search.repo !== undefined ? (
        <ZeropsRepositoryBrowser
          key={`${activeOrganization?.id}:${search.appId}:${search.repo}`}
          allowed={offersOf(search.appId)?.read}
          accessReason={offersOf(search.appId)?.why.read}
          appId={search.appId}
          repo={search.repo}
          query={{
            ...(search.rev === undefined ? {} : { rev: search.rev }),
            path: search.path ?? "",
            kind: search.kind ?? "tree",
          }}
          onBack={() => {
            void navigate({ to: "/git", search: {} });
          }}
          onNavigate={(query) => {
            void navigate({
              to: "/git",
              search: (previous) => ({ ...previous, ...query }),
            });
          }}
        />
      ) : (
        <ZeropsGitOverview
          key={activeOrganization?.id ?? "unscoped"}
          onAgain={() => {
            retryAccount?.();
            if (inventory?.error || accountTrouble?.trouble) accountTrouble?.retry();
          }}
          repositoryHref={(appId, repo) =>
            `${appBasePath()}/git?${new URLSearchParams({ appId, repo })}`
          }
          onOpenRepository={(appId, repo) => {
            void navigate({ to: "/git", search: { appId, repo } });
          }}
          onOpenChange={(appId, repository, number) => {
            void navigate({
              to: "/change/$groupId/$repository/$number",
              params: { groupId: appId, repository, number: String(number) },
            });
          }}
          state={state}
        />
      )}
    </ZeropsHostedFrame>
  );
}
