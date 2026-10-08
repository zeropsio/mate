/**
 * HQ's records against what git holds, at every takeover and before Core serves (vysledky/
 * hq-backup.md §5). After a restore git is the newer: a set's bundles are taken after its database
 * dump, and git only moves forward (every repository denies deletions and non-fast-forwards and
 * never prunes). So:
 *
 * - **What the records name, git must have** (`missing`): every recorded `main` head, change head,
 *   squash and landed head, release and its tag, deployed commit, and every repository a record
 *   names anything in. Records newer than git come only of mixed sources, and no Core may serve
 *   them: the caller holds the lead. A recorded repository naming nothing, git lacking it, is a
 *   creation an older build cut short, recording before making (H1): `catchUp` makes it.
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
 * Neither looks into a repository the takeover quarantined (`withheld`, `gitHost.ts`): git cannot be
 * read there until it converges, and the next takeover judges it.
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
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { firstCodeMergeOf } from "./firstCodeMerge.ts";
import { appendEvent } from "./gitEvents.ts";
import type { Leader, NotLeader } from "./leader.ts";
import { squashesOnMain } from "./squashes.ts";

const encodeEntries = Schema.encodeSync(Schema.fromJsonString(Schema.Array(ReleaseEntry)));
const isReleaseTag = Schema.is(ReleaseTag);

/** Who a reconciled record is by. */
const BY = "restore";

/** Who writes HQ's own commits. */
const HQ_AUTHOR = { name: "HQ", email: "hq@hq.invalid" };

/**
 * A repository made in git, before any record names it: created, and its `main` an empty tree's
 * commit, as Gitea's first commit gave every change a base. Each step holds when it is done
 * already, so one cut short is finished by the next.
 */
export const madeRepo = (git: HqGit, repo: Repo) =>
  Effect.gen(function* () {
    yield* git.create(repo).pipe(
      Effect.catchIf(
        (error) => error.reason === "exists",
        () => Effect.void,
      ),
    );
    // A main that is there already (`head_moved`) stays as it is.
    yield* git.commitFiles(repo, "refs/heads/main", {
      files: {},
      expectedHead: null,
      message: "Initial commit",
      author: HQ_AUTHOR,
    });
  });

/** How many recorded things git lacks, by kind; none when the records and git agree. */
export type Missing = Readonly<Record<string, number>>;

/**
 * Every recorded commit git lacks, and every repository it lacks, counted by kind; not what
 * `withheld` repositories (`<appId>/<repo>`) hold.
 */
export const missing = (
  git: HqGit,
  sql: SqlClient.SqlClient,
  withheld: ReadonlySet<string>,
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
      SELECT e.app_id::text, j.repo, 'deploy', j.sha
      FROM hq_deploy_job j JOIN hq_environment e ON e.project_id = j.project_id
      WHERE j.kind = 'deploy'`;
    const repos = yield* sql<{ readonly app_id: string; readonly name: string }>`
      SELECT app_id::text AS app_id, name FROM hq_repo`;
    const counts: Record<string, number> = {};
    const count = (kind: string, n: number) => {
      if (n > 0) counts[kind] = (counts[kind] ?? 0) + n;
    };
    const byRepo = new Map<string, Array<(typeof named)[number]>>();
    for (const row of named) {
      const key = `${row.app_id}/${row.repo}`;
      byRepo.set(key, [...(byRepo.get(key) ?? []), row]);
    }
    count(
      "repository",
      repos.filter((row) => {
        const key = `${row.app_id}/${row.name}`;
        return !present.has(key) && byRepo.has(key);
      }).length,
    );
    for (const [key, rows] of byRepo) {
      if (withheld.has(key)) continue;
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
      const recipe = `${appId}/${RECIPE_REPO}`;
      if (!present.has(recipe) || withheld.has(recipe)) continue;
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

/**
 * What git holds beyond the records, recorded, each logged `reconciled`; `withheld` repositories
 * left to the takeover that serves them.
 */
export const catchUp = (
  git: HqGit,
  sql: SqlClient.SqlClient,
  leader: Leader["Service"],
  withheld: ReadonlySet<string>,
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
    const listed = yield* git.list();
    const present = new Set(listed.map((repo) => `${repo.appId}/${repo.id}`));
    for (const repo of listed) {
      const key = `${repo.appId}/${repo.id}`;
      if (rows.has(key) || withheld.has(key)) continue;
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
    // A recorded repository git lacks names nothing (`missing` holds the lead otherwise): its
    // creation was cut short, and is finished.
    for (const key of rows) {
      if (present.has(key)) continue;
      const [appId = "", id = ""] = key.split("/");
      yield* madeRepo(git, { appId, id });
      yield* Effect.logInfo("reconciled: a repository's cut-short creation finished", {
        appId,
        repo: id,
      });
    }
    for (const key of rows) {
      if (withheld.has(key)) continue;
      const [appId = "", id = ""] = key.split("/");
      yield* changesOf(git, sql, leader, { appId, id });
    }
    for (const appId of apps) {
      const recipe = `${appId}/${RECIPE_REPO}`;
      if (rows.has(recipe) && !withheld.has(recipe)) {
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
    // Of each Mate's open changes, its newest stays open.
    const newest = new Map<string, number>();
    // A branch with no record, recorded: merged where main holds its squash, else open if it is its
    // Mate's newest, else closed.
    const restoreOrphan = (
      branch: { readonly mateId: string; readonly number: number; readonly sha: string },
      squash: string | null,
    ) =>
      Effect.gen(function* () {
        const state =
          squash !== null
            ? "merged"
            : newest.get(branch.mateId) === branch.number
              ? "open"
              : "closed";
        yield* leader.write(
          Effect.gen(function* () {
            const first =
              squash === null
                ? null
                : yield* firstCodeMergeOf(sql, {
                    appId: repo.appId,
                    repo: repo.id,
                    number: branch.number,
                  });
            yield* sql`
              INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, state, head,
                merged_sha, landed_head, merged_at, closed_at, mergeability, first_code_merge)
              VALUES (${repo.appId}::uuid, ${repo.id}, ${branch.number}, ${branch.mateId},
                ${`Change ${String(branch.number)} (restored)`}, ${state}, ${branch.sha},
                ${squash}, ${squash === null ? null : branch.sha},
                ${squash === null ? null : sql`now()`},
                ${state === "closed" ? sql`now()` : null},
                ${squash === null ? "unknown" : "already_merged"}, ${first}::boolean)`;
            yield* appendEvent(sql, {
              kind: "opened",
              appId: repo.appId,
              repo: repo.id,
              number: branch.number,
              data: { mateProjectId: branch.mateId, state, by: BY, reconciled: true },
            });
          }),
        );
      });
    // Merged, as `main` holds their squash: recorded in the order main merged them, oldest first,
    // so each one's first-code-merge flag reads what the ones before it recorded.
    const mergedFirst = [...squashes.keys()].toReversed();
    const mergedAt = (mateId: string, number: number) =>
      mergedFirst.indexOf(`${mateId}/${String(number)}`);
    const merged = new Set<number>(
      open
        .filter((row) => squashOf(row.mate_project_id, row.number) !== null)
        .map((row) => row.number),
    );
    const recoveries = [
      ...open
        .filter((row) => merged.has(row.number))
        .map((row) => ({ at: mergedAt(row.mate_project_id, row.number), row, branch: undefined })),
      ...orphans
        .filter((branch) => squashOf(branch.mateId, branch.number) !== null)
        .map((branch) => ({ at: mergedAt(branch.mateId, branch.number), row: undefined, branch })),
    ].toSorted((one, other) => one.at - other.at);
    for (const { row, branch } of recoveries) {
      if (branch !== undefined) {
        yield* restoreOrphan(branch, squashOf(branch.mateId, branch.number));
        continue;
      }
      const squash = squashOf(row!.mate_project_id, row!.number)!;
      const head = headOf.get(row!.number) ?? null;
      yield* leader.write(
        Effect.gen(function* () {
          const first = yield* firstCodeMergeOf(sql, {
            appId: repo.appId,
            repo: repo.id,
            number: row!.number,
          });
          yield* sql`
            UPDATE hq_change
            SET state = 'merged', merged_sha = ${squash}, landed_head = ${head},
                head = COALESCE(${head}, head),
                merged_at = now(), updated_at = now(), mergeability = 'already_merged',
                behind = false, first_code_merge = ${first}::boolean
            WHERE app_id::text = ${repo.appId} AND repo = ${repo.id} AND number = ${row!.number}`;
          yield* appendEvent(sql, {
            kind: "merged",
            appId: repo.appId,
            repo: repo.id,
            number: row!.number,
            data: {
              mergedSha: squash,
              landedHead: head,
              by: BY,
              recovered: true,
              reconciled: true,
            },
          });
        }),
      );
    }
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
      if (squashOf(branch.mateId, branch.number) === null) yield* restoreOrphan(branch, null);
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
