import { Checkbox } from "~/components/ui/checkbox";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import {
  flowReleaseOf,
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
import { GitDeliveryStatus } from "./GitDeliveryStatus";

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
  const [historyLoss, setHistoryLoss] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove =
    onRemove !== undefined &&
    hqOffer(can, "remove_git_environment", { current: live, unavailableSince: live ? null : 0 })
      .kind === "allowed";
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
      {remove ? (
        <Button size="sm" variant="outline" onClick={() => setRemoving(true)}>
          Remove environment
        </Button>
      ) : null}
      {removing ? (
        <div>
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
            disabled={busy || (delivery?.standing === "unresolved" && !historyLoss)}
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
            Confirm removal
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRemoving(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
