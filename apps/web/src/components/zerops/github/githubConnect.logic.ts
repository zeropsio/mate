/**
 * What the GitHub connect picker shows, from the organization's apps (`useGitMirrorApps`): the
 * accounts its repositories can go to, yours first, each listed once through one app; each
 * account's repositories with the one whose name matches suggested and the ones another code
 * repository uses visible but not pickable; and what the trip to GitHub installs.
 */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";

import type {
  GitMirrorAppEntry,
  GitMirrorApps,
  GitMirrorInstallation,
  GitMirrorRepository,
} from "~/zerops/useGitMirrorApps";

import { githubName, remoteGithubAppId } from "../gitMirror.logic";

/** One GitHub account the picker offers, through the one app its repositories are listed from. */
export interface PickerAccount {
  readonly account: string;
  readonly installation: GitMirrorInstallation;
  readonly app: GitMirrorAppEntry;
  /** Added by the person looking. */
  readonly mine: boolean;
}

/**
 * The accounts with an accepted installation of any of the organization's apps, yours first. An
 * account with two apps is listed once, through the app the project's other repositories already
 * go through, else one you set up, else the oldest.
 */
export function pickerAccounts(
  apps: Extract<GitMirrorApps, { readonly kind: "ready" }>,
  viewerId: string | null,
  usedAppIds: ReadonlyArray<number>,
): ReadonlyArray<PickerAccount> {
  const rank = (app: GitMirrorAppEntry) => {
    const used = usedAppIds.indexOf(app.appId);
    if (used >= 0) return used;
    if (viewerId !== null && app.setUpBy === viewerId) return usedAppIds.length;
    return usedAppIds.length + 1 + apps.apps.indexOf(app);
  };
  const byAccount = new Map<string, PickerAccount>();
  for (const installation of apps.installations) {
    if (installation.standing !== "accepted") continue;
    const app = apps.apps.find((each) => each.appId === installation.appId);
    if (app === undefined) continue;
    const key = installation.account.toLowerCase();
    const held = byAccount.get(key);
    if (held !== undefined && rank(held.app) <= rank(app)) continue;
    byAccount.set(key, {
      account: installation.account,
      installation,
      app,
      mine: viewerId !== null && installation.addedBy === viewerId,
    });
  }
  return [...byAccount.values()].toSorted(
    (a, b) => Number(b.mine) - Number(a.mine) || a.account.localeCompare(b.account),
  );
}

/** Accounts whose installation waits for an Owner or Admin's OK. */
export function waitingAccounts(
  apps: Extract<GitMirrorApps, { readonly kind: "ready" }>,
): ReadonlyArray<string> {
  return [
    ...new Set(
      apps.installations.filter((each) => each.standing === "waiting").map((each) => each.account),
    ),
  ];
}

/** The org apps the project's other code repositories go through, most used first. */
export function usedAppIds(
  repos: ReadonlyArray<RepoListEntry> | undefined,
  repo: string,
): ReadonlyArray<number> {
  const counts = new Map<number, number>();
  for (const entry of repos ?? []) {
    if (entry.name === repo || entry.remote == null) continue;
    const id = remoteGithubAppId(entry.remote);
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * The GitHub repository the picker suggests for a code repository: the one it is connected to (a
 * reconnect), else the one it follows, else nothing — the name match is per account.
 */
export function heldRepository(entry: RepoListEntry | undefined): string | null {
  if (entry === undefined) return null;
  if (entry.remote != null) return githubName(entry.remote.url);
  return entry.follows === undefined ? null : githubName(entry.follows);
}

/** One repository as the picker lists it. */
export interface PickerRepository {
  readonly repository: GitMirrorRepository;
  /** Why it can't be picked: "Notes · appdev uses it"; `null` where it can. */
  readonly taken: string | null;
  readonly suggested: boolean;
  /** This code repository goes there now. */
  readonly current: boolean;
  /** It wasn't there before the person last left for GitHub. */
  readonly fresh: boolean;
}

/**
 * An account's repositories: the suggested one first, then the rest by name, the taken ones last.
 * Suggested is the held repository, else the one named like the code repository.
 */
export function pickerRepositories(input: {
  readonly account: PickerAccount;
  readonly project: string;
  readonly repo: string;
  readonly held: string | null;
  readonly fresh: ReadonlySet<string>;
  readonly projectNameOf: (applicationId: string) => string | undefined;
}): ReadonlyArray<PickerRepository> {
  const { account, project, repo, held, fresh, projectNameOf } = input;
  const named = (repository: GitMirrorRepository) =>
    repository.fullName.split("/")[1]?.toLowerCase() === repo.toLowerCase();
  const isHeld = (repository: GitMirrorRepository) =>
    held !== null && repository.fullName.toLowerCase() === held.toLowerCase();
  const anyHeld = account.installation.repositories.some(isHeld);
  const rows = account.installation.repositories.map((repository): PickerRepository => {
    const usedBy = repository.usedBy;
    const mine = usedBy !== null && usedBy.application === project && usedBy.repo === repo;
    const taken =
      usedBy === null || mine
        ? null
        : `${projectNameOf(usedBy.application) ?? "Another project"} · ${usedBy.repo} uses it`;
    return {
      repository,
      taken,
      suggested: taken === null && (anyHeld ? isHeld(repository) : named(repository)),
      current: mine || isHeld(repository),
      fresh: fresh.has(repository.fullName.toLowerCase()),
    };
  });
  const order = (row: PickerRepository) => (row.suggested ? 0 : row.taken === null ? 1 : 2);
  return rows.toSorted(
    (a, b) => order(a) - order(b) || a.repository.fullName.localeCompare(b.repository.fullName),
  );
}

/** The account the picker opens on: the one holding the suggestion or new arrivals, else the first. */
export function openingAccount(
  accounts: ReadonlyArray<PickerAccount>,
  input: {
    readonly repo: string;
    readonly held: string | null;
    readonly fresh: ReadonlySet<string>;
  },
): string | null {
  const has = (test: (repository: GitMirrorRepository) => boolean) =>
    accounts.find((each) => each.installation.repositories.some(test))?.account;
  return (
    (input.held === null
      ? undefined
      : has((repository) => repository.fullName.toLowerCase() === input.held!.toLowerCase())) ??
    has((repository) => input.fresh.has(repository.fullName.toLowerCase())) ??
    has(
      (repository) =>
        repository.usedBy === null &&
        repository.fullName.split("/")[1]?.toLowerCase() === input.repo.toLowerCase(),
    ) ??
    accounts[0]?.account ??
    null
  );
}

/** GitHub's own page for a new repository, filled in: private, on the account, named like the code. */
export const newRepositoryUrl = (account: string, name: string) =>
  `https://github.com/new?${new URLSearchParams({ owner: account, name, visibility: "private" }).toString()}`;

/**
 * What the trip to GitHub installs, said before the person leaves: the app, whose it is on GitHub
 * and who set it up in the organization.
 */
export function explainerWords(
  app: GitMirrorAppEntry,
  nameOf: (userId: string) => string | undefined,
  viewerId: string | null,
): { readonly install: string; readonly about: string } {
  const owner = app.ownerType === "User" ? `${app.owner}, a personal account` : app.owner;
  const by =
    app.setUpBy === null
      ? null
      : app.setUpBy === viewerId
        ? "you"
        : (nameOf(app.setUpBy) ?? "someone in the organization");
  const setUp = by === null ? "waits for an Owner or Admin to confirm it" : `was set up by ${by}`;
  return {
    install: `You'll install ${app.name} on the account you pick.`,
    // A name ending in its initial's period ends the sentence too.
    about: `${app.name} is owned by ${owner} on GitHub and ${setUp}`.replace(/\.?$/u, "."),
  };
}

/** The app the explainer opens on: the one you set up, else the one others use, else the only one. */
export function openingApp(
  apps: ReadonlyArray<GitMirrorAppEntry>,
  viewerId: string | null,
  used: ReadonlyArray<number>,
): number | null {
  const sealed = apps.filter((app) => app.setUpBy !== null);
  return (
    sealed.find((app) => viewerId !== null && app.setUpBy === viewerId)?.appId ??
    used.find((id) => sealed.some((app) => app.appId === id)) ??
    (apps.length === 1 ? (apps[0]?.appId ?? null) : null)
  );
}

/** Said where Connect would act through an app that waits for an Owner or Admin's Confirm. */
export const unsealedWords = (app: GitMirrorAppEntry) =>
  `${app.name} waits for an Owner or Admin to confirm it in Settings › GitHub before Mate uses it.`;

/** The steps a connect shows, each as HQ's record tells it. */
export type ConnectStep = "connect" | "push" | "rules";

/**
 * Where a connect stands, from the press and the repository's record: sent and not shown yet
 * (`connect`), shown and main not pushed yet (`push`), pushed and GitHub's rules not read yet
 * (`rules`, through an app only), or done. A token remote has no rules to read.
 */
export function connectProgress(input: {
  readonly answered: boolean;
  readonly entry: RepoListEntry | undefined;
  readonly syncedAt: string | null | undefined;
}): ConnectStep | "done" {
  const remote = input.entry?.remote;
  if (!input.answered || remote == null) return "connect";
  if (input.syncedAt === null) return "push";
  if (remote.via === "app" && remote.governance === undefined && input.syncedAt !== undefined)
    return "rules";
  return "done";
}

/**
 * What the person saw before leaving for GitHub, so that what came back is told apart: every
 * installation, and every repository name where the page stayed open (a new repository or the
 * app's access in another tab). Back from an install trip the page is new: only the installations
 * it carried back in its address are known, so a whole new account reads as new.
 */
export interface SeenBefore {
  readonly installations: ReadonlySet<number>;
  /** Lowercased `owner/name`s; `null` after an install trip. */
  readonly names: ReadonlySet<string> | null;
}

const seen = new Map<string, SeenBefore>();
const seenKey = (project: string, repo: string) => JSON.stringify([project, repo]);

/** Notes what is there now, as the person opens GitHub in another tab. */
export function rememberLeaving(project: string, repo: string, apps: GitMirrorApps | null): void {
  if (apps === null || apps.kind !== "ready") return;
  seen.set(seenKey(project, repo), {
    installations: new Set(apps.installations.map((each) => each.installationId)),
    names: new Set(
      apps.installations.flatMap((each) =>
        each.repositories.map((repository) => repository.fullName.toLowerCase()),
      ),
    ),
  });
}

/** The address parameter an install trip carries out and back: `<project>|<repo>|<installation ids>`. */
export const SEEN_PARAM = "connect-seen";

/** `returnTo` carrying the installations there now, so what the trip adds reads as new on return. */
export function returnWithSeen(
  returnTo: string,
  project: string,
  repo: string,
  apps: GitMirrorApps | null,
): string {
  const url = new URL(returnTo, window.location.origin);
  const ids = apps === null || apps.kind !== "ready" ? [] : apps.installations;
  url.searchParams.set(
    SEEN_PARAM,
    [project, repo, ids.map((each) => String(each.installationId)).join(",")].join("|"),
  );
  return url.toString();
}

/** Notes the installations an install trip carried back (`SEEN_PARAM`); anything else is ignored. */
export function rememberSeen(value: string | null | undefined): void {
  const [project, repo, ids, ...rest] = (value ?? "").split("|");
  if (project === undefined || repo === undefined || ids === undefined || rest.length > 0) return;
  if (project === "" || repo === "") return;
  seen.set(seenKey(project, repo), {
    installations: new Set(
      ids
        .split(",")
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
    names: null,
  });
}

export const seenBefore = (project: string, repo: string): SeenBefore | null =>
  seen.get(seenKey(project, repo)) ?? null;

/** Repository names (lowercased) in `apps` the person had not seen before leaving. */
export function freshNames(
  apps: GitMirrorApps | null,
  before: SeenBefore | null,
): ReadonlySet<string> {
  if (before === null || apps === null || apps.kind !== "ready") return new Set();
  return new Set(
    apps.installations.flatMap((each) =>
      each.repositories
        .map((repository) => repository.fullName.toLowerCase())
        .filter((name) =>
          before.installations.has(each.installationId)
            ? before.names !== null && !before.names.has(name)
            : true,
        ),
    ),
  );
}
