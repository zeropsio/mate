/** A project's code rows link to each repository and say the state of its remote. */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { HQ_REMOTE_WRITE_VERB, hqOffer } from "@t3tools/shared/hqOffers";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { GitBranchIcon } from "lucide-react";
import { useState } from "react";
import { GitHubIcon } from "~/components/Icons";
import { Button, InlineButton } from "~/components/ui/button";
import { List } from "~/components/ui/list";
import { Loading } from "~/components/ui/loading";
import { RealName } from "~/components/ui/real-name";
import { Text } from "~/components/ui/text";
import { useGitMirrorApps } from "~/zerops/useGitMirrorApps";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useNowMs } from "~/zerops/useNowMs";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { GitBrowserLink, useGitLinkProps } from "../gitBrowser/GitBrowserLink";
import {
  mirrorAuthorityLine,
  repoState,
  type RepoPress,
  type RepoStateApps,
} from "../gitMirror.logic";
import { FixButton, RepositoryConnectDialog, StateLine } from "./RepositoryUpkeep";
import { useRepoPress } from "./repoPress";
import { repositoryUpkeep } from "./repoUpkeep.logic";

/** The section as the project page holds it: the first connection and links to repositories. */
export function ProjectRepositories({
  groupId,
  groupName,
  repos,
}: {
  readonly groupId: string;
  readonly groupName: string;
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
}) {
  const git = useGitTargetOperations(groupId);
  const session = useZeropsSessionOptional();
  const now = useNowMs();
  const [connecting, setConnecting] = useState<string | null>(null);
  const needsApps = (repos ?? []).some(
    (entry) => entry.remote?.via === "app" && entry.remote.invalidSince !== null,
  );
  const mirror = useGitMirrorApps(needsApps);
  const writes = hqOffer(git.can, HQ_REMOTE_WRITE_VERB);
  return (
    <>
      <RepoRowsView
        admin={roleAtLeast(session?.activeOrganization?.roleCode, "ADMIN")}
        apps={mirror.apps?.kind === "ready" ? mirror.apps : null}
        authority={mirrorAuthorityLine(writes)}
        now={now}
        onConnect={setConnecting}
        orgId={git.orgId}
        orgName={session?.activeOrganization?.name}
        project={groupId}
        repos={repos}
      />
      <RepositoryConnectDialog
        appId={groupId}
        project={groupName}
        repo={connecting}
        onClose={() => setConnecting(null)}
      />
    </>
  );
}

interface RepoRowsViewProps {
  readonly orgId: string | null;
  readonly project: string;
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly apps: RepoStateApps | null;
  readonly orgName: string | undefined;
  readonly now: number;
  readonly authority: string | null;
  readonly admin: boolean;
  readonly onConnect: (repo: string) => void;
  readonly pressOf?: (repo: string) => RepoPress;
}

export function RepoRowsView(props: RepoRowsViewProps) {
  const listed = props.repos?.filter((entry) => entry.name !== RECIPE_REPO);
  if (listed === undefined)
    return <Loading className="mx-2" count={3} label="Repositories" shape="rows" />;
  const someUnconnected = listed.some((entry) => entry.remote == null);
  return (
    <div className="grid" data-zerops-surface="git-remotes">
      <List className="@container grid" render={<ul />}>
        {listed.map((entry) => (
          <RepoRow entry={entry} key={entry.name} {...props} />
        ))}
      </List>
      {someUnconnected && props.authority !== null ? (
        <Text className="px-2 pt-1" render={<p />} variant="note">
          {props.authority}
        </Text>
      ) : null}
    </div>
  );
}

function RepoRow({
  entry,
  project,
  apps,
  orgId,
  orgName,
  now,
  authority,
  admin,
  onConnect,
  pressOf,
}: RepoRowsViewProps & { readonly entry: RepoListEntry }) {
  const pressState = useRepoPress(orgId, project, entry.name, entry);
  const held: RepoPress =
    pressState.kind === "working"
      ? pressState.press.kind === "connect"
        ? "connecting"
        : "disconnecting"
      : null;
  const press = pressOf?.(entry.name) ?? held;
  const state = repoState(entry, { apps, orgName, now, press });
  const writes = authority === null;
  const offered = repositoryUpkeep({
    remote: entry.remote,
    follows: entry.follows,
    canDelete: entry.canDelete,
    destination: state.destination,
    writes,
    press,
    actions: {},
    limit: false,
  });
  const to = { appId: project, repo: entry.name };
  const link = useGitLinkProps(to);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-2.5 text-body/5 @lg:grid-cols-[7.5rem_minmax(0,1fr)_auto] @lg:gap-4">
      <span className="hidden self-start truncate text-foreground @lg:block">
        <GitBrowserLink to={to}>
          <RealName>{entry.name}</RealName>
        </GitBrowserLink>
      </span>
      <div className="grid min-w-0 gap-0.5">
        <p className="flex min-h-5 min-w-0 items-baseline gap-1.5 max-sm:flex-col max-sm:items-start max-sm:gap-0">
          <span className="shrink-0 text-foreground @lg:hidden">
            <GitBrowserLink to={to}>
              <RealName>{entry.name}</RealName>
            </GitBrowserLink>
          </span>
          {state.destination === null ? null : (
            <InlineButton
              className="min-w-0 max-sm:max-w-full"
              render={<a href={state.destination.href} rel="noreferrer" target="_blank" />}
              tone={state.tone === "busy" ? "muted" : "plain"}
            >
              {state.destination.href.startsWith("https://github.com/") ? (
                <GitHubIcon aria-hidden="true" className="me-1.5 inline size-3.5 align-middle" />
              ) : (
                <GitBranchIcon aria-hidden="true" className="me-1.5 inline size-3.5 align-middle" />
              )}
              <span className="truncate font-normal">
                <RealName>{state.destination.label}</RealName>
              </span>
            </InlineButton>
          )}
        </p>
        <StateLine state={state} />
      </div>
      <FixButton
        state={state}
        writes={writes}
        admin={admin}
        firstConnect={offered.includes("connect")}
        onConnect={() => onConnect(entry.name)}
        onFix={() => {}}
        onToken={() => {}}
        onSetUpGithub={() => {}}
        otherFix={
          <Button render={<a {...link} />} size="sm" variant="secondary">
            Open repository
          </Button>
        }
      />
    </li>
  );
}
