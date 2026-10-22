/**
 * `home`: the commit `rev` names now, the ref it is, what the repository is beside it, and its
 * README at that commit. It moves with its ref, so it is never cached.
 *
 * @module gitBrowse/home
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HqRepoGovernance } from "@t3tools/shared/hqChanges";
import { GitHomeQuery, README_MAX_BYTES, type GitHome } from "@t3tools/shared/hqGitBrowse/home";
import { ChangeRefused } from "../changes.ts";
import { GitHost, changesOnBranches } from "../gitHost.ts";
import { remoteIdentity } from "../gitTransport.ts";
import { browseAccess } from "./access.ts";
import type { BrowseInput } from "./routes.ts";

const decodeGovernance = Schema.decodeUnknownOption(HqRepoGovernance);
const instant = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${column}`;

/** Where the repository comes from and how HQ last followed it. */
const aboutOf = (appId: string, repo: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // A remote no person keeps any more (`remoteForWire`) is no remote to open.
    const [remote] = yield* sql<{ readonly url: string }>`
      SELECT url FROM hq_repo_remote WHERE app_id::text = ${appId} AND repo = ${repo}
        AND kept_at IS NOT NULL AND kept_by IS NOT NULL`;
    const [mirror] = yield* sql<{
      readonly synced_at: string | null;
      readonly diverged_since: string | null;
      readonly governance: string | null;
    }>`
      SELECT ${sql.literal(instant("synced_at"))}, ${sql.literal(instant("diverged_since"))}, governance
      FROM hq_repo_mirror WHERE app_id::text = ${appId} AND repo = ${repo}`;
    return {
      remote:
        remote !== undefined && remoteIdentity(remote.url)?.kind === "github"
          ? { url: remote.url, provider: "github" as const }
          : null,
      mirror:
        mirror === undefined
          ? null
          : {
              syncedAt: mirror.synced_at,
              divergedSince: mirror.diverged_since,
              governance: Option.getOrNull(decodeGovernance(mirror.governance)),
            },
    };
  });

export const homeRead = {
  read: "home" as const,
  query: GitHomeQuery,
  deadline: Duration.seconds(5),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitHomeQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const resolved = yield* git.browse.resolve(held.repo, query.rev);
      if (resolved.kind === "missing")
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      const counts = yield* git.browse.refCounts(held.repo);
      const about = {
        ...(yield* aboutOf(appId, repo)),
        updatedAt: held.updatedAt,
        branchCount: counts.branches,
        tagCount: counts.tags,
      };
      const body: GitHome =
        resolved.kind === "unborn"
          ? { sha: null, ref: { name: "main", kind: "branch" }, about, readme: null }
          : {
              sha: resolved.sha,
              ref:
                resolved.ref.kind === "branch" &&
                (yield* changesOnBranches(held.repo, [resolved.ref.name])).has(resolved.ref.name)
                  ? { ...resolved.ref, kind: "change" }
                  : resolved.ref,
              about,
              readme: yield* git.browse.readme(held.repo, resolved.sha, README_MAX_BYTES),
            };
      return { body, pinned: null };
    }),
};
