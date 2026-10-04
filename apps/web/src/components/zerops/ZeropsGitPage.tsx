/**
 * The Git page — the footer's *Git*: every application this person may read the changes of, its
 * repositories and the changes open on them, across the whole account (SPEC §5.3, D26).
 *
 * Not a project's flow, which the left menu draws under each project; this is the one place that
 * answers "what is open, anywhere I can see". One section per application, named the way every
 * other surface names it; under it a row per repository with how many changes are open; under
 * each, the changes themselves, newest first.
 *
 * Everything on it is HQ's, as the flow holds it: each application's repositories, read with its
 * releases (`useZeropsAppReleases`), and the changes open on them, down its stream. A change's title opens the change's own page, with
 * the same word and the same colour its row wears on the projects screen and in the left menu (the
 * owner, 2026-09-19: "all pages are unified in how they look work feel have ux and abilities"). A
 * repository's name opens its source in HQ, at a branch or commit and path.
 *
 * Structural: what it says is `gitPageState`'s, the grouping, the order and every line
 * `gitOverview`'s (R5). `ZeropsGitPage` composes the account around the view; `ZeropsGitOverview`
 * is the view alone.
 */
import { changeKindTag, changeState, gitRepositoryLine } from "@t3tools/client-runtime/zerops";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

import { appBasePath } from "~/basePath";
import { ZeropsRepositoryBrowser } from "./ZeropsRepositoryBrowser";
import { StatusDot } from "./primitives";
import { useZeropsProjectFlow } from "~/zerops/projectFlowContext";
import { useChangeOffers } from "~/zerops/useChangeOffers";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { ZeropsSessionAccountControl } from "./landing/ZeropsAccountControl";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { gitPageState, type GitPageState } from "./ZeropsGitPage.logic";
import { ZeropsOrganizationSwitcher } from "./ZeropsOrganizationScope";
import { ZeropsPullRequestRow } from "./ZeropsPullRequestRow";

function ReadTrouble({ failure }: { readonly failure: string | null }) {
  if (failure === null) return null;
  return (
    <p className="text-sm text-status-failed" data-zerops-surface="git-read-trouble">
      {failure}
    </p>
  );
}

export function ZeropsGitOverview({
  state,
  onOpenChange,
  repositoryHref,
  onOpenRepository,
}: {
  readonly state: GitPageState;
  readonly repositoryHref?: (appId: string, repo: string) => string;
  readonly onOpenRepository?: (appId: string, repo: string) => void;
  /** Opens a change's own page. */
  readonly onOpenChange?: (appId: string, repository: string, number: number) => void;
}) {
  // Nothing read yet is not nothing: the list lands in a moment, and an empty state that gives
  // way to it is the layout shift this page refuses. A read that did not answer says why instead.
  if (state.kind === "unread") return <ReadTrouble failure={state.failure} />;
  if (state.apps.every((app) => app.repositories.length === 0)) {
    return (
      <>
        <ReadTrouble failure={state.failure} />
        <p className="text-sm text-muted-foreground" data-zerops-surface="git-empty">
          No repository yet. The first project brings one.
        </p>
      </>
    );
  }
  return (
    <>
      <ReadTrouble failure={state.failure} />
      <div className="flex flex-col gap-10" data-zerops-surface="git-overview">
        {state.apps.map((app) => (
          <section className="flex flex-col gap-3" data-zerops-git-app={app.appId} key={app.appId}>
            <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-foreground">
              {app.name}
            </h2>
            <ul className="flex flex-col divide-y divide-border/50">
              {app.repositories.map((repository) => (
                <li
                  className="flex flex-col"
                  data-zerops-git-repository={repository.name}
                  key={repository.name}
                >
                  <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto] sm:py-0">
                    {repositoryHref === undefined ? (
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {repository.name}
                      </span>
                    ) : (
                      <a
                        className="min-w-0 truncate rounded-sm text-sm text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        href={repositoryHref(app.appId, repository.name)}
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
                          onOpenRepository(app.appId, repository.name);
                        }}
                      >
                        {repository.name}
                      </a>
                    )}
                    <span className="col-span-2 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1">
                      {gitRepositoryLine(repository.changes.length)}
                    </span>
                  </div>
                  {repository.changes.length === 0 ? null : (
                    <ul className="flex flex-col divide-y divide-border/50 border-t border-border/50 ps-4">
                      {repository.changes.map(({ pull, line }) => {
                        const state = changeState(pull);
                        return (
                          <ZeropsPullRequestRow
                            key={pull.number}
                            line={line}
                            status={
                              state === undefined ? undefined : (
                                <StatusDot label={state.word} sentence tone={state.tone} />
                              )
                            }
                            tag={changeKindTag(pull)}
                            title={pull.title}
                            {...(onOpenChange === undefined
                              ? {}
                              : {
                                  onOpen: () => {
                                    onOpenChange(app.appId, pull.repository, pull.number);
                                  },
                                })}
                          />
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

export function ZeropsGitPage() {
  const { activeOrganization, organizations, organizationStatus, selectOrganization, status } =
    useZeropsSession();
  const flow = useZeropsProjectFlow();
  const registry = useZeropsRegistry();
  const offersOf = useChangeOffers();
  const navigate = useNavigate();
  const search = useSearch({ from: "/git" });
  // Every application the person may read the changes of: the one whose changes HQ's rule keeps
  // from them is listed elsewhere, and is not read here.
  const apps = useMemo(
    () =>
      registry.registry.groups.map((group) => {
        const groupFlow = flow.flows.get(group.groupId);
        return {
          appId: group.groupId,
          name: group.name,
          read: offersOf(group.groupId)?.read,
          changes: groupFlow?.changesKnown === true ? groupFlow.pullRequests : undefined,
          repositories: groupFlow?.repos,
          failure: flow.releaseFailures.get(group.groupId),
        };
      }),
    [flow.flows, flow.releaseFailures, offersOf, registry.registry.groups],
  );
  const state = gitPageState({
    appsKnown: !registry.loading,
    apps,
    mateName: (projectId) => flow.mateNames.get(projectId),
  });
  const scoped =
    status === "signed-in" && organizationStatus === "selected" && activeOrganization !== null;

  return (
    <ZeropsHostedFrame
      width="readable"
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
      <div className="flex min-w-0 flex-col gap-0.5" data-zerops-surface="git-header">
        <h1 className="text-xl font-medium text-foreground">Git</h1>
        <p className="text-sm text-muted-foreground">
          Repositories and changes across your projects.
        </p>
      </div>
      {search.appId !== undefined && search.repo !== undefined ? (
        <ZeropsRepositoryBrowser
          key={`${activeOrganization?.id}:${search.appId}:${search.repo}`}
          allowed={offersOf(search.appId)?.read}
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
