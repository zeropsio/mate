/**
 * A Gitea pull request address, read back as the change it names.
 *
 * A Mate writes the forge's own url into its conversation — "Pull request
 * carrying this to main, ready for a person to merge:
 * https://…/links/appdev/pulls/5" — and every surface that drew it sent the
 * reader out of the app to a Gitea they have to sign into, for a change this
 * app already draws in full, with its conversation, its commits and its
 * *Merge* (the owner, 2026-09-19: "it linking to a gitea, when we are
 * supposed to already have a panel tab for pull requests").
 *
 * Only this account's own Gitea is recognised. A link to any other forge is
 * somebody else's and still opens where it points: rewriting it would be the
 * app claiming a change it cannot read.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module giteaChangeLink
 */

/** The change a Gitea url names, in the terms the app's own route takes. */
export interface GiteaChangeLink {
  /** The Gitea org, which is a group's slug — never the group id. */
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
}

/**
 * `/{owner}/{repo}/pulls/{n}`, or one of the change's own tabs below it — its
 * files, its commits — which name the same change. A query or a fragment (a
 * comment, a line of the diff) is not part of the path.
 */
const CHANGE_PATH = /^\/([^/]+)\/([^/]+)\/pulls\/(\d+)(?:\/(?:files|commits))?\/?$/u;

/**
 * The change a url names, or `null` where it names something else.
 *
 * `giteaOrigin` is what makes this safe: without it nothing is recognised,
 * because an app that has not been told where its forge lives cannot know
 * whose pull request it is looking at.
 */
export function parseGiteaChangeUrl(
  href: string,
  giteaOrigin: string | undefined,
): GiteaChangeLink | null {
  if (giteaOrigin === undefined || giteaOrigin.length === 0) return null;
  let url: URL;
  let origin: URL;
  try {
    url = new URL(href);
    origin = new URL(giteaOrigin);
  } catch {
    return null;
  }
  // Hosts compare without case (the URL parser lowers them already); a forge
  // reached over plain http is still that forge.
  const web = (protocol: string) => protocol === "https:" || protocol === "http:";
  if (!web(url.protocol) || !web(origin.protocol) || url.host !== origin.host) return null;
  const match = CHANGE_PATH.exec(url.pathname);
  if (match === null) return null;
  const [, owner, repository, number] = match;
  if (owner === undefined || repository === undefined || number === undefined) return null;
  const parsed = Number.parseInt(number, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? { owner, repository, number: parsed } : null;
}

/** The group whose Gitea org is `owner`: Gitea names an org in any case. */
export function groupForGiteaOwner(
  slugs: ReadonlyMap<string, string>,
  owner: string,
): string | undefined {
  const wanted = owner.toLowerCase();
  for (const [groupId, slug] of slugs) {
    if (slug.toLowerCase() === wanted) return groupId;
  }
  return undefined;
}

/** A change of one of the person's groups, which the app opens in place of the forge. */
export interface GiteaGroupChange extends GiteaChangeLink {
  readonly groupId: string;
}

/**
 * The change a link in a conversation names, in one of the person's groups —
 * whatever the link's words — or `null` where the app cannot claim it: another
 * host, an org no group holds, or anything but a pull request. A `null` link
 * stays the external link it was.
 */
export function resolveGiteaChange(
  href: string,
  giteaOrigin: string | undefined,
  slugs: ReadonlyMap<string, string>,
): GiteaGroupChange | null {
  const link = parseGiteaChangeUrl(href, giteaOrigin);
  if (link === null) return null;
  const groupId = groupForGiteaOwner(slugs, link.owner);
  return groupId === undefined ? null : { groupId, ...link };
}
