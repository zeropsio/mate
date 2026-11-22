import { Checkbox } from "~/components/ui/checkbox";
import {
  appEnvironments,
  hqEnvironmentOffers,
  hqOperationOf,
  listedProject,
  type AppEnvironmentsRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useProjection } from "~/zerops/ZeropsAccountData";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { writeTrouble } from "~/zerops/zeropsWrite";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { randomUUID } from "~/lib/utils";
import { stoppedWords } from "~/zerops/stoppedWords";
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
import { Badge } from "~/components/ui/badge";
import { STATUS_BADGE_TONE } from "./primitives";
import { ZeropsEnvironmentRow } from "./ZeropsEnvironmentRow";
import { gitPushHistory } from "./GitHistory.logic";
import { GitReleaseRows } from "./ZeropsReleaseRows";
import type { HqOffers } from "@t3tools/shared/hqOffers";
import { hqOffer } from "@t3tools/shared/hqOffers";
import { useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { SectionLabel } from "./system";
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
} & { readonly name: string };
/** Mounted only after the existing route resolves an environment inside the current app/account. */
export function GitStopDetailPage({
  appId,
  environment,
}: {
  readonly appId: string;
  readonly environment: GitEnvironment;
}) {
  const operations = useGitTargetOperations(appId);
  const detail = useHqAppDetail(appId);
  const { flows } = useCompactProjectFlows(useMemo(() => [appId], [appId]));
  const delivery = flows.get(appId)?.environments.find((row) => row.id === environment.id)?.git;
  const orgId = useAccountOrgId();
  const environments = useProjection(
    appEnvironments,
    orgId === null ? null : { orgId, appId },
    UNTOLD,
  ).environments;
  const can = useEnvironmentOffers(appId, environment.id);
  return (
    <GitStopDetail
      environment={environment}
      delivery={delivery}
      staged={environments?.some((row) => row.tier === "stage" && row.target.kind === "git")}
      repos={detail.repos}
      releases={detail.releases}
      can={can}
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
    />
  );
}
export function GitStopDetail({
  environment,
  delivery,
  repos,
  releases,
  can,
  staged = false,
  onRemove,
  onRunAgain,
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
}) {
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pushes = gitPushHistory(environment.jobs);
  const history =
    environment.tier === "stage"
      ? pushes.length
      : releases === undefined
        ? undefined
        : releases.length;
  return (
    <Card data-zerops-surface="git-stop-detail" variant="flat">
      <div className="flex flex-col gap-7 px-4 py-4">
        <section className="flex min-w-0 flex-col gap-1.5">
          <SectionLabel>Delivery</SectionLabel>
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
          <div className="flex flex-wrap gap-2 empty:hidden">
            {onRunAgain !== undefined && hqOffer(can, "redeploy").kind === "allowed"
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
                      } catch (cause) {
                        setNotice(
                          stoppedWords(
                            cause,
                            "HQ couldn't confirm Run again. Check its outcome before trying again.",
                          ),
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
          </div>
        </section>
        <section className="flex min-w-0 flex-col gap-1.5">
          <SectionLabel count={history === 0 ? undefined : history}>
            {environment.tier === "stage" ? "Pushes" : "Releases"}
          </SectionLabel>
          {environment.tier === "stage" ? (
            pushes.length === 0 ? (
              <p className="rv-note">No pushes recorded.</p>
            ) : (
              <ul className="space-y-2">
                {pushes.map((push) => (
                  <ZeropsEnvironmentRow
                    key={push.id}
                    name={push.name}
                    tag={push.cause}
                    summary={<span className="whitespace-normal">{push.summary}</span>}
                    status={
                      <Badge dot tone={STATUS_BADGE_TONE[push.attention ? "attention" : "off"]}>
                        {push.word}
                      </Badge>
                    }
                  />
                ))}
              </ul>
            )
          ) : releases === undefined ? (
            <p className="rv-note">Reading release history…</p>
          ) : releases.length === 0 ? (
            <p className="rv-note">No releases recorded.</p>
          ) : (
            <ul className="space-y-2">
              <GitReleaseRows
                releases={releases.map(flowReleaseOf)}
                delivery={delivery}
                jobs={environment.jobs}
              />
            </ul>
          )}
        </section>
        <div className="flex flex-col items-start gap-2 empty:hidden">
          <GitEnvironmentRemoval
            environment={environment}
            delivery={delivery}
            repos={repos}
            can={can}
            onRemove={onRemove}
          />
        </div>
      </div>
    </Card>
  );
}

/** The same confirmation wherever a person removes a Git environment. */
function GitEnvironmentRemoval({
  environment,
  delivery,
  repos,
  can,
  onRemove,
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
  readonly label?: string;
}) {
  const [historyLoss, setHistoryLoss] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const targets = repos?.flatMap((repo) =>
    repo.remote == null
      ? []
      : [{ name: repo.name, url: repo.remote.url, viaApp: repo.remote.via === "app" }],
  );
  const targetKnown =
    environment.tier !== "production" || (targets !== undefined && targets.length > 0);
  const remove =
    onRemove !== undefined && hqOffer(can, "remove_git_environment").kind === "allowed";
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
            branch or undoes a push.
            {targets?.length && targets.every((target) => target.viaApp)
              ? ""
              : " The token stays valid at its host until you revoke it there."}
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
              } catch (cause) {
                setNotice(
                  stoppedWords(
                    cause,
                    "HQ couldn't confirm removal. Check its outcome before trying again.",
                  ),
                );
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

const UNTOLD = Atom.make<AppEnvironmentsRead>({
  environments: undefined,
  unread: [],
});
const NO_OFFERS = Atom.make<HqOffers | undefined>(undefined);

/** What the person may do with this environment, as the client decides it from live Zerops data. */
function useEnvironmentOffers(appId: string, environmentId: string): HqOffers | undefined {
  const orgId = useAccountOrgId();
  return useProjection(
    hqEnvironmentOffers,
    orgId === null ? null : { orgId, appId, environmentId },
    NO_OFFERS,
  );
}

/** Menu and Settings read the same authoritative environment and its removal verdict. */
export function ProductionRemoval({
  appId,
  environmentId,
}: {
  readonly appId: string;
  readonly environmentId: string;
}) {
  const orgId = useAccountOrgId();
  const read = useProjection(appEnvironments, orgId === null ? null : { orgId, appId }, UNTOLD);
  const environment = read.environments?.find((row) => row.id === environmentId);
  if (environment === undefined || environment.tier !== "production") return null;
  return environment.target.kind === "git" ? (
    <GitProductionRemoval appId={appId} environment={environment} />
  ) : (
    <ZeropsProductionRemoval appId={appId} environment={environment} />
  );
}

type ProductionEnvironment = NonNullable<AppEnvironmentsRead["environments"]>[number];
function GitProductionRemoval({
  appId,
  environment,
}: {
  readonly appId: string;
  readonly environment: ProductionEnvironment;
}) {
  const detail = useHqAppDetail(appId);
  const operations = useGitTargetOperations(appId);
  const can = useEnvironmentOffers(appId, environment.id);
  if (environment.target.kind !== "git") return null;
  return (
    <GitEnvironmentRemoval
      environment={{ ...environment, target: environment.target }}
      delivery={gitDeliveryOf(environment, { repos: detail.repos, releases: detail.releases })}
      repos={detail.repos}
      can={can}
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

/**
 * Why a removal failed, in the person's words where HQ's code names a cause they can act on:
 * Zerops lets only an organization Owner delete a deploy token an Owner made (HQ's
 * `token_delete_refused`); any other code is shown as HQ or Zerops gave it.
 */
function removalFailureWords(code: string): string {
  return code === "token_delete_refused"
    ? "Only an organization owner can delete this production's deploy token."
    : `Production was not removed: ${code}`;
}

/** Whom a stopped removal waits for, by the member list's name of them; mounted only for one. */
function RemovalWaitingWords({
  orgId,
  userId,
}: {
  readonly orgId: string;
  readonly userId: string;
}) {
  const name = useHqPersonNames(orgId)(userId);
  return `Removing stopped: waiting for ${name ?? "the person who started it"}`;
}

/**
 * A production's Remove: one start at HQ (`start-production-removal`) on the person's access
 * token, carrying the fate they reviewed (`deleteProjectOnRemoval`: its project goes too). HQ
 * retires its deploy token and lets go of it — deleting its project for that fate — as its
 * operation, which the row shows on every device from navigation (`hqOperationOf`): going, stopped
 * for its maker's Continue, or failed with Zerops' code and Remove again. The press awaits only the
 * start; a press again after an answer that did not come sends the same id with the same body.
 */
function ZeropsProductionRemoval({
  appId,
  environment,
}: {
  readonly appId: string;
  readonly environment: ProductionEnvironment;
}) {
  const orgId = useAccountOrgId();
  const viewer = useZeropsSessionOptional()?.user?.id;
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
  // One id per start this row makes, sent again with the same body (HQ answers it again) until HQ
  // shows the removal failed: that ended whatever start it took, so Remove after it starts anew.
  const starts = useRef(new Map<string, string>());
  const can = useEnvironmentOffers(appId, environment.id);
  const allowed = hqOffer(can, "remove_production").kind === "allowed";
  if (operations === null || orgId === null || target.kind !== "zerops") return null;
  const removal = hqOperationOf(environment.operation, "production_removal", viewer);
  const submit = async (intent: Parameters<typeof operations.submit>[0]) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const { progress, evidence } = await operations.submit(intent);
      const trouble = writeTrouble(progress, evidence);
      if (trouble !== null) throw new Error(trouble);
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const said =
    notice === undefined ? null : (
      <p className="rv-note" role="alert">
        {notice}
      </p>
    );
  if (removal.kind === "going")
    return (
      <p className="rv-note" data-zerops-surface="production-removal-going">
        Removing production…
      </p>
    );
  if (removal.kind === "waiting")
    return (
      <>
        <p className="rv-note" data-zerops-surface="production-removal-waiting">
          <RemovalWaitingWords orgId={orgId} userId={removal.continueBy} />
        </p>
        {removal.yours ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void submit({ kind: "continue-operation", orgId, id: removal.id, appId });
            }}
          >
            Continue
          </Button>
        ) : null}
        {said}
      </>
    );
  if (!allowed) return null;
  const deleteProject = environment.deleteProjectOnRemoval === true;
  const attempt = `${target.projectId}:${String(deleteProject)}`;
  return (
    <>
      {removal.kind === "failed" ? (
        <p
          className="rv-note text-status-failed-text"
          data-zerops-surface="production-removal-failed"
        >
          {removalFailureWords(removal.code)}
        </p>
      ) : null}
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
        Remove production
      </Button>
      {said}
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
              const id =
                (removal.kind === "failed" ? undefined : starts.current.get(attempt)) ??
                randomUUID();
              starts.current.set(attempt, id);
              const started = await submit({
                kind: "start-production-removal",
                orgId,
                appId,
                projectId: target.projectId,
                id,
                deleteProject,
              });
              if (started) setConfirming(false);
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
