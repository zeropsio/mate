/**
 * The Git page — the footer's *Git*: every repository this person can reach
 * and the changes open on it, across the whole account (`giteaOverview.ts`,
 * D26).
 *
 * Not a project's flow, which the left menu draws under each project; this
 * is the one place that answers "what is open, anywhere I can see" — the
 * account-wide view a person used to open a forge for. One section per
 * project, named the way every other surface names it; under it a row per
 * repository with how many changes are open; under each, the changes
 * themselves, newest first.
 *
 * Two things it no longer does. It is not called *Gitea*: the menu that
 * opens it says *Git*, and a page titled after the product behind it makes a
 * person learn a second name for one thing. And a change's title opens the
 * change's own page rather than the forge, wherever this account can draw
 * it — with the same word and the same colour its row wears on the projects
 * screen and in the left menu (the owner, 2026-09-19: "all pages are unified
 * in how they look work feel have ux and abilities"). A repository's name
 * still goes to the forge, because a repository is the one thing here the
 * app does not draw.
 *
 * Structural: the grouping, the order and every line are
 * `giteaOverview.ts`'s (R5). `ZeropsGiteaPage` composes the account around
 * the view; `ZeropsGiteaOverview` is the view alone.
 */
import {
  buildZeropsGroupTree,
  changeState,
  giteaRepositoryLine,
  type GiteaOverviewOwner,
} from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { Button } from "../ui/button";
import { StatusDot } from "./primitives";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsProjectFlow } from "~/zerops/projectFlowContext";
import { useZeropsGiteaOverview } from "~/zerops/useZeropsGiteaOverview";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { ZeropsSessionAccountControl } from "./landing/ZeropsAccountControl";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { ZeropsOrganizationSwitcher } from "./ZeropsOrganizationScope";
import { ZeropsPullRequestRow } from "./ZeropsPullRequestRow";

/** What the page has to say before the list, when it has nothing else. */
export type ZeropsGiteaOverviewState =
  | { readonly kind: "no-gitea" }
  | { readonly kind: "signing-in" }
  | { readonly kind: "sign-in-refused"; readonly reason: string }
  | { readonly kind: "unread" }
  | { readonly kind: "read"; readonly owners: ReadonlyArray<GiteaOverviewOwner> };

/** What this account knows about one change beyond the forge's own listing. */
export interface ZeropsGiteaChange {
  /** Where it stands, in the words every other surface uses. */
  readonly state: { readonly word: string; readonly tone: ServiceStatusToneId } | undefined;
  /** Its own page, when this account can draw it. */
  readonly open: (() => void) | undefined;
}

export function ZeropsGiteaOverview({
  state,
  ownerName,
  change,
}: {
  readonly state: ZeropsGiteaOverviewState;
  /** A project's name for a Gitea org; the org itself where none is known. */
  readonly ownerName?: (owner: string) => string;
  readonly change?: (owner: string, repository: string, number: number) => ZeropsGiteaChange;
}) {
  switch (state.kind) {
    case "no-gitea":
      return (
        <p className="text-sm text-muted-foreground" data-zerops-surface="gitea-empty">
          This account has no Gitea yet. The first project brings one.
        </p>
      );
    case "signing-in":
      return (
        <p className="text-sm text-muted-foreground" data-zerops-surface="gitea-signing-in">
          Signing you in to Gitea…
        </p>
      );
    case "sign-in-refused":
      return (
        <p
          className="text-sm text-[var(--zerops-status-failed)]"
          data-zerops-surface="gitea-signin-trouble"
        >
          {state.reason}
        </p>
      );
    case "unread":
      // Nothing read yet is not nothing: the list lands in a moment, and an
      // empty state that gives way to it is the layout shift this page refuses.
      return null;
    case "read":
      if (state.owners.length === 0) {
        return (
          <p className="text-sm text-muted-foreground" data-zerops-surface="gitea-empty">
            No repository yet. The first project brings one.
          </p>
        );
      }
      return (
        <div className="flex flex-col gap-10" data-zerops-surface="gitea-overview">
          {state.owners.map((owner) => (
            <section
              className="flex flex-col gap-3"
              data-zerops-gitea-owner={owner.owner}
              key={owner.owner}
            >
              <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-foreground">
                {ownerName?.(owner.owner) ?? owner.owner}
              </h2>
              <ul className="flex flex-col divide-y divide-border/50">
                {owner.repositories.map((repository) => (
                  <li
                    className="flex flex-col"
                    data-zerops-gitea-repository={repository.fullName}
                    key={repository.fullName}
                  >
                    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto] sm:py-0">
                      {repository.url === undefined ? (
                        <span className="min-w-0 truncate text-[13px] text-foreground">
                          {repository.name}
                        </span>
                      ) : (
                        <a
                          className="min-w-0 truncate rounded-sm text-[13px] text-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                          href={repository.url}
                          rel="noopener"
                          target="_blank"
                        >
                          {repository.name}
                        </a>
                      )}
                      <span className="col-span-2 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1">
                        {giteaRepositoryLine(repository.pulls.length)}
                      </span>
                    </div>
                    {repository.pulls.length === 0 ? null : (
                      <ul className="flex flex-col divide-y divide-border/50 border-t border-border/50 ps-4">
                        {repository.pulls.map((pull) => {
                          const known = change?.(owner.owner, repository.name, pull.number);
                          return (
                            <ZeropsPullRequestRow
                              key={pull.number}
                              line={pull.line}
                              tag="pr"
                              title={pull.title}
                              status={
                                known?.state === undefined ? undefined : (
                                  <StatusDot label={known.state.word} tone={known.state.tone} />
                                )
                              }
                              {...(known?.open === undefined ? {} : { onOpen: known.open })}
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
      );
  }
}

export function ZeropsGiteaPage() {
  const { activeOrganization, organizations, organizationStatus, selectOrganization, status } =
    useZeropsSession();
  const flow = useZeropsProjectFlow();
  const mateName = useCallback(
    (projectId: string) => flow.mateNames.get(projectId),
    [flow.mateNames],
  );
  const overview = useZeropsGiteaOverview({
    giteaOrigin: flow.giteaOrigin,
    enabled: flow.signedIn,
    mateName,
  });
  const navigate = useNavigate();
  const { candidates } = useZeropsCandidates();

  /** `links` → `Links`: a Gitea org is a group's slug, never its name. */
  const groupOfOwner = useMemo(() => {
    const byOwner = new Map<string, { readonly groupId: string; readonly name: string }>();
    const named = buildZeropsGroupTree(candidates, {}).groups;
    for (const [groupId, slug] of flow.slugs) {
      const name = named.find((entry) => entry.group.groupId === groupId)?.group.name;
      byOwner.set(slug, { groupId, name: name ?? slug });
    }
    return byOwner;
  }, [candidates, flow.slugs]);

  const ownerName = useCallback(
    (owner: string) => groupOfOwner.get(owner)?.name ?? owner,
    [groupOfOwner],
  );

  /**
   * What this account already knows about a change the forge listed: where it
   * stands, and the page that draws it. A change in a repository no project of
   * this account owns is left as the forge gave it.
   */
  const change = useCallback(
    (owner: string, repository: string, number: number): ZeropsGiteaChange => {
      const group = groupOfOwner.get(owner);
      const pull = group
        ? flow.flows
            .get(group.groupId)
            ?.pullRequests.find(
              (entry) => entry.repository === repository && entry.number === number,
            )
        : undefined;
      if (group === undefined || pull === undefined) return { state: undefined, open: undefined };
      return {
        state: changeState(pull),
        open: () => {
          void navigate({
            to: "/change/$groupId/$repository/$number",
            params: { groupId: group.groupId, repository, number: String(number) },
          });
        },
      };
    },
    [flow.flows, groupOfOwner, navigate],
  );
  const scoped =
    status === "signed-in" && organizationStatus === "selected" && activeOrganization !== null;
  const state: ZeropsGiteaOverviewState =
    flow.giteaOrigin === undefined
      ? { kind: "no-gitea" }
      : !flow.signedIn
        ? flow.signInTrouble === null
          ? { kind: "signing-in" }
          : { kind: "sign-in-refused", reason: flow.signInTrouble }
        : !overview.read
          ? { kind: "unread" }
          : { kind: "read", owners: overview.owners };

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
      <div
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
        data-zerops-surface="gitea-header"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-medium text-foreground">Git</h1>
          <p className="text-sm text-muted-foreground">Every change open across your projects.</p>
        </div>
        {flow.giteaOrigin === undefined ? null : (
          <Button
            render={<a href={flow.giteaOrigin} rel="noopener" target="_blank" />}
            size="sm"
            variant="outline"
          >
            <ExternalLinkIcon className="size-3.5" />
            Open Gitea
          </Button>
        )}
      </div>
      <ZeropsGiteaOverview change={change} ownerName={ownerName} state={state} />
    </ZeropsHostedFrame>
  );
}
