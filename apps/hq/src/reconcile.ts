/**
 * HQ's records against what git holds, at every takeover and before Core serves (vysledky/
 * hq-backup.md §5). After a restore git is the newer: a set's bundles are taken after its database
 * dump, and git only moves forward (every repository denies deletions and non-fast-forwards and
 * never prunes). So:
 *
 * - **What the records name, git must have** (`missing`): every recorded `main` head, change head,
 *   squash and landed head, release and its tag, deployed commit, and every repository. Records
 *   newer than git come only of mixed sources, and no Core may serve them: the caller holds the lead.
 * - **What git holds beyond the records is recorded** (`catchUp`): a repository of a known
 *   application without its row; a change whose squash is on `main`, merged; a change branch
 *   without its record, a change again — a Mate opens a number only while none of its own is open,
 *   so of a Mate's open changes in a repository only the newest stays open, the rest closed,
 *   superseded; a release tag of the recipe repository without its record, a release. Each is logged
 *   `reconciled`. The heads and `main` themselves follow in the takeover (`gitHost.ts`), as at every
 *   takeover.
 *
 * Afterwards no change branch is without its record, and a new change's number passes them all.
 *
 * While the migration's import is unfinished (`importing`), neither runs: the import records a
 * repository before it brings it, and its releases after, and agrees the two itself as it resumes
 * under the next leader (`importJob.ts`; migration-only, it goes with T14).
 *
 * @module reconcile
 */
import type { GitError, HqGit, Repo } from "@t3tools/hq-git";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import {
  ReleaseEntry,
  ReleaseTag,
  compareReleaseTags,
  parseReleaseMessage,
} from "@t3tools/shared/hqRelease";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { appendEvent } from "./gitEvents.ts";
import type { Leader, NotLeader } from "./leader.ts";
import { squashesOnMain } from "./squashes.ts";

const encodeEntries = Schema.encodeSync(Schema.fromJsonString(Schema.Array(ReleaseEntry)));
const isReleaseTag = Schema.is(ReleaseTag);

/** Who a reconciled record is by. */
const BY = "restore";

/** Whether the migration's import is queued, running, or stopped short of done. */
export const importing = (sql: SqlClient.SqlClient): Effect.Effect<boolean, SqlError> =>
  Effect.map(
    sql<{ readonly unfinished: boolean }>`
      SELECT EXISTS (SELECT 1 FROM hq_import WHERE state <> 'done') AS unfinished`,
    ([row]) => row?.unfinished === true,
  );

/** How many recorded things git lacks, by kind; none when the records and git agree. */
export type Missing = Readonly<Record<string, number>>;

/** Every recorded commit git lacks, and every repository it lacks, counted by kind. */
export const missing = (
  git: HqGit,
  sql: SqlClient.SqlClient,
): Effect.Effect<Missing, GitError | SqlError> =>
  Effect.gen(function* () {
    const present = new Set((yield* git.list()).map((repo) => `${repo.appId}/${repo.id}`));
    const named = yield* sql<{
      readonly app_id: string;
      readonly repo: string;
      readonly kind: string;
      readonly sha: string;
    }>`
      SELECT app_id::text AS app_id, name AS repo, 'main' AS kind, main_head AS sha
      FROM hq_repo WHERE main_head IS NOT NULL
      UNION ALL
      SELECT app_id::text, repo, 'change', head FROM hq_change WHERE head IS NOT NULL
      UNION ALL
      SELECT app_id::text, repo, 'squash', merged_sha FROM hq_change WHERE merged_sha IS NOT NULL
      UNION ALL
      SELECT app_id::text, repo, 'change', landed_head FROM hq_change WHERE landed_head IS NOT NULL
      UNION ALL
      SELECT app_id::text, ${RECIPE_REPO}, 'release', sha FROM hq_release
      UNION ALL
      SELECT e.app_id::text, d.repo, 'deploy', d.sha
      FROM hq_deploy d JOIN hq_environment e ON e.project_id = d.project_id`;
    const repos = yield* sql<{ readonly app_id: string; readonly name: string }>`
      SELECT app_id::text AS app_id, name FROM hq_repo`;
    const counts: Record<string, number> = {};
    const count = (kind: string, n: number) => {
      if (n > 0) counts[kind] = (counts[kind] ?? 0) + n;
    };
    count("repository", repos.filter((row) => !present.has(`${row.app_id}/${row.name}`)).length);
    const byRepo = new Map<string, Array<(typeof named)[number]>>();
    for (const row of named) {
      const key = `${row.app_id}/${row.repo}`;
      byRepo.set(key, [...(byRepo.get(key) ?? []), row]);
    }
    for (const [key, rows] of byRepo) {
      if (!present.has(key)) {
        for (const row of rows) count(row.kind, 1);
        continue;
      }
      const [appId = "", id = ""] = key.split("/");
      const lacked = new Set(
        yield* git.missingCommits({ appId, id }, [...new Set(rows.map((row) => row.sha))]),
      );
      for (const row of rows) if (lacked.has(row.sha)) count(row.kind, 1);
    }
    // A release is its tag too.
    const releases = yield* sql<{ readonly app_id: string; readonly tag: string }>`
      SELECT app_id::text AS app_id, tag FROM hq_release`;
    for (const appId of new Set(releases.map((row) => row.app_id))) {
      if (!present.has(`${appId}/${RECIPE_REPO}`)) continue;
      const tags = new Set(
        (yield* git.tags({ appId, id: RECIPE_REPO })).items.map((tag) => tag.name),
      );
      count(
        "release tag",
        releases.filter((row) => row.app_id === appId && !tags.has(row.tag)).length,
      );
    }
    return counts;
  });

interface ChangeRow {
  readonly number: number;
  readonly mate_project_id: string;
  readonly state: string;
}

/** What git holds beyond the records, recorded, each logged `reconciled`. */
export const catchUp = (
  git: HqGit,
  sql: SqlClient.SqlClient,
  leader: Leader["Service"],
): Effect.Effect<void, GitError | SqlError | NotLeader> =>
  Effect.gen(function* () {
    const apps = new Set(
      (yield* sql<{ readonly id: string }>`SELECT id::text AS id FROM hq_app`).map((row) => row.id),
    );
    const rows = new Set(
      (yield* sql<{ readonly app_id: string; readonly name: string }>`
          SELECT app_id::text AS app_id, name FROM hq_repo`).map(
        (row) => `${row.app_id}/${row.name}`,
      ),
    );
    for (const repo of yield* git.list()) {
      if (rows.has(`${repo.appId}/${repo.id}`)) continue;
      if (!apps.has(repo.appId)) {
        yield* Effect.logWarning("a repository of an application HQ does not know, left aside", {
          repo,
        });
        continue;
      }
      yield* leader.write(sql`
        INSERT INTO hq_repo (app_id, name, created_by)
        VALUES (${repo.appId}::uuid, ${repo.id}, ${BY}) ON CONFLICT DO NOTHING`);
      rows.add(`${repo.appId}/${repo.id}`);
    }
    for (const key of rows) {
      const [appId = "", id = ""] = key.split("/");
      yield* changesOf(git, sql, leader, { appId, id });
    }
    for (const appId of apps) {
      if (rows.has(`${appId}/${RECIPE_REPO}`)) {
        yield* releasesOf(git, sql, leader, { appId, id: RECIPE_REPO });
      }
    }
  });

/** One repository's changes: squashes recorded, branches recorded, the superseded closed. */
const changesOf = (git: HqGit, sql: SqlClient.SqlClient, leader: Leader["Service"], repo: Repo) =>
  Effect.gen(function* () {
    const branches = yield* git.changeRefs(repo);
    const records = yield* sql<ChangeRow>`
      SELECT number, mate_project_id, state FROM hq_change
      WHERE app_id::text = ${repo.appId} AND repo = ${repo.id}`;
    const known = new Set(records.map((row) => row.number));
    const orphans = branches.filter((branch) => !known.has(branch.number));
    const open = records.filter((row) => row.state === "open");
    if (orphans.length === 0 && open.length === 0) return;
    const squashes = yield* squashesOnMain(git, repo).pipe(
      Effect.catchIf(
        (error) => error.reason === "no_main" || error.reason === "not_found",
        () => Effect.succeed(new Map<string, string>()),
      ),
    );
    const squashOf = (mateId: string, number: number) =>
      squashes.get(`${mateId}/${String(number)}`) ?? null;
    const headOf = new Map(branches.map((branch) => [branch.number, branch.sha]));
    // Merged, as `main` holds their squash.
    const merged = new Set<number>();
    for (const row of open) {
      const squash = squashOf(row.mate_project_id, row.number);
      if (squash === null) continue;
      merged.add(row.number);
      const head = headOf.get(row.number) ?? null;
      yield* leader.write(
        Effect.andThen(
          sql`
            UPDATE hq_change
            SET state = 'merged', merged_sha = ${squash}, landed_head = ${head},
                head = COALESCE(${head}, head),
                merged_at = now(), updated_at = now(), mergeability = 'already_merged',
                behind = false
            WHERE app_id::text = ${repo.appId} AND repo = ${repo.id} AND number = ${row.number}`,
          appendEvent(sql, {
            kind: "merged",
            appId: repo.appId,
            repo: repo.id,
            number: row.number,
            data: {
              mergedSha: squash,
              landedHead: head,
              by: BY,
              recovered: true,
              reconciled: true,
            },
          }),
        ),
      );
    }
    // Of each Mate's open changes, its newest stays open.
    const newest = new Map<string, number>();
    const candidates = [
      ...open
        .filter((row) => !merged.has(row.number))
        .map((row) => ({ mateId: row.mate_project_id, number: row.number })),
      ...orphans
        .filter((branch) => squashOf(branch.mateId, branch.number) === null)
        .map((branch) => ({ mateId: branch.mateId, number: branch.number })),
    ];
    for (const { mateId, number } of candidates) {
      newest.set(mateId, Math.max(newest.get(mateId) ?? 0, number));
    }
    for (const row of open) {
      if (merged.has(row.number) || newest.get(row.mate_project_id) === row.number) continue;
      yield* leader.write(
        Effect.andThen(
          sql`
            UPDATE hq_change SET state = 'closed', closed_at = now(), updated_at = now()
            WHERE app_id::text = ${repo.appId} AND repo = ${repo.id} AND number = ${row.number}`,
          appendEvent(sql, {
            kind: "closed",
            appId: repo.appId,
            repo: repo.id,
            number: row.number,
            data: { by: BY, reason: "superseded", reconciled: true },
          }),
        ),
      );
    }
    for (const branch of orphans) {
      const squash = squashOf(branch.mateId, branch.number);
      const state =
        squash !== null
          ? "merged"
          : newest.get(branch.mateId) === branch.number
            ? "open"
            : "closed";
      yield* leader.write(
        Effect.andThen(
          sql`
            INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, state, head,
              merged_sha, landed_head, merged_at, closed_at, mergeability)
            VALUES (${repo.appId}::uuid, ${repo.id}, ${branch.number}, ${branch.mateId},
              ${`Change ${String(branch.number)} (restored)`}, ${state}, ${branch.sha},
              ${squash}, ${squash === null ? null : branch.sha},
              ${squash === null ? null : sql`now()`},
              ${state === "closed" ? sql`now()` : null},
              ${squash === null ? "unknown" : "already_merged"})`,
          appendEvent(sql, {
            kind: "opened",
            appId: repo.appId,
            repo: repo.id,
            number: branch.number,
            data: { mateProjectId: branch.mateId, state, by: BY, reconciled: true },
          }),
        ),
      );
    }
  });

/** The recipe repository's release tags without their records, recorded from the tags. */
const releasesOf = (git: HqGit, sql: SqlClient.SqlClient, leader: Leader["Service"], repo: Repo) =>
  Effect.gen(function* () {
    const recorded = new Set(
      (yield* sql<{ readonly tag: string }>`
          SELECT tag FROM hq_release WHERE app_id::text = ${repo.appId}`).map((row) => row.tag),
    );
    const tags = (yield* git.tags(repo)).items
      .filter((tag) => isReleaseTag(tag.name) && !recorded.has(tag.name))
      .sort((a, b) => compareReleaseTags(a.name, b.name));
    for (const tag of tags) {
      const read = parseReleaseMessage(tag.message);
      const entries = "entries" in read ? read.entries : [];
      const reason = "refused" in read ? read.refused : null;
      yield* leader.write(
        Effect.andThen(
          sql`
            INSERT INTO hq_release (app_id, tag, sha, entries, released_by, released_at, state,
              reason)
            VALUES (${repo.appId}::uuid, ${tag.name}, ${tag.sha}, ${encodeEntries(entries)}::jsonb,
              ${BY}, ${tag.taggedAt === "" ? sql`now()` : sql`${tag.taggedAt}::timestamptz`},
              ${reason === null ? "approved" : "refused"}, ${reason})
            ON CONFLICT DO NOTHING`,
          appendEvent(sql, {
            kind: "released",
            appId: repo.appId,
            repo: repo.id,
            number: null,
            data: { tag: tag.name, sha: tag.sha, by: BY, reconciled: true },
          }),
        ),
      );
    }
  });
