import { Checkbox } from "~/components/ui/checkbox";
import {
  canonicalAppEnvironments,
  type CanonicalAppEnvironmentsRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useProjection } from "~/zerops/ZeropsAccountData";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import {
  flowReleaseOf,
  gitDeliveryOf,
  type GitDelivery,
  type GitDeliveryEnvironment,
} from "@t3tools/client-runtime/zerops";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { Release } from "@t3tools/shared/hqRelease";
import { GitReleaseRows } from "./ZeropsReleaseRows";
import type { HqOffers } from "@t3tools/shared/hqOffers";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useCompactProjectFlows } from "~/zerops/projectFlows";
import { GitDeliveryStatus, gitRemoteLabel } from "./GitDeliveryStatus";

type GitEnvironment = Omit<GitDeliveryEnvironment, "target"> & {
  readonly target: Extract<GitDeliveryEnvironment["target"], { readonly kind: "git" }>;
} & { readonly name: string; readonly can?: HqOffers | undefined };
/** Mounted only after the existing route resolves an environment inside the current app/account. */
export function GitStopDetailPage({
  appId,
  environment,
  live,
}: {
  readonly appId: string;
  readonly environment: GitEnvironment;
  readonly live: boolean;
}) {
  const operations = useGitTargetOperations(appId);
  const detail = useHqAppDetail(appId);
  const { flows } = useCompactProjectFlows(useMemo(() => [appId], [appId]));
  const delivery = flows.get(appId)?.environments.find((row) => row.id === environment.id)?.git;
  return (
    <GitStopDetail
      environment={environment}
      delivery={delivery}
      repos={detail.repos}
      releases={detail.releases}
      can={environment.can}
      onRemove={
        operations.actions === undefined
          ? undefined
          : (loseUnresolvedHistory) =>
              operations.actions!.removeEnvironment(environment.id, loseUnresolvedHistory)
      }
      onRunAgain={
        operations.actions === undefined
          ? undefined
          : (repo) => operations.actions!.runAgain(environment.id, repo)
      }
      live={live && detail.live && operations.live}
    />
  );
}
export function GitStopDetail({
  environment,
  delivery,
  repos,
  releases,
  can = environment.can,
  onRemove,
  onRunAgain,
  live = true,
}: {
  readonly environment: GitEnvironment;
  readonly delivery?: GitDelivery | undefined;
  readonly repos?: ReadonlyArray<RepoListEntry> | undefined;
  readonly releases?: ReadonlyArray<Release> | undefined;
  readonly can?: HqOffers | undefined;
  readonly onRemove?: ((loseUnresolvedHistory?: true) => Promise<void>) | undefined;
  readonly onRunAgain?: ((repo: string) => Promise<void>) | undefined;
  readonly live?: boolean;
}) {
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <div data-zerops-surface="git-stop-detail">
      <GitDeliveryStatus environment={environment} delivery={delivery} repos={repos} />
      {environment.target.kind !== "git" || environment.target.delivery === "direct" ? null : (
        <p className="rv-note">Pull-request delivery is not available here yet.</p>
      )}
      {notice === undefined ? null : <p className="rv-note">{notice}</p>}
      {onRunAgain !== undefined &&
      hqOffer(can, "redeploy", { current: live, unavailableSince: live ? null : 0 }).kind ===
        "allowed"
        ? delivery?.repositories.map((repo) => (
            <Button
              key={repo.repo}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onRunAgain(repo.repo);
                } catch {
                  setNotice(
                    "HQ couldn't confirm Run again. Check its outcome before trying again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Run {repo.repo} again
            </Button>
          ))
        : null}
      <h2 className="mt-6 text-sm font-medium">History</h2>
      {releases === undefined ? (
        <p className="rv-note">Reading release history…</p>
      ) : releases.length === 0 ? (
        <p className="rv-note">No releases recorded.</p>
      ) : (
        <ul className="space-y-2">
          <GitReleaseRows releases={releases.map(flowReleaseOf)} delivery={delivery} />
        </ul>
      )}
      <GitEnvironmentRemoval
        environment={environment}
        delivery={delivery}
        repos={repos}
        can={can}
        onRemove={onRemove}
        live={live}
      />
    </div>
  );
}

/** The same confirmation wherever a person removes a Git environment. */
export function GitEnvironmentRemoval({
  environment,
  delivery,
  repos,
  can,
  onRemove,
  live = true,
  label = "Remove environment",
}: {
  readonly environment: {
    readonly name: string;
    readonly tier: "production" | "stage";
    readonly target: { readonly branch: string };
  };
  readonly delivery?: GitDelivery | undefined;
  readonly repos?: ReadonlyArray<RepoListEntry> | undefined;
  readonly can?: HqOffers | undefined;
  readonly onRemove?: ((loseUnresolvedHistory?: true) => Promise<void>) | undefined;
  readonly live?: boolean;
  readonly label?: string;
}) {
  const [historyLoss, setHistoryLoss] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const targets = repos?.flatMap((repo) =>
    repo.remote == null ? [] : [{ name: repo.name, url: repo.remote.url }],
  );
  const targetKnown =
    environment.tier !== "production" || (targets !== undefined && targets.length > 0);
  const remove =
    onRemove !== undefined &&
    hqOffer(can, "remove_git_environment", {
      current: live,
      unavailableSince: live ? null : 0,
    }).kind === "allowed";
  return (
    <>
      {remove ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemoving(true)}>
          {label}
        </Button>
      ) : null}
      {notice === undefined ? null : (
        <p className="rv-note" role="alert">
          {notice}
        </p>
      )}
      {removing ? (
        <div role="group" aria-label={`Remove ${environment.name}`} aria-busy={busy}>
          {environment.tier !== "production" ? null : (
            <>
              {targets?.map((target) => (
                <p className="rv-note" key={target.name}>
                  {`Removes production. ${gitRemoteLabel(target.url)} ${environment.target.branch} stays as it is; Mate stops pushing to it.`}
                </p>
              ))}
              {targetKnown ? null : (
                <p className="rv-note">Read the repository addresses before confirming removal.</p>
              )}
              <p className="rv-note">
                The remote stays connected. Settings → Repositories manages it.
              </p>
            </>
          )}
          <p className="rv-note">
            Its push history goes with it. Removing this environment never deletes an external
            branch or undoes a push. The token stays valid at its host until you revoke it there.
          </p>
          {delivery?.standing === "unresolved" ? (
            <p className="rv-note">
              The last push couldn't be confirmed. Anything already sent may remain at the host.
            </p>
          ) : null}
          {delivery === undefined || delivery.repositories.length === 0 ? (
            <p className="rv-note">External leftovers could not be confirmed</p>
          ) : null}
          {delivery?.repositories.map((repo) => (
            <p className="rv-note" key={repo.repo}>
              {repo.repo}: {repo.confirmed?.ref ?? "External leftovers could not be confirmed"}
            </p>
          ))}
          {delivery?.standing === "unresolved" ? (
            <div className="flex items-center gap-2">
              <Checkbox
                aria-label="Confirm unresolved history loss"
                checked={historyLoss}
                onCheckedChange={(checked) => setHistoryLoss(checked === true)}
              />{" "}
              <span className="rv-note">
                I understand that the unresolved push history will be lost.
              </span>
            </div>
          ) : null}
          <Button
            size="sm"
            disabled={busy || !targetKnown || (delivery?.standing === "unresolved" && !historyLoss)}
            onClick={async () => {
              setBusy(true);
              try {
                await onRemove?.(historyLoss ? true : undefined);
                setRemoving(false);
              } catch {
                setNotice("HQ couldn't confirm removal. Check its outcome before trying again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Removing…" : "Confirm removal"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemoving(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </>
  );
}

const UNTOLD = Atom.make<CanonicalAppEnvironmentsRead>({ environments: undefined, refused: null });

/** The menu and Settings submit the same account operation as the environment's page. */
export function GitProductionRemoval({
  appId,
  environmentId,
}: {
  readonly appId: string;
  readonly environmentId: string;
}) {
  const orgId = useAccountOrgId();
  const read = useProjection(
    canonicalAppEnvironments,
    orgId === null ? null : { orgId, appId },
    UNTOLD,
  );
  const detail = useHqAppDetail(appId);
  const operations = useGitTargetOperations(appId);
  const environment = read.environments?.find((row) => row.id === environmentId);
  if (environment?.target.kind !== "git" || environment.tier !== "production") return null;
  return (
    <GitEnvironmentRemoval
      environment={{ ...environment, target: environment.target }}
      delivery={gitDeliveryOf(environment, { repos: detail.repos, releases: detail.releases })}
      repos={detail.repos}
      can={environment.can}
      live={operations.live && detail.live}
      label="Remove production"
      onRemove={
        operations.actions === undefined
          ? undefined
          : (loseUnresolvedHistory) =>
              operations.actions!.removeEnvironment(environment.id, loseUnresolvedHistory)
      }
    />
  );
}
