/**
 * What the mirror dialog says of a repository's mirror: where it mirrors to and how, or why it
 * moves nothing — diverged, its token refused, the app it went through gone — and what mirroring
 * does at all, as the organization's GitHub app is there or not.
 */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";

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
      readonly installUrl: string;
    }
  | { readonly kind: "none" }
  | { readonly kind: "unknown" };

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
function remoteLabel(url: string): string {
  const address = new URL(url);
  return `${address.host}${address.pathname.replace(/\.git\/?$/u, "").replace(/\/$/u, "")}`;
}

const day = (iso: string) => iso.slice(0, 10);

/** A repository's line under its name: why nothing moves, where it mirrors to and how, or that it does not. */
export function mirrorStateLine(
  remote: RepoListEntry["remote"],
  app: GitMirrorApp,
  now: number,
): string {
  if (remote == null) return "Not mirrored";
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

/**
 * Whether GitHub lets only what was approved in Mate reach the repository's main, through the app
 * only: governed, or advisory with the step that makes it governed — each naming the app's id a
 * ruleset requires `mate/gate` from. Nothing before HQ read it, and nothing more once the app is gone.
 */
export function mirrorGateLine(
  remote: RepoListEntry["remote"],
  app: GitMirrorApp,
): string | undefined {
  if (remote?.via !== "app" || remote.invalidSince !== null || app.kind === "none") return;
  const name = app.kind === "connected" ? app.name : "the organization's GitHub app";
  const id =
    app.kind === "connected" && app.appId !== undefined ? `app ID ${String(app.appId)}` : undefined;
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

/** What mirroring does, above repositories none of which mirrors yet. */
export function mirrorLeadLine(app: GitMirrorApp): string {
  return app.kind === "connected"
    ? "Mirror a repository to GitHub, and Mate's changes to it open there for review."
    : "Mirror a repository to GitHub or GitLab: Mate pushes what lands on its main there.";
}
