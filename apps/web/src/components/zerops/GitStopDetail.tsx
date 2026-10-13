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
  const detail = useHqAppDetail(appId);
  const { flows } = useCompactProjectFlows(useMemo(() => [appId], [appId]));
  const delivery = flows.get(appId)?.environments.find((row) => row.id === environment.id)?.git;
  return (
    <GitStopDetail
      environment={environment}
      delivery={delivery}
      repos={detail.repos}
      releases={detail.releases}
      live={live && detail.live}
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
  live = true,
}: {
  readonly environment: GitEnvironment;
  readonly delivery?: GitDelivery | undefined;
  readonly repos?: ReadonlyArray<RepoListEntry> | undefined;
  readonly releases?: ReadonlyArray<Release> | undefined;
  readonly can?: HqOffers | undefined;
  readonly onRemove?: (() => Promise<void>) | undefined;
  readonly live?: boolean;
}) {
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
          <Button
            size="sm"
            onClick={() => {
              setRemoving(false);
              void onRemove?.();
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
