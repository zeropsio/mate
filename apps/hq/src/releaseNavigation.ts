/** Compact release candidates, shared across people; no app-detail reads or catalogs on the wire. */
import type { HqDecision } from "@t3tools/shared/hqOffers";
import type { HqGit } from "@t3tools/hq-git";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { nextPatch } from "@t3tools/shared/hqRelease";
import type { HqNavigationReleaseOffer } from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { tierRuntimes } from "./tierRuntimes.ts";

export type ReleaseCandidate = Omit<HqNavigationReleaseOffer, "gate" | "inFlight">;
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
    const repos = yield* sql<{ app_id: string; name: string; main_head: string | null }>`
      SELECT app_id::text AS app_id, name, main_head FROM hq_repo ORDER BY app_id, name`;
    const tags = yield* sql<{ app_id: string; tag: string }>`
      SELECT app_id::text AS app_id, tag FROM hq_release`;
    const running = yield* sql<{ app_id: string; service: string; sha: string }>`
      SELECT DISTINCT ON (e.app_id, j.service) e.app_id::text AS app_id, j.service, j.sha
      FROM hq_environment e JOIN hq_deploy_job j USING (project_id)
      WHERE e.tier = 'production' AND j.kind = 'deploy' AND j.state = 'live'
        AND j.service IS NOT NULL AND j.sha IS NOT NULL
      ORDER BY e.app_id, j.service, j.id DESC`;
    const values = new Map<string, ReleaseCandidate>();
    for (const appId of new Set(repos.map((row) => row.app_id))) {
      const heads = repos.filter((row) => row.app_id === appId);
      const releases = tags.filter((row) => row.app_id === appId).map((row) => row.tag);
      const production = running.filter((row) => row.app_id === appId);
      const fingerprint = json([heads, releases.toSorted(), production]);
      const kept = cache.get(appId);
      if (kept?.fingerprint === fingerprint) {
        values.set(appId, kept.value);
        continue;
      }
      const head = heads.find((row) => row.name === RECIPE_REPO)?.main_head ?? null;
      const tier = head === null ? { state: "absent" as const } : yield* recipe(appId);
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
        suggestion: nextPatch(releases),
        summary: { subjects, total: count, more: Math.max(0, count - subjects.length), atLeast },
      };
      cache.set(appId, { fingerprint, value });
      values.set(appId, value);
    }
    for (const appId of cache.keys()) if (!values.has(appId)) cache.delete(appId);
    return {
      fingerprints: new Map([...values].map(([appId, value]) => [appId, json(value)])),
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
  const gate: HqDecision = !input.hasProduction
    ? { allow: false, reason: "There is no production to release to." }
    : !input.permission.allow
      ? input.permission
      : input.inFlight !== null
        ? { allow: false, reason: `Releasing ${input.inFlight}…` }
        : candidate.head === null
          ? { allow: false, reason: "Nothing is merged to release." }
          : candidate.summary.total === 0
            ? { allow: false, reason: "Production already runs what is merged." }
            : { allow: true };
  return { ...candidate, gate, inFlight: input.inFlight };
}
