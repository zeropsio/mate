// @effect-diagnostics nodeBuiltinImport:off -- the bundle's files are read where they lie on the volume.
/**
 * The migration from main, run by the leader (T13): the bundle the import command queued
 * (`importCli.ts`, `hq_import`), brought in item by item, then verified. Migration-only: it goes
 * with T14.
 *
 * Each item — an application with its projects, Mates and environments; a repository's records;
 * the repository itself; a picture; a release — is written in one fenced transaction together with
 * its row in `hq_import_item`, so a run that dies resumes after the last item it finished and writes
 * none twice. A repository's records come before the repository: its changes are recorded, then git
 * imports it with their heads as their branches (`@t3tools/hq-git` `import`), so no change branch is
 * ever seen without its record. Every file is checked against the manifest where it is read, and a
 * finding stops the run with its item named: nothing is patched over.
 *
 * The run writes what the records say and no more: no deploy token (an admin mints each anew), no
 * event beyond `main` as the repository brought it, and the people it names are the bundle's. Its
 * last item holds every environment it brought where a service does not run what it is wanted at
 * (`Deploys.hold`): an admin's first key then deploys nothing nobody asked for.
 *
 * @module importJob
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { HqGit, Repo } from "@t3tools/hq-git";
import { attachmentPath, mergeSubject } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { ReleaseEntry, parseReleaseMessage } from "@t3tools/shared/hqRelease";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { TIER_SOURCES } from "./environments.ts";
import { appendEvent } from "./gitEvents.ts";
import { Deploys, type HeldEnvironment } from "./deploys.ts";
import { GitHost, mainOf } from "./gitHost.ts";
import {
  type Bundle,
  type BundleChange,
  bundleProblems,
  listedFile,
  pictureProblem,
  readBundle,
} from "./importBundle.ts";
import { Leader } from "./leader.ts";
import { ZeropsApi } from "./zerops/api.ts";

/** What a verified import reports beside its counts, which all held. */
export const ImportReport = Schema.Struct({
  /** Merged changes whose commit on `main` is not HQ's squash of them, by `app/repo#n`. */
  mergedOtherwise: Schema.Array(Schema.String),
  /** The Mates whose container has not enrolled with this HQ yet. */
  notEnrolled: Schema.Array(Schema.String),
  /**
   * Each environment brought, in the bundle's order: at its target (every service runs what it is
   * wanted at), held (with each service's gap), or with nothing wanted yet.
   */
  environments: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      state: Schema.Literals(["at_target", "held", "nothing_wanted"]),
      gaps: Schema.Array(
        Schema.Struct({ service: Schema.String, runs: Schema.String, wanted: Schema.String }),
      ),
    }),
  ),
});
export type ImportReport = typeof ImportReport.Type;

class ImportFailed extends Schema.TaggedError<ImportFailed>()("ImportFailed", {
  message: Schema.String,
}) {}

const failed = (message: string) => new ImportFailed({ message });

/** A failure as the run reports it: words that name no server path and no credential. */
const wordsOf = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return String(error);
  const tagged = error as {
    readonly _tag?: string;
    readonly message?: string;
    readonly operation?: string;
    readonly problems?: ReadonlyArray<string>;
  };
  if (tagged._tag === "BundleRefused") return (tagged.problems ?? []).join("; ");
  if (tagged._tag === "GitError") return `git ${tagged.operation ?? ""}: ${tagged.message ?? ""}`;
  return tagged.message ?? String(tagged._tag);
};

const encodeEntries = Schema.encodeSync(Schema.fromJsonString(Schema.Array(ReleaseEntry)));
const encodeSources = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const encodeTarget = Schema.encodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);
const encodeReport = Schema.encodeSync(Schema.fromJsonString(ImportReport));
const decodeTarget = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String));
const HeldEnvironments = Schema.Array(
  Schema.Struct({
    projectId: Schema.String,
    name: Schema.String,
    services: Schema.Array(
      Schema.Struct({
        service: Schema.String,
        sha: Schema.String,
        state: Schema.Literals(["live", "held"]),
        runs: Schema.String,
      }),
    ),
  }),
);
const encodeHeld = Schema.encodeSync(Schema.fromJsonString(HeldEnvironments));
const decodeHeld = Schema.decodeUnknownSync(Schema.fromJsonString(HeldEnvironments));

const changeKey = (change: Pick<BundleChange, "app" | "repo" | "number">) =>
  `${change.app}/${change.repo}#${String(change.number)}`;

const within = (path: string, base: string) =>
  path === base || path.startsWith(`${base}${NodePath.sep}`);

export interface ImportsOptions {
  /** Where bundles may lie: `/mnt/vol/import` in the container; none takes no import. */
  readonly importRoot: string | undefined;
  readonly hqProjectId: string;
  /** `HQ_ORG_TOKEN`: HQ's own address is its project's domain, as `official.ts` reads it. */
  readonly credential: Option.Option<Redacted.Redacted>;
  /** How often the leader looks for a queued import; 2 s. */
  readonly poll?: Duration.Duration;
}

export const importsLayer = (
  options: ImportsOptions,
): Layer.Layer<never, never, Leader | SqlClient.SqlClient | GitHost | ZeropsApi | Deploys> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const leader = yield* Leader;
      const sql = yield* SqlClient.SqlClient;
      const gitHost = yield* GitHost;
      const api = yield* ZeropsApi;
      const deploys = yield* Deploys;

      const address = Effect.gen(function* () {
        if (Option.isNone(options.credential)) return yield* failed("HQ has no credential");
        const project = yield* api.project(options.hqProjectId)(options.credential.value);
        return `https://${project.publicZone}`;
      }).pipe(Effect.mapError((error) => failed(`HQ's own address: ${wordsOf(error)}`)));

      const realpath = (path: string) =>
        Effect.tryPromise({
          try: () => NodeFSP.realpath(path),
          catch: () => failed("the bundle's directory cannot be read"),
        });

      /** The run of one queued bundle, from its first unfinished item to its verification. */
      const run = (job: { readonly digest: string; readonly dir: string }) =>
        Effect.gen(function* () {
          if (options.importRoot === undefined) return yield* failed("this HQ takes no import");
          const dir = yield* realpath(job.dir);
          if (!within(dir, yield* realpath(options.importRoot)))
            return yield* failed("the bundle is not under the import root");
          const bundle = yield* readBundle(dir);
          if (bundle.digest !== job.digest)
            return yield* failed("the bundle is not the one queued");
          const problems = bundleProblems(bundle);
          if (problems.length > 0) return yield* failed(problems.join("; "));
          const git = yield* gitHost.git;
          const hq = yield* address;
          const by = bundle.manifest.exportedBy;

          const done = new Map<string, Record<string, string>>();
          for (const row of yield* sql<{ readonly key: string; readonly target: unknown }>`
            SELECT key, target FROM hq_import_item WHERE digest = ${job.digest}`) {
            done.set(row.key, decodeTarget(row.target));
          }
          /**
           * `write` and its item's row in one fenced transaction, once — after `before`, the part
           * no transaction should be held open for; the item named in a failure.
           */
          const item = <E, R, E2 = never, R2 = never>(
            key: string,
            write: Effect.Effect<Record<string, string>, E, R>,
            before: Effect.Effect<void, E2, R2> = Effect.void as Effect.Effect<void, E2, R2>,
          ) =>
            Effect.gen(function* () {
              const kept = done.get(key);
              if (kept !== undefined) return kept;
              yield* before;
              const target = yield* leader.write(
                Effect.tap(
                  write,
                  (made) => sql`
                    INSERT INTO hq_import_item (digest, key, target)
                    VALUES (${job.digest}, ${key}, ${encodeTarget(made)}::jsonb)`,
                ),
              );
              done.set(key, target);
              return target;
            }).pipe(
              Effect.mapError((error) =>
                typeof error === "object" &&
                error !== null &&
                "_tag" in error &&
                error._tag === "NotLeader"
                  ? error
                  : failed(`${key}: ${wordsOf(error)}`),
              ),
            );
          const appIdOf = (key: string) => done.get(`app:${key}`)?.["appId"] ?? "";

          for (const app of bundle.mapping.apps) {
            yield* item(`app:${app.key}`, structure(bundle, app.key, by));
          }
          for (const app of bundle.mapping.apps) {
            const appId = appIdOf(app.key);
            for (const repo of app.repos) {
              const changes = bundle.changes.filter(
                (change) => change.app === app.key && change.repo === repo.name,
              );
              yield* item(
                `records:${app.key}/${repo.name}`,
                records(appId, repo.name, changes, by),
              );
              const at = { appId, id: repo.name };
              yield* item(
                `git:${app.key}/${repo.name}`,
                mainRecorded(git, at),
                imported(git, bundle, at, repo.bundle, changes),
              );
            }
          }
          for (const change of bundle.changes) {
            for (const attachment of change.attachments) {
              yield* item(
                `picture:${attachment.key}`,
                picture(bundle, hq, appIdOf(change.app), change, attachment),
              );
            }
          }
          for (const release of bundle.releases) {
            yield* item(
              `release:${release.app}/${release.tag}`,
              released(git, appIdOf(release.app), release),
            );
          }
          // Held before the run is done: no environment it brought deploys what nobody asked for.
          let held: ReadonlyArray<HeldEnvironment> = [];
          yield* item(
            "hold",
            Effect.sync(() => ({ held: encodeHeld(held) })),
            Effect.gen(function* () {
              if (Option.isNone(options.credential)) return yield* failed("HQ has no credential");
              held = yield* deploys.hold(
                bundle.mapping.apps.flatMap((app) => app.environments.map((env) => env.projectId)),
                options.credential.value,
              );
            }),
          );
          const kept = decodeHeld(done.get("hold")?.["held"] ?? "[]");
          return yield* verify(git, bundle, appIdOf, kept).pipe(
            Effect.mapError((error) =>
              error._tag === "ImportFailed" ? error : failed(`verification: ${wordsOf(error)}`),
            ),
          );
        });

      /** An application: its projects, its Mates with their births, its environments in order. */
      const structure = (bundle: Bundle, key: string, by: string) =>
        Effect.gen(function* () {
          const app = bundle.mapping.apps.find((candidate) => candidate.key === key)!;
          const [row] = yield* sql<{ readonly id: string }>`
            INSERT INTO hq_app (name, created_by) VALUES (${app.name}, ${by})
            RETURNING id::text AS id`;
          const appId = row!.id;
          for (const project of app.projects) {
            yield* sql`
              INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
              VALUES (${project.projectId}, ${appId}::uuid, ${project.kind}, ${by})`;
            if (project.mate !== null) {
              yield* sql`
                INSERT INTO hq_mate (project_id, name, face, standup_requested_by, closed_off_at)
                VALUES (${project.projectId}, ${project.mate.name}, ${project.mate.face},
                  ${project.mate.standupRequestedBy},
                  CASE WHEN ${project.mate.closedOff} THEN now() END)`;
            }
          }
          for (const environment of app.environments) {
            const tier = app.projects.find((project) => project.projectId === environment.projectId)
              ?.kind as keyof typeof TIER_SOURCES;
            yield* sql`
              INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
              VALUES (${environment.projectId}, ${appId}::uuid, ${tier}, ${environment.name},
                ARRAY(SELECT jsonb_array_elements_text(${encodeSources(environment.sources)}::jsonb)),
                ${by})`;
          }
          return { appId };
        });

      /** A repository's record, and its changes' with their comments: before git holds a branch of them. */
      const records = (
        appId: string,
        repo: string,
        changes: ReadonlyArray<BundleChange>,
        by: string,
      ) =>
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, ${repo}, ${by})`;
          for (const change of changes) {
            const moved = [change.openedAt, change.mergedAt, change.closedAt]
              .filter((at): at is string => at !== null)
              .sort((a, b) => Date.parse(a) - Date.parse(b))
              .at(-1);
            yield* sql`
              INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, body, state, head,
                merged_sha, landed_head, opened_at, merged_at, closed_at, updated_at)
              VALUES (${appId}::uuid, ${repo}, ${change.number}, ${change.mateProjectId},
                ${change.title}, ${change.body}, ${change.state}, ${change.head},
                ${change.mergedSha}, ${change.state === "merged" ? change.head : null},
                ${change.openedAt}, ${change.mergedAt}, ${change.closedAt}, ${moved ?? change.openedAt})`;
            for (const comment of change.comments) {
              const person = comment.author.kind === "person" ? comment.author.userId : null;
              const mate = comment.author.kind === "mate" ? comment.author.projectId : null;
              yield* sql`
                INSERT INTO hq_change_comment (app_id, repo, number, author_user_id,
                  author_mate_project_id, body, created_at)
                VALUES (${appId}::uuid, ${repo}, ${change.number}, ${person}, ${mate},
                  ${comment.body}, ${comment.at})`;
            }
          }
          return { changes: String(changes.length) };
        });

      /**
       * The repository, from its bundle, with each change's head as its branch; or, where an earlier
       * run's import landed before its item did, the repository found at the same heads. Outside any
       * transaction: a large repository takes minutes.
       */
      const imported = (
        git: HqGit,
        bundle: Bundle,
        repo: Repo,
        file: string,
        changes: ReadonlyArray<BundleChange>,
      ) =>
        Effect.gen(function* () {
          const heads = changes.map((change) => ({
            mateId: change.mateProjectId,
            number: change.number,
            ref: change.headRef,
            sha: change.head,
          }));
          const there = (yield* git.list(repo.appId)).some((found) => found.id === repo.id);
          if (there) {
            for (const head of heads) {
              if ((yield* git.changeHead(repo, head.mateId, head.number)) !== head.sha)
                return yield* failed(
                  `the repository holds another head of #${String(head.number)}`,
                );
            }
          } else {
            yield* git.import(repo, yield* listedFile(bundle, file), undefined, heads);
          }
        });

      /** The repository's `main` as it was brought: its record follows, and the log says so. */
      const mainRecorded = (git: HqGit, repo: Repo) =>
        Effect.gen(function* () {
          const main = yield* mainOf(git, repo);
          if (main === null) return yield* failed("the repository has no main");
          yield* sql`
            UPDATE hq_repo SET main_head = ${main}, updated_at = now()
            WHERE app_id::text = ${repo.appId} AND name = ${repo.id}`;
          yield* appendEvent(sql, {
            kind: "main_moved",
            appId: repo.appId,
            repo: repo.id,
            number: null,
            data: { old: null, new: main, by: "import" },
          });
          return { main };
        });

      /** A picture its change's description links: HQ's now, and the description links it at HQ. */
      const picture = (
        bundle: Bundle,
        hq: string,
        appId: string,
        change: BundleChange,
        attachment: BundleChange["attachments"][number],
      ) =>
        Effect.gen(function* () {
          const path = yield* listedFile(bundle, attachment.file);
          const bytes = yield* Effect.tryPromise({
            try: () => NodeFSP.readFile(path),
            catch: () => failed(`${attachment.file} cannot be read`),
          });
          const problem = pictureProblem(bytes);
          if (problem !== undefined) return yield* failed(`${attachment.file} ${problem}`);
          const [row] = yield* sql<{ readonly id: string }>`
            INSERT INTO hq_change_attachment (app_id, repo, number, content)
            VALUES (${appId}::uuid, ${change.repo}, ${change.number}, ${bytes})
            RETURNING id::text AS id`;
          const id = row!.id;
          const link = `${hq}${attachmentPath(appId, change.repo, change.number, id)}`;
          for (const url of attachment.urls) {
            yield* sql`
              UPDATE hq_change SET body = replace(body, ${url}, ${link})
              WHERE app_id::text = ${appId} AND repo = ${change.repo} AND number = ${change.number}`;
          }
          return { id };
        });

      /** A release as main's broker judged it, once its tag is where the repository brought it. */
      const released = (git: HqGit, appId: string, release: Bundle["releases"][number]) =>
        Effect.gen(function* () {
          const tagged = yield* git.commit({ appId, id: RECIPE_REPO }, `refs/tags/${release.tag}`);
          if (tagged.sha !== release.sha)
            return yield* failed(`the tag is at ${tagged.sha}, not ${release.sha}`);
          const parsed = parseReleaseMessage(release.message);
          const entries = "entries" in parsed ? parsed.entries : [];
          yield* sql`
            INSERT INTO hq_release (app_id, tag, sha, entries, released_by, released_at, state,
              reason, rollback_of)
            VALUES (${appId}::uuid, ${release.tag}, ${release.sha},
              ${encodeEntries(entries)}::jsonb, ${release.tagger.userId}, ${release.at},
              ${release.state}, ${release.reason}, NULL)`;
          return { tag: release.tag };
        });

      /** The bundle's counts, numbers, refs and verdicts as HQ now holds them; a difference fails. */
      const verify = (
        git: HqGit,
        bundle: Bundle,
        appIdOf: (key: string) => string,
        held: ReadonlyArray<HeldEnvironment>,
      ) =>
        Effect.gen(function* () {
          const differences: Array<string> = [];
          const appIds = bundle.mapping.apps.map((app) => appIdOf(app.key));
          const count = (table: string, where = "") =>
            Effect.map(
              sql<{ readonly n: number }>`
                SELECT count(*)::int AS n FROM ${sql(table)}
                WHERE ${sql.in("app_id", appIds)} ${sql.literal(where)}`,
              (rows) => rows[0]?.n ?? 0,
            );
          const expect = (what: string, wanted: number, found: number) => {
            if (wanted !== found)
              differences.push(`${what}: ${String(found)} of ${String(wanted)}`);
          };
          const projects = bundle.mapping.apps.flatMap((app) => app.projects);
          const changes = bundle.changes;
          const [apps] = yield* sql<{ readonly n: number }>`
            SELECT count(*)::int AS n FROM hq_app WHERE ${sql.in("id", appIds)}`;
          expect("applications", appIds.length, apps?.n ?? 0);
          expect("projects", projects.length, yield* count("hq_app_project"));
          expect(
            "environments",
            bundle.mapping.apps.flatMap((app) => app.environments).length,
            yield* count("hq_environment"),
          );
          expect(
            "repositories",
            bundle.mapping.apps.flatMap((app) => app.repos).length,
            yield* count("hq_repo"),
          );
          for (const state of ["open", "merged", "closed"] as const) {
            expect(
              `${state} changes`,
              changes.filter((change) => change.state === state).length,
              yield* count("hq_change", `AND state = '${state}'`),
            );
          }
          expect(
            "comments",
            changes.flatMap((change) => change.comments).length,
            yield* count("hq_change_comment"),
          );
          expect(
            "pictures",
            changes.flatMap((change) => change.attachments).length,
            yield* count("hq_change_attachment"),
          );
          for (const state of ["approved", "refused"] as const) {
            expect(
              `${state} releases`,
              bundle.releases.filter((release) => release.state === state).length,
              yield* count("hq_release", `AND state = '${state}'`),
            );
          }
          const mates = projects.filter((project) => project.mate !== null);
          const recorded = new Set(
            (yield* sql<{ readonly project_id: string }>`
                SELECT project_id FROM hq_mate WHERE ${sql.in(
                  "project_id",
                  mates.map((m) => m.projectId),
                )}`).map((row) => row.project_id),
          );
          expect("Mates", mates.length, recorded.size);

          const mergedOtherwise: Array<string> = [];
          for (const app of bundle.mapping.apps) {
            const appId = appIdOf(app.key);
            for (const repo of app.repos) {
              const at = { appId, id: repo.name };
              const changesHere = changes.filter(
                (change) => change.app === app.key && change.repo === repo.name,
              );
              const wanted = [
                ...repo.refs
                  .filter((ref) => ref.ref.startsWith("refs/heads/"))
                  .map((ref) => `${ref.ref} ${ref.sha}`),
                ...changesHere.map(
                  (change) =>
                    `refs/heads/mate/${change.mateProjectId}/${String(change.number)} ${change.head}`,
                ),
              ].sort();
              const found = (yield* git.branches(at)).items
                .map((branch) => `${branch.ref} ${branch.sha}`)
                .sort();
              if (wanted.join("\n") !== found.join("\n"))
                differences.push(`${app.key}/${repo.name}: its branches are not the bundle's`);
              for (const ref of repo.refs.filter((entry) => entry.ref.startsWith("refs/tags/"))) {
                if ((yield* git.commit(at, ref.ref)).sha !== ref.sha)
                  differences.push(`${app.key}/${repo.name}: ${ref.ref} is not at ${ref.sha}`);
              }
              const numbers = yield* sql<{ readonly number: number }>`
                SELECT number FROM hq_change
                WHERE app_id::text = ${appId} AND repo = ${repo.name} ORDER BY number`;
              if (
                numbers.map((row) => row.number).join(",") !==
                changesHere
                  .map((change) => change.number)
                  .sort((a, b) => a - b)
                  .join(",")
              )
                differences.push(`${app.key}/${repo.name}: its change numbers are not its PRs'`);
              for (const change of changesHere) {
                if (change.state !== "merged" || change.mergedSha === null) continue;
                if (!(yield* git.onMain(at, change.mergedSha))) {
                  differences.push(`change ${changeKey(change)}: its merge is not on main`);
                  continue;
                }
                const subject = (yield* git.commit(at, change.mergedSha)).message.split("\n")[0];
                if (subject !== mergeSubject(change.title, change.number))
                  mergedOtherwise.push(changeKey(change));
              }
            }
          }
          for (const release of bundle.releases) {
            const at = { appId: appIdOf(release.app), id: RECIPE_REPO };
            if ((yield* git.commit(at, `refs/tags/${release.tag}`)).sha !== release.sha)
              differences.push(
                `release ${release.app} ${release.tag}: its tag is not at its commit`,
              );
          }
          if (differences.length > 0)
            return yield* failed(`verification: ${differences.join("; ")}`);
          const enrolled = new Set(
            (yield* sql<{ readonly project_id: string }>`
                SELECT DISTINCT project_id FROM hq_mate_credential WHERE revoked_at IS NULL`).map(
              (row) => row.project_id,
            ),
          );
          return {
            mergedOtherwise,
            notEnrolled: mates
              .map((mate) => mate.projectId)
              .filter((projectId) => !enrolled.has(projectId)),
            environments: bundle.mapping.apps.flatMap((app) =>
              app.environments.map((env) => {
                const found = held.find((entry) => entry.projectId === env.projectId);
                const gaps = (found?.services ?? [])
                  .filter((service) => service.state === "held")
                  .map((service) => ({
                    service: service.service,
                    runs: service.runs,
                    wanted: service.sha.slice(0, 7),
                  }));
                return {
                  name: env.name,
                  state:
                    found === undefined || found.services.length === 0
                      ? ("nothing_wanted" as const)
                      : gaps.length > 0
                        ? ("held" as const)
                        : ("at_target" as const),
                  gaps,
                };
              }),
            ),
          } satisfies ImportReport;
        });

      const pass = Effect.gen(function* () {
        const [job] = yield* sql<{ readonly digest: string; readonly dir: string }>`
          SELECT digest, dir FROM hq_import WHERE state IN ('queued', 'running')`;
        if (job === undefined) return;
        yield* leader.write(sql`
          UPDATE hq_import SET state = 'running', updated_at = now()
          WHERE digest = ${job.digest}`);
        yield* run(job).pipe(
          Effect.matchEffect({
            onSuccess: (report) =>
              leader.write(sql`
                UPDATE hq_import
                SET state = 'done', error = NULL, report = ${encodeReport(report)}::jsonb,
                  updated_at = now()
                WHERE digest = ${job.digest}`),
            onFailure: (error) =>
              error._tag === "NotLeader"
                ? Effect.void
                : leader.write(sql`
                    UPDATE hq_import
                    SET state = 'failed', error = ${wordsOf(error)}, updated_at = now()
                    WHERE digest = ${job.digest}`),
          }),
        );
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("import pass failed", cause)));

      const poll = options.poll ?? Duration.seconds(2);
      yield* Effect.forkScoped(
        leader.changes.pipe(
          Stream.switchMap((status) =>
            status.state === "active"
              ? Stream.tick(poll).pipe(Stream.mapEffect(() => pass))
              : Stream.empty,
          ),
          Stream.runDrain,
        ),
      );
    }),
  );
