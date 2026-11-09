/**
 * What Git's surfaces say of a code repository on GitHub: where its code goes and whether it moves,
 * or why it stopped — diverged, its token refused, the app it went through gone — in the one
 * vocabulary the project page's rows, the connect dialog and the ask card share.
 */
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { HqOfferState } from "@t3tools/shared/hqOffers";

/**
 * The organization's GitHub app as the mirror dialog reads it: connected, not (`none`: HQ answered
 * there is none), or `unknown` where HQ's answer could not be read.
 */
export type GitMirrorApp =
  | {
      readonly kind: "connected";
      /** The app's name: "Acme Mate". */
      readonly name: string;
      /** Its id on GitHub, which a ruleset pins `mate/gate` to; absent from an older HQ. */
      readonly appId?: number;
      /** The repositories it reaches, by `owner/name`. */
      readonly repositories: ReadonlyArray<string>;
      /** GitHub's own install page: what is installed from it waits for an admin's OK. */
      readonly installUrl: string;
      /** HQ hands install trips that come back accepted; absent or false from an older HQ. */
      readonly installTrip?: boolean;
      /** Accounts it is installed on that wait for an admin's OK, with their repositories. */
      readonly waiting?: ReadonlyArray<{
        readonly account: string;
        readonly repositories: ReadonlyArray<string>;
      }>;
      /** Its installations GitHub did not answer about: their repositories are not listed. */
      readonly unanswered?: number;
    }
  | { readonly kind: "none" }
  | { readonly kind: "unknown" };

/**
 * How a press installs the app further: an Owner or Admin through HQ's install trip, so what they
 * install comes back accepted; anyone else (or anyone, with an older HQ) on GitHub's own page —
 * with a newer HQ, what they install there waits for an admin's OK, and they are told so.
 */
export function installOffer(
  app: Extract<GitMirrorApp, { readonly kind: "connected" }>,
  admin: boolean,
):
  | { readonly kind: "trip" }
  | { readonly kind: "page"; readonly url: string; readonly note: string | null } {
  if (app.installTrip === true && admin) return { kind: "trip" };
  return {
    kind: "page",
    url: app.installUrl,
    note: app.installTrip === true ? "What you install there waits for an admin's OK." : null,
  };
}

/** The account whose installation reaches `repository` (`owner/name`) but waits for an OK. */
export function waitingAccount(
  app: Extract<GitMirrorApp, { readonly kind: "connected" }>,
  repository: string,
): string | null {
  const wanted = repository.toLowerCase();
  return (
    app.waiting?.find((each) => each.repositories.some((name) => name.toLowerCase() === wanted))
      ?.account ?? null
  );
}

/** What the person is told of an account installed but waiting. */
export const waitingWords = (account: string) =>
  `${account} waits for an admin's OK in Settings › Automation.`;

/** Said beside the app's repositories while GitHub did not answer about some of its installations. */
export function unansweredWords(
  app: Extract<GitMirrorApp, { readonly kind: "connected" }>,
): string | null {
  const count = app.unanswered ?? 0;
  if (count === 0) return null;
  return count === 1
    ? `GitHub didn't answer about one installation of ${app.name}, so its repositories aren't listed. Check again in a moment.`
    : `GitHub didn't answer about ${count} installations of ${app.name}, so their repositories aren't listed. Check again in a moment.`;
}

/** `owner/name` of a GitHub address, as the app's repositories name it; null for any other. */
export function githubName(url: string): string | null {
  const address = new URL(url);
  if (address.hostname !== "github.com") return null;
  const [owner, name] = address.pathname
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/u, "")
    .split("/");
  return owner && name ? `${owner}/${name}` : null;
}

/** A remote's address as people read it: `github.com/acme/tea-shop`. */
export function remoteLabel(url: string): string {
  const address = new URL(url);
  return `${address.host}${address.pathname.replace(/\.git\/?$/u, "").replace(/\/$/u, "")}`;
}

/** Where a remote goes, as a row names it: `acme/tea-shop` on GitHub, else its whole address. */
export function remoteDestination(url: string): { readonly label: string; readonly href: string } {
  const name = githubName(url);
  const label = name ?? remoteLabel(url);
  return {
    label,
    href: name === null ? url.replace(/\.git\/?$/u, "") : `https://github.com/${name}`,
  };
}

/**
 * The org app a remote goes through, by its GitHub app id; `null` for a token, or where HQ does
 * not say (an HQ before several apps).
 */
export function remoteGithubAppId(remote: NonNullable<RepoListEntry["remote"]>): number | null {
  return "githubAppId" in remote && typeof remote.githubAppId === "number"
    ? remote.githubAppId
    : null;
}

/**
 * When HQ last pushed the repository's main to its remote: `null` before it ever has, `undefined`
 * where HQ does not say (an HQ before it told it).
 */
export function remoteSyncedAt(repo: RepoListEntry): string | null | undefined {
  if (!("mirror" in repo)) return undefined;
  const mirror: unknown = repo.mirror;
  if (mirror === null || typeof mirror !== "object" || !("syncedAt" in mirror)) return undefined;
  return typeof mirror.syncedAt === "string" ? mirror.syncedAt : null;
}

/** "Nov 3", in the reader's own calendar. */
export const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "just now", "4 min ago", "3 hours ago", "yesterday", "on Nov 3". */
export function agoWords(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${String(hours)} hours ago`;
  return hours < 48 ? "yesterday" : `on ${shortDay(iso)}`;
}

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1_000;

/** What a row's one button does for its state: the fix for it, or nothing. */
export type RepoFix =
  | "connect"
  | "how-to-fix"
  | "reconnect"
  | "replace-token"
  | "set-up-github"
  | null;

/** A code repository's state as its row, the dialog and the ask card say it. */
export interface RepoState {
  /** Where its code goes; `null` while it goes nowhere. */
  readonly destination: { readonly label: string; readonly href: string } | null;
  readonly line: string;
  /** `busy`: a press is on its way; `ok`, `warn`, `bad`: the mark beside the line; `quiet`: none. */
  readonly tone: "ok" | "warn" | "bad" | "busy" | "quiet";
  readonly fix: RepoFix;
}

/** A press this tab sent for a repository that HQ's record does not show yet. */
export type RepoPress = "connecting" | "disconnecting" | null;

/** The organization's apps as a repository's state reads them: by id, with their installations. */
export interface RepoStateApps {
  readonly apps: ReadonlyArray<{ readonly appId: number; readonly name: string }>;
  readonly installations: ReadonlyArray<{
    readonly appId: number;
    readonly account: string;
    readonly standing: string;
  }>;
}

/**
 * A repository's one line and its one fix: nothing on GitHub, a press on its way, in sync, paused
 * on diverged mains, stopped because its app left the organization or its account, or because the
 * remote refused its token, and a token that runs out soon. `apps` `null`: not read, so an app's
 * stop is said without naming why.
 */
export function repoState(
  repo: Pick<RepoListEntry, "remote" | "follows"> & Partial<RepoListEntry>,
  context: {
    readonly apps: RepoStateApps | null;
    readonly orgName: string | undefined;
    readonly now: number;
    readonly press?: RepoPress;
  },
): RepoState {
  const { remote, follows } = repo;
  const { apps, now, press = null } = context;
  const org = context.orgName ?? "The organization";
  if (remote == null) {
    if (press === "connecting")
      return { destination: null, line: "Connecting…", tone: "busy", fix: null };
    if (follows !== undefined)
      return {
        destination: remoteDestination(follows),
        line: "Follows it · Mate keeps the code",
        tone: "quiet",
        fix: "connect",
      };
    return { destination: null, line: "Not on GitHub", tone: "quiet", fix: "connect" };
  }
  const destination = remoteDestination(remote.url);
  if (press === "disconnecting")
    return { destination, line: "Disconnecting…", tone: "busy", fix: null };
  if (remote.divergedSince !== undefined)
    return {
      destination,
      line: `Paused since ${shortDay(remote.divergedSince)} · GitHub's main has commits Mate's main doesn't`,
      tone: "warn",
      fix: "how-to-fix",
    };
  if (remote.via === "app" && remote.invalidSince !== null) {
    const stopped = `Stopped ${shortDay(remote.invalidSince)}`;
    if (apps === null)
      return {
        destination,
        line: `${stopped} · GitHub refused the app's access`,
        tone: "warn",
        fix: "reconnect",
      };
    if (apps.apps.length === 0)
      return {
        destination,
        line: `${stopped} · ${org} has no GitHub app`,
        tone: "warn",
        fix: "set-up-github",
      };
    const id = remoteGithubAppId(remote);
    // An HQ that does not say the app: the organization's only one is it.
    const app =
      id === null
        ? apps.apps.length === 1
          ? apps.apps[0]
          : undefined
        : apps.apps.find((each) => each.appId === id);
    if (app === undefined)
      return {
        destination,
        line: `${stopped} · the GitHub app it went through is no longer in ${org}`,
        tone: "warn",
        fix: "reconnect",
      };
    const account = destination.label.split("/")[0]?.toLowerCase();
    const installed = apps.installations.some(
      (each) =>
        each.appId === app.appId &&
        each.standing === "accepted" &&
        each.account.toLowerCase() === account,
    );
    return {
      destination,
      line: installed
        ? `${stopped} · GitHub refused ${app.name}'s access`
        : `${stopped} · ${app.name} isn't installed on ${destination.label.split("/")[0] ?? "its account"}`,
      tone: "warn",
      fix: "reconnect",
    };
  }
  const host = new URL(remote.url).hostname === "github.com" ? "GitHub" : new URL(remote.url).host;
  if (remote.invalidSince !== null)
    return {
      destination,
      line: `Stopped ${shortDay(remote.invalidSince)} · ${host} refused the token`,
      tone: "bad",
      fix: "replace-token",
    };
  if (remote.expiresAt != null && Date.parse(remote.expiresAt) <= now)
    return {
      destination,
      line: `Stopped ${shortDay(remote.expiresAt)} · the token expired`,
      tone: "bad",
      fix: "replace-token",
    };
  const synced = remoteSyncedAt(repo as RepoListEntry);
  if (synced === null) return { destination, line: "Pushing main…", tone: "busy", fix: null };
  if (remote.expiresAt != null && Date.parse(remote.expiresAt) - now <= TWO_WEEKS)
    return {
      destination,
      line: `In sync · with a token that expires ${shortDay(remote.expiresAt)}`,
      tone: "ok",
      fix: "replace-token",
    };
  return {
    destination,
    line: synced === undefined ? "In sync" : `In sync · pushed ${agoWords(synced, now)}`,
    tone: "ok",
    fix: null,
  };
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * A repository's line under its name: why nothing moves, where it mirrors to and how, the GitHub
 * repository it follows while Mate keeps its code, or that it does none.
 */
export function mirrorStateLine(
  { remote, follows }: Pick<RepoListEntry, "remote" | "follows">,
  app: GitMirrorApp,
  now: number,
): string {
  if (remote == null)
    return follows === undefined
      ? "Not mirrored"
      : `Follows ${remoteLabel(follows)} · Mate keeps the code`;
  if (remote.divergedSince !== undefined)
    return `GitHub's main and Mate's main differ since ${day(remote.divergedSince)} — nothing moves until they match`;
  const label = remoteLabel(remote.url);
  if (remote.via === "app") {
    if (remote.invalidSince !== null || app.kind === "none")
      return "The app is gone — connect GitHub again or use a token";
    return `Mirrors to ${label} · through ${app.kind === "connected" ? app.name : "the organization's GitHub app"}`;
  }
  if (remote.invalidSince !== null)
    return `${label} refused Mate's token on ${day(remote.invalidSince)} — replace the token`;
  if (remote.expiresAt == null) return `Mirrors to ${label} · with a token`;
  const expired = Date.parse(remote.expiresAt) <= now;
  return `Mirrors to ${label} · with a token that ${expired ? "expired" : "expires"} ${day(remote.expiresAt)}`;
}

/** The app a repository goes through, as the gate's line names it. */
export interface GateApp {
  readonly name: string;
  /** Its id on GitHub, which a ruleset pins `mate/gate` to. */
  readonly appId?: number | undefined;
}

/**
 * Whether GitHub lets only what was approved in Mate reach the repository's main, through an app
 * only: governed, or advisory with the step that makes it governed — each naming the app's id a
 * ruleset requires `mate/gate` from. Nothing before HQ read it, and nothing once the app is gone.
 * `app` `null`: the app is not known; the origin ask still hands the single-app read.
 */
export function mirrorGateLine(
  remote: RepoListEntry["remote"],
  app: GateApp | GitMirrorApp | null,
): string | undefined {
  const known: GateApp | null =
    app === null || !("kind" in app)
      ? app
      : app.kind === "connected"
        ? { name: app.name, appId: app.appId }
        : null;
  if (remote?.via !== "app" || remote.invalidSince !== null) return;
  if (app !== null && "kind" in app && app.kind === "none") return;
  const name = known?.name ?? "the organization's GitHub app";
  const id = known?.appId === undefined ? undefined : `app ID ${String(known.appId)}`;
  const source = id ?? name;
  switch (remote.governance) {
    case undefined:
      return undefined;
    case "governed":
      return `Main is protected by Mate. Nothing reaches main on GitHub without Mate's approval: mate/gate from ${source}.`;
    // An app made before it asked for statuses has none to approve until its owner adds them.
    case "permission_not_approved":
      return `Main is not protected. ${id === undefined ? name : `${name} (${id})`} can't set mate/gate yet. On GitHub, its owner adds Commit statuses: write and Workflows: write to its permissions where they're missing, then an organization owner approves them.`;
    // Also a ruleset that requires mate/gate but lets anyone push to main.
    case "no_ruleset":
      return `Main is not protected. Nothing on GitHub stops a push or merge into main without Mate's approval. Add a ruleset on main that turns on "Require a pull request before merging" with 0 approvals and requires the check mate/gate from ${source}.`;
    case "gate_not_required":
      return `Main is not protected. Its ruleset doesn't require Mate's approval. Require the check mate/gate from ${source}.`;
    case "gate_not_pinned":
      return `Main is not protected. The mate/gate check its ruleset requires isn't tied to Mate's app, so anyone can set it. Require it from ${source} so only Mate can.`;
  }
}

/** What connecting does, under the dialog's title. */
export const connectLeadLine = (repo: string) =>
  `Mate pushes ${repo}'s main to the repository you pick, and its changes open there for review.`;

/** What mirroring does, above repositories none of which mirrors yet. */
export function mirrorLeadLine(app: GitMirrorApp): string {
  return app.kind === "connected"
    ? "Mirror a repository to GitHub, and Mate's changes to it open there for review."
    : "Mirror a repository to GitHub or GitLab: Mate pushes what lands on its main there.";
}

/**
 * What stands where the way to connect would, for a person HQ does not let change remotes
 * (`HQ_REMOTE_WRITE_VERB`): who can, HQ's refusal, or that HQ has not said; null for one it does.
 */
export function mirrorAuthorityLine(offer: HqOfferState): string | null {
  switch (offer.kind) {
    case "allowed":
      return null;
    case "refused":
      return offer.reason === "not_structure_writer"
        ? "Only an Owner or Admin of the organization can connect this project's code to GitHub."
        : hqRefusalWords({ code: "forbidden", reason: offer.reason });
    case "unknown":
      return "HQ hasn't said yet whether you can connect this project's code to GitHub.";
    case "unavailable":
      return "HQ isn't answering, so connecting to GitHub waits until it does.";
  }
}

/**
 * `?mirror=<appId>&repo=<name>&had=<installation ids>` on a project's page: the connect dialog the
 * person left for GitHub's install page from, opened again over it for that repository once HQ's
 * trip brings them back (HQ adds `github=`), with the installations there before they left.
 */
export function parseMirrorSearch(raw: Record<string, unknown>): {
  readonly mirror?: string;
  readonly repo?: string;
  readonly had?: string;
} {
  if (typeof raw.mirror !== "string" || raw.mirror.length === 0) return {};
  return {
    mirror: raw.mirror,
    ...(typeof raw.repo === "string" && raw.repo.length > 0 ? { repo: raw.repo } : {}),
    ...(typeof raw.had === "string" ? { had: raw.had } : {}),
  };
}

/** The installation ids `had=` carried: `"12,34"` → `[12, 34]`. */
export const parseHad = (had: string | undefined): ReadonlyArray<number> =>
  (had ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
