import { gitRemoteExpiry, type GitDelivery } from "@t3tools/client-runtime/zerops";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { HqEnvironmentTarget } from "@t3tools/shared/hqEnvironment";
import { gitTokenGuide } from "@t3tools/shared/gitTokenGuide";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMs } from "~/zerops/useNowMs";

type GitTarget = Extract<HqEnvironmentTarget, { readonly kind: "git" }>;

export function gitRemoteLabel(url: string): string {
  const address = new URL(url);
  return `${address.host}${address.pathname.replace(/\.git\/?$/u, "").replace(/\/$/u, "")}`;
}

/** The existing stop meta line, with HQ's remote destination rather than a service count. */
export function gitWhereLine(
  tier: "stage" | "production",
  target: GitTarget,
  remote?: string,
): string {
  const from = tier === "production" ? "Moves on release" : "Follows main";
  if (remote === undefined) return `${from} · repository address not read yet`;
  return `${from} · ${target.delivery === "direct" ? "pushes to" : "opens a pull request into"} ${gitRemoteLabel(remote)} ${target.branch}`;
}

/** A confirmed receipt is the only authority for a host commit link. */
export function GitCommitLink({ remote, sha }: { readonly remote: string; readonly sha: string }) {
  const url = remote.replace(/\.git\/?$/u, "").replace(/\/$/u, "");
  const guide = gitTokenGuide(remote, "");
  if (guide.kind !== "guide" || guide.host === "unknown") return null;
  const path = guide.host === "gitlab" ? "/-/commit/" : "/commit/";
  return (
    <a href={`${url}${path}${sha}`} rel="noreferrer" target="_blank">
      Open {new URL(remote).host}
    </a>
  );
}

export function GitDeliveryStatus({
  environment,
  delivery,
  repos,
  now: at,
  showDestination = true,
  showExpiry = true,
}: {
  readonly environment: { readonly target: GitTarget; readonly tier: "stage" | "production" };
  readonly delivery?: GitDelivery | undefined;
  readonly repos?: ReadonlyArray<RepoListEntry> | undefined;
  readonly now?: number;
  readonly showDestination?: boolean;
  readonly showExpiry?: boolean;
}) {
  const clock = useNowMs();
  const now = at ?? clock;
  const connected = repos?.filter((repo) => repo.remote != null);
  return (
    <div data-zerops-surface="git-delivery-status" data-standing={delivery?.standing ?? "checking"}>
      <p className="rv-words">{delivery?.line ?? "Checking what HQ pushed…"}</p>
      {!showDestination ? null : connected === undefined || connected.length === 0 ? (
        <p className="rv-note">
          {gitWhereLine(environment.tier, environment.target)}
          {showExpiry ? " · Expiry not reported" : null}
        </p>
      ) : (
        connected.map((repo) => (
          <p className="rv-note" key={repo.name}>
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} />}>
                {gitWhereLine(environment.tier, environment.target, repo.remote!.url)}
              </TooltipTrigger>
              <TooltipPopup>
                Mate pushes here. What that repository does with a push is up to how it is set up.
              </TooltipPopup>
            </Tooltip>
            {!showExpiry || gitRemoteExpiry(repo.remote!, now) === undefined ? null : (
              <> · {gitRemoteExpiry(repo.remote!, now)}</>
            )}
          </p>
        ))
      )}
      {delivery?.previousVersion === undefined ? null : (
        <p className="rv-note">Previous hand-over: {delivery.previousVersion}</p>
      )}
      {delivery?.repositories.map((repo) => (
        <p className="rv-note" key={repo.repo}>
          {repo.repo} · {repo.sha.slice(0, 7)} ·{" "}
          {repo.confirmed === undefined ? (repo.reason ?? repo.state) : "Pushed"}
          {repo.confirmed === undefined ? null : (
            <>
              {" "}
              · <GitCommitLink remote={repo.confirmed.remote.url} sha={repo.confirmed.after} />
            </>
          )}
        </p>
      ))}
      {delivery?.nextAction ? (
        <p className="rv-note">
          {delivery.nextActor === "hq" ? "HQ: " : ""}
          {delivery.nextAction}
        </p>
      ) : null}
    </div>
  );
}
