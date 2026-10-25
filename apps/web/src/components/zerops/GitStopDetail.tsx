import { Checkbox } from "~/components/ui/checkbox";
import {
  canonicalAppEnvironments,
  canonicalHqNavigation,
  listedProject,
  type CanonicalAppEnvironmentsRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useProjection } from "~/zerops/ZeropsAccountData";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { hqProjectIdOf } from "~/zerops/hqWrites";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import {
  flowReleaseOf,
  gitDeliveryOf,
  gitRequiredChecks,
  type GitDelivery,
  type GitDeliveryEnvironment,
} from "@t3tools/client-runtime/zerops";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { gitTokenGuide } from "@t3tools/shared/gitTokenGuide";
import type { Release } from "@t3tools/shared/hqRelease";
import { GitReleaseRows } from "./ZeropsReleaseRows";
import type { HqOffers } from "@t3tools/shared/hqOffers";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { useCompactProjectFlows } from "~/zerops/projectFlows";
import { GitDeliveryStatus, gitRemoteLabel } from "./GitDeliveryStatus";

/**
 * How to make GitHub hold a production's branch to what stage tested — HQ never sets it: one
 * sentence, what the branch's rules required when HQ last read them (`required`), and the
 * repository's ruleset settings; none off GitHub.
 */
function gitRulesetGuide(
  remoteUrl: string,
  branch: string,
  required: ReadonlyArray<string> | null | undefined,
) {
  const guide = gitTokenGuide(remoteUrl, "");
  if (guide.kind !== "guide" || guide.host !== "github") return undefined;
  const now =
    required === undefined
      ? ""
      : required === null
        ? ` As HQ last read them, ${branch}'s rules require no checks: ${branch} is unprotected, so a release waits on every GitHub Actions check of stage's commit.`
        : ` As HQ last read them, ${branch}'s rules require ${required.map((name) => `"${name}"`).join(", ")}.`;
  return {
    words: `Protect ${branch} on GitHub so only a commit stage tested lands there: add a ruleset on ${branch} that requires the CI checks that must pass, blocks force pushes and restricts deletions.${now}`,
    url: `https://github.com/${guide.repository}/settings/rules`,
  };
}

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
  const orgId = useAccountOrgId();
  const environments = useProjection(
    canonicalAppEnvironments,
    orgId === null ? null : { orgId, appId },
    UNTOLD,
  ).environments;
  return (
    <GitStopDetail
      environment={environment}
      delivery={delivery}
      staged={environments?.some((row) => row.tier === "stage" && row.target.kind === "git")}
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
  staged = false,
  onRemove,
  onRunAgain,
  live = true,
}: {
  readonly environment: GitEnvironment;
  readonly delivery?: GitDelivery | undefined;
  /** The application has a Git stage: a release to this production pushes what stage tested. */
  readonly staged?: boolean | undefined;
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
      {environment.tier !== "production" || !staged
        ? null
        : repos?.map((repo) => {
            const guide =
              repo.remote == null
                ? undefined
                : gitRulesetGuide(
                    repo.remote.url,
                    environment.target.branch,
                    gitRequiredChecks(environment.jobs, repo.name),
                  );
            return guide === undefined ? null : (
              <p className="rv-note" data-git-ruleset key={repo.name}>
                {guide.words}{" "}
                <a href={guide.url} rel="noreferrer" target="_blank">
                  Open {repo.name}'s rulesets
                </a>
              </p>
            );
          })}
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
              variant="secondary"
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
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRemoving(true)}>
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
                The remote stays connected. Manage it under Repositories on this project's page.
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
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRemoving(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </>
  );
}

const UNTOLD = Atom.make<CanonicalAppEnvironmentsRead>({
  environments: undefined,
  refused: null,
  unread: [],
});

/** Menu and Settings read the same authoritative environment and its removal verdict. */
export function ProductionRemoval({
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
  const environment = read.environments?.find((row) => row.id === environmentId);
  if (environment === undefined || environment.tier !== "production") return null;
  return environment.target.kind === "git" ? (
    <GitProductionRemoval appId={appId} environment={environment} />
  ) : (
    <ZeropsProductionRemoval appId={appId} environment={environment} />
  );
}

type ProductionEnvironment = NonNullable<CanonicalAppEnvironmentsRead["environments"]>[number];
function GitProductionRemoval({
  appId,
  environment,
}: {
  readonly appId: string;
  readonly environment: ProductionEnvironment;
}) {
  const detail = useHqAppDetail(appId);
  const operations = useGitTargetOperations(appId);
  if (environment.target.kind !== "git") return null;
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

const NO_PROJECT = Atom.make(null);
function ZeropsProductionRemoval({
  appId,
  environment,
}: {
  readonly appId: string;
  readonly environment: ProductionEnvironment;
}) {
  const orgId = useAccountOrgId();
  const hqProjectId = orgId === null ? null : hqProjectIdOf(orgId);
  const navigation = useProjection(canonicalHqNavigation, orgId, NO_PROJECT);
  const target = environment.target;
  const project = useProjection(
    listedProject,
    orgId === null || target.kind !== "zerops" ? null : { orgId, projectId: target.projectId },
    NO_PROJECT,
  );
  const operations = useAccountOperationsOptional();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const allowed =
    hqOffer(environment.can, "remove_production", {
      current: navigation?.live === true,
      unavailableSince: navigation?.live === true ? null : 0,
    }).kind === "allowed";
  if (
    !allowed ||
    operations === null ||
    orgId === null ||
    hqProjectId === null ||
    target.kind !== "zerops"
  )
    return null;
  const deleteProject = environment.deleteProjectOnRemoval === true;
  return (
    <>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
        Remove production
      </Button>
      {notice === undefined ? null : (
        <p className="rv-note" role="alert">
          {notice}
        </p>
      )}
      {!confirming ? null : (
        <div role="group" aria-label={`Remove ${environment.name}`} aria-busy={busy}>
          <p className="rv-note">
            {project === null
              ? "Read the project name before confirming removal."
              : deleteProject
                ? `Removes production and deletes the Zerops project ${project.name} with its services and data.`
                : `Removes production. The Zerops project ${project.name} stays as it is; Mate stops releasing to it.`}
          </p>
          <Button
            size="sm"
            disabled={busy || project === null}
            onClick={async () => {
              setBusy(true);
              setNotice(undefined);
              const notification = toastManager.add({
                type: "loading",
                title: "Removing production",
                timeout: 0,
              });
              let removed = false;
              try {
                const result = await operations.run(
                  {
                    kind: "remove-production",
                    orgId,
                    hqProjectId,
                    appId,
                    projectId: target.projectId,
                    deleteProject,
                  },
                  {
                    orgId,
                    unobserved:
                      "HQ could not confirm removal. Check the original operation before trying again.",
                  },
                );
                removed = true;
                if (result.deleteProject) {
                  toastManager.update(notification, {
                    type: "loading",
                    title: "Deleting Zerops project",
                    description: project?.name,
                    timeout: 0,
                  });
                  await operations.run(
                    { kind: "delete-project", orgId, projectId: target.projectId },
                    {
                      orgId,
                      unobserved:
                        "Production was removed. Check the original Zerops deletion operation before trying again.",
                    },
                  );
                }
                toastManager.update(notification, {
                  type: "success",
                  title: "Production removed",
                  description: result.deleteProject
                    ? "The Zerops project was deleted."
                    : "The Zerops project stays as it is.",
                  timeout: 5000,
                });
                setConfirming(false);
              } catch (cause) {
                const message =
                  cause instanceof Error ? cause.message : "Check the original operation.";
                const notice = removed
                  ? `Production was removed. Zerops project deletion could not be confirmed. ${message}`
                  : `Removal could not be confirmed. ${message}`;
                setNotice(notice);
                toastManager.update(notification, {
                  type: "error",
                  title: removed ? "Project deletion needs attention" : "Removal needs attention",
                  description: notice,
                  timeout: 0,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Removing…" : "Confirm removal"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      )}
    </>
  );
}
