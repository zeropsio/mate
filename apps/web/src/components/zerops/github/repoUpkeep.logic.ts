import type { HqRemoteProbe, RepoListEntry } from "@t3tools/shared/hqChanges";
import type { RepoPress, RepoState } from "../gitMirror.logic";

/** Operations available to a repository's upkeep. */
export interface RepoRowActions {
  readonly sendDisconnect?: (repo: string, requestId: string) => Promise<unknown>;
  readonly replaceToken?: (repo: string, token: string) => Promise<HqRemoteProbe>;
  readonly unfollow?: (repo: string) => Promise<void>;
  readonly deleteRepository?: (repo: string) => Promise<void>;
}

export type RepositoryUpkeepEntry =
  | "open"
  | "connect"
  | "change"
  | "token"
  | "disconnect"
  | "unfollow"
  | "limit"
  | "delete";

/** The ordered upkeep offered for the facts and operations HQ gives this person. */
export function repositoryUpkeep({
  remote,
  follows,
  canDelete,
  destination,
  writes,
  press,
  actions,
  limit,
}: {
  readonly remote: RepoListEntry["remote"];
  readonly follows: RepoListEntry["follows"];
  readonly canDelete: RepoListEntry["canDelete"];
  readonly destination: RepoState["destination"];
  readonly writes: boolean;
  readonly press: RepoPress;
  readonly actions: RepoRowActions;
  readonly limit: boolean;
}): RepositoryUpkeepEntry[] {
  const entries: RepositoryUpkeepEntry[] = [];
  if (remote != null && destination !== null) entries.push("open");
  if (writes && press === null && remote == null && follows === undefined) entries.push("connect");
  if (writes && press === null && (remote != null || follows !== undefined)) entries.push("change");
  if (
    writes &&
    press === null &&
    remote != null &&
    remote.via !== "app" &&
    actions.replaceToken !== undefined
  )
    entries.push("token");
  if (writes && press === null && remote != null && actions.sendDisconnect !== undefined)
    entries.push("disconnect");
  if (writes && remote == null && follows !== undefined && actions.unfollow !== undefined)
    entries.push("unfollow");
  if (limit) entries.push("limit");
  if (canDelete?.allow === true && actions.deleteRepository !== undefined) entries.push("delete");
  return entries;
}

/** Groups the offered verbs for the repository's menu, leaving out empty groups. */
export function repositoryUpkeepGroups(
  entries: readonly RepositoryUpkeepEntry[],
): RepositoryUpkeepEntry[][] {
  const groups: RepositoryUpkeepEntry[][] = [
    ["open"],
    ["connect", "change", "token", "disconnect", "unfollow"],
    ["limit"],
    ["delete"],
  ];
  return groups
    .map((group) => group.filter((entry) => entries.includes(entry)))
    .filter((group) => group.length > 0);
}
