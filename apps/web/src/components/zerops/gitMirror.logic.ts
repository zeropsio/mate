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
      /** The repositories it reaches, by `owner/name`. */
      readonly repositories: ReadonlyArray<string>;
      readonly installUrl: string;
    }
  | { readonly kind: "none" }
  | { readonly kind: "unknown" };

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

/** What mirroring does, above repositories none of which mirrors yet. */
export function mirrorLeadLine(app: GitMirrorApp): string {
  return app.kind === "connected"
    ? "Mirror a repository to GitHub, and Mate's changes to it open there for review."
    : "Mirror a repository to GitHub or GitLab: Mate pushes what lands on its main there.";
}
