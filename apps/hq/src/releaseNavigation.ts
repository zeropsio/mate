/** Compact release candidates, shared across people; no app-detail reads or catalogs on the wire. */
import type { HqDecision } from "@t3tools/shared/hqOffers";
import type { HqGit } from "@t3tools/hq-git";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { nextPatch } from "@t3tools/shared/hqRelease";
import type { HqNavigationReleaseOffer } from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import {
  productionAttachmentOf,
  type ProductionAttachmentRow,
  gitReleaseRoster,
  readGitReleaseBlocker,
} from "./offers.ts";
import { tierRuntimes } from "./tierRuntimes.ts";

export type ReleaseCandidate = Omit<HqNavigationReleaseOffer, "gate" | "inFlight"> & {
  readonly readiness?: HqDecision;
};
export interface ReleaseNavigationSource {
  readonly fingerprints: ReadonlyMap<string, string>;
  readonly forApp: (appId: string) => ReleaseCandidate | null;
}
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** The same production declarations and recorded main heads the release write validates. */
export function makeReleaseNavigationReader<E>(
  sql: SqlClient.SqlClient,
  git: Effect.Effect<HqGit, E>,
  recipe: (appId: string) => Effect.Effect<RecipeTierResponse, E>,
) {
  const cache = new Map<string, { fingerprint: string; value: ReleaseCandidate }>();
  return Effect.gen(function* () {
    // The navigation snapshot stays at three shared reads, including remote and destination facts.
    const repos = yield* sql<
      ProductionAttachmentRow & {
        app_id: string;
        name: string;
        main_head: string | null;
        url: string | null;
        host_repo_id: string | null;
        kept_at: string | null;
        kept_by: string | null;
        expires_at: string | null;
        invalid_since: string | null;
        usable: boolean;
      }
    >`SELECT r.app_id::text AS app_id,r.name,r.main_head,e.id,
      to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
      e.target,e.project_id,e.branch,e.delivery,m.url,m.host_repo_id,m.kept_at::text,m.kept_by,m.expires_at::text,m.invalid_since::text,
      m.sealed IS NOT NULL AND m.invalid_since IS NULL AS usable
      FROM hq_repo r LEFT JOIN hq_environment e ON e.app_id=r.app_id AND e.tier='production'
      LEFT JOIN hq_repo_remote m ON m.app_id=r.app_id AND m.repo=r.name ORDER BY r.app_id,r.name`;
    const remotes = repos
      .filter((row) => row.url !== null)
      .map((row) => ({ ...row, repo: row.name }));
    const tags = yield* sql<{
      app_id: string;
      tag: string;
    }>`SELECT app_id::text AS app_id,tag FROM hq_release`;
    const running = yield* sql<{ app_id: string; service: string; sha: string }>`
      SELECT DISTINCT ON (e.app_id,CASE WHEN e.target='git' THEN j.repo ELSE j.service END)
        e.app_id::text AS app_id,CASE WHEN e.target='git' THEN j.repo ELSE j.service END AS service,j.sha
      FROM hq_environment e JOIN hq_deploy_job j ON j.environment_id=e.id
      WHERE e.tier='production' AND j.sha IS NOT NULL AND
        ((e.target='zerops' AND j.kind='deploy' AND j.state='live' AND j.service IS NOT NULL)
          OR (e.target='git' AND j.kind='push' AND j.state='pushed'))
      ORDER BY e.app_id,CASE WHEN e.target='git' THEN j.repo ELSE j.service END,j.id DESC`;
    const values = new Map<string, ReleaseCandidate>();
    for (const appId of new Set(repos.map((row) => row.app_id))) {
      const heads = repos.filter((row) => row.app_id === appId);
      const releases = tags.filter((row) => row.app_id === appId).map((row) => row.tag);
      const attachment = productionAttachmentOf(heads[0]);
      const connected = gitReleaseRoster(
        remotes
          .filter((row) => row.app_id === appId)
          .map((remote) => ({ ...remote, name: remote.repo, connected: true })),
      );
      const blocker =
        attachment?.target.kind === "git"
          ? yield* readGitReleaseBlocker(sql, appId, attachment)
          : undefined;
      const production = running.filter((row) => row.app_id === appId);
      const fingerprint = json([
        heads,
        releases.toSorted(),
        production,
        attachment,
        connected,
        blocker,
      ]);
      const kept = cache.get(appId);
      if (kept?.fingerprint === fingerprint) {
        values.set(appId, kept.value);
        continue;
      }
      const head = heads.find((row) => row.name === RECIPE_REPO)?.main_head ?? null;
      const tier =
        attachment?.target.kind === "git" || head === null
          ? { state: "absent" as const }
          : yield* recipe(appId);
      // A ref moving during the read is not a candidate at the captured head.
      if (tier.state === "present" && tier.mainHead !== head) {
        if (kept !== undefined) values.set(appId, kept.value);
        continue;
      }
      const declared = tier.state === "present" ? tierRuntimes(tier.importYaml, appId) : null;
      const ranges = new Map<string, { repo: string; base: string | null; head: string }>();
      if (declared?.ok)
        for (const runtime of declared.runtimes) {
          const target = heads.find((row) => row.name === runtime.repo)?.main_head;
          if (target == null) continue;
          const base = production.find((row) => row.service === runtime.hostname)?.sha ?? null;
          if (base === target) continue;
          ranges.set(json([runtime.repo, base, target]), {
            repo: runtime.repo,
            base,
            head: target,
          });
        }
      if (attachment?.target.kind === "git") {
        for (const repository of gitReleaseRoster(
          heads.map((row) => ({
            ...row,
            connected: connected.some((remote) => remote.repo === row.name),
          })),
        )) {
          if (repository.main_head === null) continue;
          const base = production.find((row) => row.service === repository.name)?.sha ?? null;
          if (base === repository.main_head) continue;
          ranges.set(json([repository.name, base, repository.main_head]), {
            repo: repository.name,
            base,
            head: repository.main_head,
          });
        }
      }
      const commits = new Map<string, string>();
      let unlisted = 0;
      let atLeast = false;
      if (ranges.size > 0) {
        const source = yield* git;
        for (const range of ranges.values()) {
          const read = yield* source.range({ appId, id: range.repo }, range.base, range.head, {
            limit: 100,
          });
          for (const commit of read.items)
            commits.set(commit.sha, commit.message.split("\n")[0] ?? "");
          unlisted += Math.max(0, read.total - read.items.length);
          atLeast ||= read.truncated && read.total >= 10000;
        }
      }
      const subjects = [...commits.values()]
        .filter((subject) => subject.trim() !== "")
        .slice(0, 20);
      const count = commits.size + unlisted;
      const value: ReleaseCandidate = {
        head,
        ...(attachment === undefined ? {} : { releaseTarget: attachment }),
        ...(attachment?.target.kind !== "git"
          ? {}
          : blocker !== undefined
            ? { readiness: { allow: false as const, reason: blocker } }
            : connected.some((remote) => !remote.usable)
              ? {
                  readiness: {
                    allow: false as const,
                    reason: "A repository has no usable token. Replace the token before releasing.",
                  },
                }
              : {}),
        suggestion: nextPatch(releases),
        summary: { subjects, total: count, more: Math.max(0, count - subjects.length), atLeast },
      };
      cache.set(appId, { fingerprint, value });
      values.set(appId, value);
    }
    for (const appId of cache.keys()) if (!values.has(appId)) cache.delete(appId);
    return {
      fingerprints: new Map(
        [...values].map(([appId, value]) => [appId, json([cache.get(appId)?.fingerprint, value])]),
      ),
      forApp: (appId: string) => values.get(appId) ?? null,
    } satisfies ReleaseNavigationSource;
  });
}

/** Per-person permission and an accepted rollout gate the shared candidate at delivery. */
export function releaseNavigationOffer(
  candidate: ReleaseCandidate | null,
  input: {
    readonly permission: HqDecision;
    readonly hasProduction: boolean;
    readonly inFlight: string | null;
  },
): HqNavigationReleaseOffer | null {
  if (candidate === null) return null;
  const gate: HqDecision =
    !input.hasProduction && candidate.releaseTarget?.target.kind !== "git"
      ? { allow: false, reason: "There is no production to release to." }
      : !input.permission.allow
        ? input.permission
        : candidate.readiness?.allow === false
          ? candidate.readiness
          : input.inFlight !== null
            ? { allow: false, reason: `Releasing ${input.inFlight}…` }
            : candidate.head === null
              ? { allow: false, reason: "Nothing is merged to release." }
              : candidate.summary.total === 0
                ? { allow: false, reason: "Production already runs what is merged." }
                : { allow: true };
  const { readiness: _readiness, ...offer } = candidate;
  return { ...offer, gate, inFlight: input.inFlight };
}
