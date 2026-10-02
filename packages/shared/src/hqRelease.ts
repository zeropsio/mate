/**
 * An application's releases to production in HQ (SPEC §3.2d). A release is an annotated tag
 * `v{x.y.z}` on the `main` of the application's recipe repository (`hqRecipe.ts` `RECIPE_REPO`),
 * the head read with the offer, whose message lists the commit each production service runs:
 * {@link releaseMessage}, read strictly by {@link parseReleaseMessage}. HQ judges a release as it
 * makes it: Core tags it for the person `can`'s `release` allows (`zeropsPermissions.ts`), so it is
 * approved and recorded; a refused one stays refused for ever. Production follows the newest
 * approved release.
 *
 * A person's side, `Authorization: Bearer <session>`:
 *
 * - `GET /api/apps/:appId/releases` → {@link ReleaseListResponse}: newest first by version
 *   ({@link compareReleaseTags}), at most {@link RELEASES_SHOWN};
 * - `POST /api/apps/:appId/releases` {@link CreateReleaseRequest} → the {@link Release};
 * - `POST /api/apps/:appId/releases/:tag/rollback` {@link RollbackRequest} → a new release named
 *   {@link nextPatch} over every release, listing `:tag`'s entries; `:tag` stays as it was, and an
 *   unknown one is `404 release_not_found`.
 *
 * A refusal is `409 conflict` with one of {@link RELEASE_REFUSALS}; the words are the client's.
 *
 * @module hqRelease
 */
import * as Schema from "effect/Schema";

import { Sha } from "./hqChanges.ts";

/** How many releases the history shows, as main's did (`RELEASES_SHOWN`). */
export const RELEASES_SHOWN = 10;

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/u;
/** A Zerops service's hostname: what a release line names (main's broker's `serviceName`). */
const HOSTNAME = /^[a-z][a-z0-9]{0,39}$/u;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** A release's name: `v{major}.{minor}.{patch}`, nothing before or after. */
export const ReleaseTag = Schema.String.check(Schema.isPattern(TAG));

/** A production service a release lists, by its hostname. */
export const ServiceName = Schema.String.check(Schema.isPattern(HOSTNAME));

/** One production service at the commit of its repository's `main` it is to run. */
export const ReleaseEntry = Schema.Struct({ service: ServiceName, sha: Sha });
export type ReleaseEntry = typeof ReleaseEntry.Type;

/**
 * A release as HQ records it: its name, the recipe repository's `main` head it tags, what it lists,
 * who asked for it and when, and HQ's verdict — the reason beside a refusal, none beside an
 * approval.
 */
export const Release = Schema.Struct({
  tag: ReleaseTag,
  sha: Sha,
  entries: Schema.Array(ReleaseEntry),
  by: Schema.String,
  at: Schema.String,
  state: Schema.Literals(["approved", "refused"]),
  reason: Schema.NullOr(Schema.String),
});
export type Release = typeof Release.Type;

export const ReleaseListResponse = Schema.Struct({ releases: Schema.Array(Release) });
export type ReleaseListResponse = typeof ReleaseListResponse.Type;

/** At least one service, and each once: what a release message can carry. */
const Entries = Schema.Array(ReleaseEntry).check(
  Schema.makeFilter((entries: ReadonlyArray<ReleaseEntry>) =>
    entries.length === 0
      ? "Expected at least one service"
      : new Set(entries.map((entry) => entry.service)).size === entries.length
        ? undefined
        : "Expected each service once",
  ),
);

/**
 * A release as the person was offered it: its name, the recipe repository's `main` head read with
 * the offer (never one read at the press), and each production service at its repository's `main`
 * head then. HQ tags that head only while it is still `main`.
 */
export const CreateReleaseRequest = Schema.Struct({
  tag: ReleaseTag,
  groupHead: Sha,
  entries: Entries,
});
export type CreateReleaseRequest = typeof CreateReleaseRequest.Type;

/** A rollback tags the recipe repository's `main` head read with its offer, as a release does. */
export const RollbackRequest = Schema.Struct({ groupHead: Sha });
export type RollbackRequest = typeof RollbackRequest.Type;

/**
 * Why HQ makes no release. Of a message, as a tag carries it: it lists no service, has a line that is
 * not `{service} {full sha}`, or lists a service at two commits. Of HQ's own reading: the recipe
 * repository's `main` moved since the offer, or it has none; a release has the name already; an
 * entry names no production service of the application, or a commit that is not its repository's
 * `main` nor before it; or the release rolled back to was refused.
 */
export const RELEASE_REFUSALS = [
  "release_empty",
  "release_line_unreadable",
  "release_service_twice",
  "group_moved",
  "no_group_main",
  "tag_taken",
  "unknown_service",
  "entry_not_on_main",
  "release_not_approved",
] as const;

export type ReleaseRefusal = (typeof RELEASE_REFUSALS)[number];

/** The message of a release listing `entries`: one `{service} {sha}` line each, by service. */
export function releaseMessage(entries: ReadonlyArray<ReleaseEntry>): string {
  return [...entries]
    .sort((left, right) => (left.service < right.service ? -1 : 1))
    .map((entry) => `${entry.service} ${entry.sha}\n`)
    .join("");
}

/**
 * What a release's message lists, by service, as main's broker read it: blank lines pass, any other
 * line that is not `{hostname} {full sha}` refuses the whole message — half a release would deploy
 * half an application — as does a service at two commits, or no service at all.
 */
export function parseReleaseMessage(
  message: string,
):
  | { readonly entries: ReadonlyArray<ReleaseEntry> }
  | { readonly refused: "release_empty" | "release_line_unreadable" | "release_service_twice" } {
  const found = new Map<string, string>();
  for (const raw of message.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const space = line.indexOf(" ");
    const service = space === -1 ? line : line.slice(0, space);
    const sha = space === -1 ? "" : line.slice(space + 1).trim();
    if (!HOSTNAME.test(service) || !FULL_SHA.test(sha))
      return { refused: "release_line_unreadable" };
    const listed = found.get(service);
    if (listed !== undefined && listed !== sha) return { refused: "release_service_twice" };
    found.set(service, sha);
  }
  if (found.size === 0) return { refused: "release_empty" };
  return {
    entries: [...found]
      .map(([service, sha]) => ({ service, sha }))
      .sort((left, right) => (left.service < right.service ? -1 : 1)),
  };
}

const versionOf = (tag: string) => {
  const match = TAG.exec(tag);
  return match === null ? undefined : [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)];
};

/**
 * Two release names by version, numerically: `v0.10.0` after `v0.9.0`, whatever its digits; a name
 * that is no release before every one that is.
 */
export function compareReleaseTags(left: string, right: string): number {
  const a = versionOf(left);
  const b = versionOf(right);
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]! ? 1 : -1;
  }
  return 0;
}

/** The name the next release is offered: the patch over the newest by version; `v0.1.0` first. */
export function nextPatch(tags: ReadonlyArray<string>): string {
  const newest = tags
    .filter((tag) => versionOf(tag) !== undefined)
    .reduce<string | undefined>(
      (best, tag) => (best === undefined || compareReleaseTags(tag, best) > 0 ? tag : best),
      undefined,
    );
  const version = newest === undefined ? undefined : versionOf(newest);
  if (version === undefined) return "v0.1.0";
  const [major, minor, patch] = version;
  return `v${String(major)}.${String(minor)}.${String(patch! + 1n)}`;
}
