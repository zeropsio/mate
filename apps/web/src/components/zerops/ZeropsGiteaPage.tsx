/**
 * The Gitea page — the footer's Gitea button: every repository this person
 * can reach and the pull requests open on it, across the whole account
 * (`giteaOverview.ts`, D26).
 *
 * Not a project's flow, which the left menu draws under each project; this
 * is the one place that answers "what is open, anywhere I can see" — the
 * account-wide view a person used to open Gitea itself for. One section per
 * owner, which here is a project's org; under it a row per repository, its
 * name the way into Gitea and one line with how many pull requests are
 * open; under each, the pull requests themselves, newest first, the title
 * the way to the pull request's page. Nothing here changes anything: a
 * merge is the project's verb, on its own rows.
 *
 * Structural: the grouping, the order and every line are
 * `giteaOverview.ts`'s (R5). `ZeropsGiteaPage` composes the account around
 * the view; `ZeropsGiteaOverview` is the view alone.
 */
import { giteaRepositoryLine, type GiteaOverviewOwner } from "@t3tools/client-runtime/zerops";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback } from "react";

import { Button } from "../ui/button";
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

export function ZeropsGiteaOverview({ state }: { readonly state: ZeropsGiteaOverviewState }) {
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
                {owner.owner}
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
                        {repository.pulls.map((pull) => (
                          <ZeropsPullRequestRow
                            key={pull.number}
                            line={pull.line}
                            tag="pr"
                            title={pull.title}
                            url={pull.url}
                          />
                        ))}
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
        <h1 className="text-xl font-medium text-foreground">Gitea</h1>
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
      <ZeropsGiteaOverview state={state} />
    </ZeropsHostedFrame>
  );
}
