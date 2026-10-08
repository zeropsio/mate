// @effect-diagnostics nodeBuiltinImport:off -- scope incarnations are unique to this Core process.
import * as NodeCrypto from "node:crypto";
import {
  HQ_ZEROPS_REFUSED,
  HqNavigationApp,
  HqNavigationProject,
  HqAttentionValue,
  hqScopeKey,
  type HqScope,
  type HqScopeFailure,
  type HqStreamMessage,
  type HqStreamRequest,
  type HqSubscription,
  type HqValue,
  type HqRemoval,
} from "@t3tools/shared/hqStream";
import { asOrgRole, roleAtLeast } from "@t3tools/shared/zeropsRoles";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type { SqlError } from "effect/sql/SqlError";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { HqUsageReader, USAGE_REPORT_LIMITS } from "./usageReport.ts";
import { usageOwner } from "./usageAccess.ts";
import { ZeropsRefused, type ZeropsError } from "./zerops/api.ts";
import { AutoUpdatePolicy } from "./autoUpdate.ts";
import { Changes } from "./changes.ts";
import type { ChangeNavigationSource } from "./changeNavigation.ts";
import { pruneIdleScopes } from "./scopeRetention.ts";
import { Deploys } from "./deploys.ts";
import type { EnvironmentSource } from "./environmentNavigation.ts";
import { healthParts } from "./health.ts";
import { Leader } from "./leader.ts";
import { MateOverviews, type MateOverviewEntry } from "./mateOverviews.ts";
import { Official } from "./official.ts";
import { navigationRemoval } from "./navigationRemoval.ts";
import { Recomputes } from "./recomputes.ts";
import { releaseNavigationOffer, type ReleaseNavigationSource } from "./releaseNavigation.ts";
import { Releases } from "./releases.ts";
import { Roles, type OrgView } from "./roles.ts";
import { makeSourceFence } from "./sourceFence.ts";
import { makeScopeJournal } from "./scopeJournal.ts";
import { Structure, type StructureSource, type StructureRead } from "./structure.ts";

const isZeropsRefused = Schema.is(ZeropsRefused);

export type ScopeOutput =
  | Exclude<HqStreamMessage, { readonly type: "ping" }>
  | { readonly type: "end"; readonly ending: "refused" };
interface ScopeConnection {
  readonly messages: Stream.Stream<ScopeOutput>;
  readonly request: (request: HqStreamRequest) => Effect.Effect<void>;
}
export class HqScopes extends Context.Service<
  HqScopes,
  {
    readonly open: (
      userId: string,
      sessionId?: string,
    ) => Effect.Effect<ScopeConnection, never, Scope.Scope>;
  }
>()("@t3tools/hq/hqScopes") {}

/** Core binds Deploys' durable operations; isolated scope tests may substitute a reader. */
export const HqOperationReader = Context.Reference<{
  readonly read?: (
    userId: string,
    appId: string,
  ) => Effect.Effect<ReadonlyArray<HqValue>, SqlError | ZeropsError>;
}>("@t3tools/hq/operationScope", { defaultValue: () => ({}) });

class ScopeReadRefused extends Schema.TaggedError<ScopeReadRefused>()("ScopeReadRefused", {
  code: Schema.String,
  reason: Schema.NullOr(Schema.String),
}) {}

const validKey = (scope: HqScope, key: string) => {
  switch (scope.kind) {
    case "agentUsage":
      return key === "report";
    case "navigation":
      return (
        key === "org" ||
        key === "status" ||
        key === "auto-update-policy" ||
        /^(?:app|project|person|press):[^:]{1,128}$/u.test(key)
      );
    case "app-detail":
      return [
        "releases",
        "repos",
        "recipe:mate",
        "recipe:stage",
        "recipe:production",
        "changes",
      ].includes(key);
    case "attention":
      return key === scope.projectId;
    case "change":
    case "discussion":
      return key === `${scope.repo}:${scope.number}`;
    case "operation":
      return key.startsWith(`${scope.appId}:`);
  }
};

const failureMetadata = Schema.decodeUnknownOption(
  Schema.Struct({
    code: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);
const metadata = (error: unknown) =>
  isZeropsRefused(error)
    ? { code: HQ_ZEROPS_REFUSED.code, reason: error.reason }
    : Option.getOrElse(
        failureMetadata(error),
        (): { code?: string; reason?: string | null } => ({}),
      );
const refusalProvesRemoval = (code: string) =>
  code === "forbidden" || code === "usage_page_invalidated" || code.endsWith("_not_found");
const refusalDisposition = (code: string) =>
  code === HQ_ZEROPS_REFUSED.code ||
  code === "unsupported" ||
  code.startsWith("usage_") ||
  code === "unresolved_owner_scope" ||
  refusalProvesRemoval(code)
    ? ("refused" as const)
    : ("transient" as const);
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const readUsageAccess = Schema.decodeUnknownOption(
  Schema.Struct({ generation: Schema.Struct({ access: Schema.String }) }),
);
const readAttentionSource = Schema.decodeUnknownOption(
  Schema.Struct({ attention: Schema.NullOr(HqAttentionValue) }),
);

export const hqScopesLayer = (build?: string, recheck = Duration.seconds(30)) =>
  Layer.effect(
    HqScopes,
    Effect.gen(function* () {
      const hubScope = yield* Effect.scope;
      const structure = yield* Structure;
      const changes = yield* Changes;
      const releases = yield* Releases;
      const deploys = yield* Deploys;
      const overviews = yield* MateOverviews;
      const roles = yield* Roles;
      const autoUpdate = yield* AutoUpdatePolicy;
      const official = yield* Official;
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const recomputes = yield* Recomputes;
      const operations = yield* HqOperationReader;
      const usageReader = yield* HqUsageReader;
      const readHealth = healthParts.pipe(
        Effect.provideContext(yield* Effect.context<Effect.Services<typeof healthParts>>()),
      );
      const sourceOne = yield* Semaphore.make(1);
      const changeOne = yield* Semaphore.make(1);
      const incarnation = NodeCrypto.randomUUID();
      type Journal = ReturnType<typeof makeScopeJournal>;
      type Entry = {
        userId: string;
        sessions: Set<string>;
        lastUsed: number;
        scope: HqScope;
        journal: Journal;
        dirty: boolean;
        one: Semaphore.Semaphore;
        generation: number;
        sourceVersion: number;
        attentionSource?: string;
        usageAccess?: string;
        usageOwners?: ReadonlyMap<string, string | null | undefined>;
        refreshing: boolean;
        subscribing: number;
        failure?: Extract<HqStreamMessage, { type: "scope-error" }>;
      };
      const journals = new Map<string, Entry>();
      let usage = 0;
      type Connection = {
        userId: string;
        queue: Queue.Queue<ScopeOutput>;
        scopes: Set<string>;
        wanted: Map<string, number>;
        failures: Map<string, string>;
        ended: boolean;
      };
      const connections = new Set<Connection>();
      const decodeApp = Schema.decodeUnknownOption(HqNavigationApp);
      const decodeProject = Schema.decodeUnknownOption(HqNavigationProject);
      const contents = new Map<
        string,
        { one: Semaphore.Semaphore; value?: ReadonlyArray<HqValue> }
      >();
      let overviewCache: ReadonlyMap<string, MateOverviewEntry> | undefined;
      const overviewsNow = Effect.gen(function* () {
        if (overviewCache === undefined) overviewCache = yield* overviews.all;
        return overviewCache;
      });
      const seen = new Map<
        string,
        { userId: string; projectId: string; epoch: number; ids: Set<string> }
      >();
      let source: StructureSource | undefined;
      let environmentSource: EnvironmentSource | undefined;
      let changeSource: ChangeNavigationSource | undefined;
      let releaseSource: ReleaseNavigationSource | undefined;
      const releaseFence = makeSourceFence();
      const releaseOne = yield* Semaphore.make(1);
      let publishedChanges: ChangeNavigationSource | undefined;
      let changeVersion = 0;
      const changeFence = makeSourceFence();
      const changeSourceNow = changeOne.withPermits(1)(
        Effect.gen(function* () {
          while (changeSource === undefined || changeFence.dirty()) {
            const started = changeFence.capture();
            const fresh = yield* changes.navigation;
            if (!changeFence.accept(started)) continue;
            changeSource = fresh;
            publishedChanges ??= fresh;
            changeVersion += 1;
          }
          return changeSource;
        }),
      );
      const sourceFence = makeSourceFence();
      let sourceVersion = 0;
      const personViews = new Map<string, StructureRead>();
      let rolesFingerprint: string | undefined;
      const fingerprint = (
        facts: Pick<OrgView, "orgId" | "members" | "projects"> & { readonly freshness?: string },
      ) => {
        const { freshness: _freshness, ...view } = facts;
        return json(view);
      };
      const sourceNow = sourceOne.withPermits(1)(
        Effect.gen(function* () {
          const facts = yield* roles.view;
          if (fingerprint(facts) !== rolesFingerprint) sourceFence.invalidate();
          while (source === undefined || sourceFence.dirty()) {
            const started = sourceFence.capture();
            yield* recomputes.count;
            source = yield* structure.navigation;
            environmentSource = source.environmentSource;
            sourceFence.accept(started);
            sourceVersion += 1;
            personViews.clear();
            rolesFingerprint = fingerprint(source.facts);
          }
          return source;
        }),
      );
      const viewFor = (current: StructureSource, userId: string) => {
        let view = personViews.get(userId);
        if (view === undefined) {
          view = current.forPerson(userId);
          personViews.set(userId, view);
        }
        return view;
      };
      const navigationApp = (
        current: StructureSource,
        userId: string,
        app: StructureRead["apps"][number],
      ) => {
        const { projects, ...navigation } = app;
        return decodeApp({
          ...navigation,
          releaseOffer: app.can.read_change.allow
            ? releaseNavigationOffer(releaseSource?.forApp(app.id) ?? null, {
                permission: app.can.release,
                hasProduction: projects.some((project) => project.kind === "production"),
                inFlight: (() => {
                  const environments = (environmentSource ?? current.environmentSource).forApp(
                    userId,
                    app.id,
                    current.facts,
                    app.can.read_change,
                  );
                  if (!Array.isArray(environments)) return null;
                  return (
                    environments.find(
                      (environment) =>
                        environment.tier === "production" && environment.release?.ended === false,
                    )?.release?.tag ?? null
                  );
                })(),
              })
            : { refused: app.can.read_change.reason },
          changes: app.can.read_change.allow
            ? (changeSource?.forApp(app.id) ?? [])
            : { refused: app.can.read_change.reason },
          environments: (environmentSource ?? current.environmentSource).forApp(
            userId,
            app.id,
            current.facts,
            app.can.read_change,
          ),
          projectIds: projects.map((project) => project.projectId),
        });
      };
      const permitted = (scope: HqScope, current: StructureSource, userId: string) => {
        const view = viewFor(current, userId);
        return scope.kind === "navigation" || scope.kind === "agentUsage"
          ? true
          : scope.kind === "attention"
            ? observedProjects(view).some((project) => project.projectId === scope.projectId)
            : view.apps.some((app) => app.id === scope.appId && app.can.read_change.allow);
      };
      const offer = (connection: Connection, messages: ReadonlyArray<ScopeOutput>) => {
        Queue.offerAllUnsafe(connection.queue, messages);
        for (const message of messages) {
          if (!("scope" in message)) continue;
          const key = hqScopeKey(message.scope);
          if (message.type === "scope-error") connection.failures.set(key, message.code);
          else connection.failures.delete(key);
        }
        if (
          !connection.ended &&
          connection.wanted.size > 0 &&
          [...connection.wanted.keys()].every(
            (key) => connection.failures.get(key) === HQ_ZEROPS_REFUSED.code,
          )
        ) {
          connection.ended = true;
          Queue.offerUnsafe(connection.queue, { type: "end", ending: "refused" });
        }
      };
      const send = (entry: Entry, messages: ReadonlyArray<ScopeOutput>) =>
        Effect.sync(() => {
          entry.lastUsed = ++usage;
          for (const connection of connections) {
            if (
              connection.userId === entry.userId &&
              connection.scopes.has(hqScopeKey(entry.scope))
            )
              offer(connection, messages);
          }
        });
      const observedProjects = (view: ReturnType<StructureSource["forPerson"]>) =>
        [...view.ungrouped, ...view.apps.flatMap((app) => app.projects)].filter(
          (project) => project.can?.observe_mate?.allow === true,
        );
      // One read for the visible projects this delivery needs, never the person's whole history.
      const loadSeenFor = (userId: string, projectIds: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          for (;;) {
            const epoch = yield* overviews.seenEpoch;
            const keys = new Map(
              projectIds.map((projectId) => [projectId, json([userId, projectId])]),
            );
            const missing = [...keys]
              .filter(([, key]) => seen.get(key)?.epoch !== epoch)
              .map(([projectId]) => projectId);
            const rows =
              missing.length === 0
                ? []
                : yield* sql<{
                    readonly project_id: string;
                    readonly result_id: string;
                  }>`SELECT project_id, result_id FROM hq_attention_seen
               WHERE user_id = ${userId} AND ${sql.in("project_id", missing)}`;
            if (epoch !== (yield* overviews.seenEpoch)) continue;
            const result = new Map<string, Set<string>>();
            for (const [projectId, key] of keys) {
              const prior = seen.get(key);
              // Another socket may have acknowledged a result while the SELECT was in flight.
              const ids = prior?.epoch === epoch ? prior.ids : new Set<string>();
              seen.set(key, { userId, projectId, epoch, ids });
              result.set(projectId, ids);
            }
            for (const row of rows) result.get(row.project_id)?.add(row.result_id);
            return result;
          }
        });
      const loadSeen = (userId: string, projectId: string) =>
        Effect.map(loadSeenFor(userId, [projectId]), (result) => result.get(projectId)!);
      const statusValue = Effect.gen(function* () {
        const parts = yield* readHealth;
        return {
          key: "status",
          value: {
            official: (yield* official.checked) ? (yield* official.status).official : null,
            parts: { db: "up", ...parts },
          },
        };
      });
      const usageOwnerFor = (
        current: StructureSource,
        all: ReadonlyMap<string, MateOverviewEntry>,
        userId: string,
        projectId: string,
      ) => {
        const view = viewFor(current, userId);
        if (!observedProjects(view).some((project) => project.projectId === projectId))
          return undefined;
        const mate = [...view.ungrouped, ...view.apps.flatMap((app) => app.projects)].find(
          (project) => project.projectId === projectId,
        )?.mate;
        const overview = all.get(projectId)?.overview;
        const everSignedIn = {
          ...mate?.signers,
          ...Object.fromEntries(
            Object.entries(overview?.logins ?? {}).flatMap(([login, digest]) => {
              const user = digest.lastSignedInBy ?? digest.signedInBy;
              return user === null ? [] : [[login, user]];
            }),
          ),
        };
        return usageOwner({
          facts: current.facts,
          projectId,
          everSignedIn,
          runsWithoutSignIn: overview?.identity.runsWithoutSignIn === true,
          madeBy: mate?.madeBy ?? null,
          standupRequestedBy: mate?.standupRequestedBy ?? null,
        });
      };
      const policyFor = (userId: string) =>
        autoUpdate.read(userId).pipe(
          Effect.map((policy) => ({
            values: [{ key: "auto-update-policy", value: policy }] as HqValue[],
            removals: [] as HqRemoval[],
          })),
          Effect.catchTag("StructureRefused", () =>
            Effect.succeed({
              values: [] as HqValue[],
              removals: [{ key: "auto-update-policy", reason: "no-access" }] as HqRemoval[],
            }),
          ),
        );
      const load = (entry: Entry, current: StructureSource, projects?: ReadonlySet<string>) =>
        Effect.gen(function* () {
          const view = viewFor(current, entry.userId);
          const scope = entry.scope;
          const all = yield* overviewsNow;
          if (scope.kind === "agentUsage") {
            if (usageReader.read === undefined)
              return yield* new ScopeReadRefused({
                code: "unsupported",
                reason: "usage_reader_not_installed",
              });
            const report = yield* usageReader.read(entry.userId, scope, current, all);
            entry.usageOwners = new Map(
              observedProjects(view).map((project) => [
                project.projectId,
                usageOwnerFor(current, all, entry.userId, project.projectId),
              ]),
            );
            return { values: [{ key: "report", value: report }], removals: [] as HqRemoval[] };
          }
          const observable = observedProjects(view);
          // Permission comes first: unknown ids must not reveal source membership.
          if (!permitted(scope, current, entry.userId))
            return yield* new ScopeReadRefused({ code: "forbidden", reason: "no-access" });
          const exists =
            scope.kind === "navigation" ||
            (scope.kind === "attention"
              ? current.projectIds.has(scope.projectId)
              : current.appIds.has(scope.appId));
          if (!exists)
            return yield* new ScopeReadRefused({ code: "scope_not_found", reason: "deleted" });
          const values: HqValue[] = [];
          const policyRemovals: HqRemoval[] = [];
          if (scope.kind === "navigation") {
            const member = current.facts.members.find(
              (member) => member.kind === "person" && member.userId === entry.userId,
            );
            const acknowledgements = yield* loadSeenFor(
              entry.userId,
              observable
                .filter(
                  (project) =>
                    (projects === undefined || projects.has(project.projectId)) &&
                    (all.get(project.projectId)?.attention?.results.length ?? 0) > 0,
                )
                .map((project) => project.projectId),
            );
            const listed = [...view.ungrouped, ...view.apps.flatMap((app) => app.projects)];
            const signersFor = (projectId: string) => {
              const signedInNow: Record<string, string> = {};
              const everSignedIn: Record<string, string> = {};
              if (!observable.some((project) => project.projectId === projectId))
                return { signedInNow, everSignedIn };
              const logins = all.get(projectId)?.overview?.logins;
              const saved = listed.find((project) => project.projectId === projectId)?.mate
                ?.signers;
              const isPerson = (id: string | null | undefined): id is string =>
                typeof id === "string" &&
                id.length > 0 &&
                !current.facts.members.some(
                  (member) => member.kind === "token" && member.userId === id,
                );
              for (const key of new Set([
                ...Object.keys(logins ?? {}),
                ...Object.keys(saved ?? {}),
              ])) {
                const login = logins?.[key];
                if (login?.present && !login.token && isPerson(login.signedInBy))
                  signedInNow[key] = login.signedInBy;
                const previous =
                  (login?.token ? undefined : login?.signedInBy) ??
                  login?.lastSignedInBy ??
                  saved?.[key];
                if (isPerson(previous)) everSignedIn[key] = previous;
              }
              return { signedInNow, everSignedIn };
            };
            const person = (projectId: string) => {
              const project = current.facts.projects.find((project) => project.id === projectId);
              const role = asOrgRole(
                project?.userRoles.find((role) => role.clientUserId === member?.clientUserId)
                  ?.roleCode ??
                  member?.roleCode ??
                  "NO_ACCESS",
              );
              const attention = observable.some((project) => project.projectId === projectId)
                ? all.get(projectId)?.attention
                : null;
              const { signedInNow, everSignedIn } = signersFor(projectId);
              const runsWithoutSignIn =
                observable.some((project) => project.projectId === projectId) &&
                all.get(projectId)?.overview?.identity.runsWithoutSignIn === true;
              const mate = listed.find((project) => project.projectId === projectId)?.mate;
              const ownerUserId = usageOwner({
                facts: current.facts,
                projectId,
                everSignedIn,
                runsWithoutSignIn,
                madeBy: mate?.madeBy ?? null,
                standupRequestedBy: mate?.standupRequestedBy ?? null,
              });
              const waitsOn =
                signedInNow["claude-code"] ??
                signedInNow.codex ??
                (runsWithoutSignIn ? ownerUserId : null);
              return {
                role,
                ownerUserId,
                waitsOnViewer: waitsOn === entry.userId,
                mayWrite: observable.some((project) => project.projectId === projectId),
                mine: ownerUserId === entry.userId,
                unseen:
                  attention == null
                    ? null
                    : attention.results
                        .map((result) => result.turnId)
                        .filter((id) => !acknowledgements.get(projectId)?.has(id)).length,
              };
            };
            if (projects === undefined) {
              values.push({
                key: "org",
                value: { can: view.can, unheld: view.unheld, tools: view.tools ?? [], build },
              });
              values.push(yield* statusValue);
              const policy = yield* policyFor(entry.userId);
              values.push(...policy.values);
              policyRemovals.push(...policy.removals);
              for (const record of view.lifecycle ?? [])
                values.push({ key: `lifecycle:${record.requestId}`, value: record });
            }
            for (const app of view.apps) {
              if (projects === undefined) {
                const read = navigationApp(current, entry.userId, app);
                if (Option.isSome(read)) values.push({ key: `app:${app.id}`, value: read.value });
              }
              for (const project of app.projects) {
                if (projects !== undefined && !projects.has(project.projectId)) continue;
                const read = decodeProject({
                  ...project,
                  appId: app.id,
                  person: person(project.projectId),
                  ...signersFor(project.projectId),
                });
                if (Option.isSome(read))
                  values.push({ key: `project:${project.projectId}`, value: read.value });
              }
            }
            for (const project of view.ungrouped) {
              if (projects !== undefined && !projects.has(project.projectId)) continue;
              const read = decodeProject({
                ...project,
                kind: "mate",
                appId: null,
                person: person(project.projectId),
                ...signersFor(project.projectId),
              });
              if (Option.isSome(read))
                values.push({ key: `project:${project.projectId}`, value: read.value });
            }
            if (projects === undefined)
              for (const [projectId, press] of Object.entries(view.presses)) {
                values.push({ key: `press:${projectId}`, value: press });
              }
            const relevant = listed.filter(
              (project) => projects === undefined || projects.has(project.projectId),
            );
            const named = new Set([
              ...relevant.flatMap((project) => [
                project.mate?.madeBy,
                project.mate?.standupRequestedBy,
                ...Object.values(signersFor(project.projectId).everSignedIn),
              ]),
              ...observable
                .filter((project) =>
                  relevant.some((listed) => listed.projectId === project.projectId),
                )
                .flatMap((project) =>
                  Object.values(all.get(project.projectId)?.overview?.logins ?? {}).flatMap(
                    (login) => [login.signedInBy, login.lastSignedInBy],
                  ),
                ),
              ...current.facts.projects
                .filter((project) => relevant.some((listed) => listed.projectId === project.id))
                .flatMap((project) =>
                  project.userRoles
                    .filter((role) => role.roleCode === "OWNER")
                    .flatMap((role) =>
                      current.facts.members
                        .filter((member) => member.clientUserId === role.clientUserId)
                        .map((member) => member.userId),
                    ),
                ),
            ]);
            for (const member of current.facts.members)
              if (member.kind === "person" && named.has(member.userId))
                values.push({
                  key: `person:${member.userId}`,
                  value: {
                    name: member.name,
                    clientUserId: member.clientUserId,
                    avatarUrl: member.avatarUrl ?? null,
                  },
                });
          } else if (scope.kind === "attention") {
            const mate = all.get(scope.projectId);
            if (mate !== undefined) values.push({ key: scope.projectId, value: mate });
            // No report is not a deletion.
            return { values, removals: [] as HqRemoval[] };
          } else if (scope.kind === "operation") {
            if (operations.read === undefined)
              return yield* new ScopeReadRefused({
                code: "unsupported",
                reason: "operation_reader_not_installed",
              });
            values.push(...(yield* operations.read(entry.userId, scope.appId)));
            return { values, removals: [] as HqRemoval[] };
          } else {
            const key = hqScopeKey(scope);
            let slot = contents.get(key);
            if (slot === undefined) {
              slot = { one: Semaphore.makeUnsafe(1) };
              contents.set(key, slot);
            }
            const kept = slot;
            const cached = yield* kept.one.withPermits(1)(
              Effect.gen(function* () {
                if (kept.value !== undefined) return kept.value;
                let data: ReadonlyArray<HqValue>;
                if (scope.kind === "app-detail") {
                  const mate = yield* changes.readRecipe(entry.userId, scope.appId, "mate").pipe(
                    Effect.map((value): ReadonlyArray<HqValue> => [{ key: "recipe:mate", value }]),
                    Effect.catchTags({
                      ChangeRefused: () => Effect.succeed([]),
                      GitError: () => Effect.succeed([]),
                    }),
                  );
                  data = [
                    { key: "releases", value: yield* releases.list(entry.userId, scope.appId) },
                    { key: "repos", value: yield* changes.listRepos(entry.userId, scope.appId) },
                    ...mate,
                    {
                      key: "recipe:stage",
                      value: yield* changes.readRecipe(entry.userId, scope.appId, "stage"),
                    },
                    {
                      key: "recipe:production",
                      value: yield* changes.readRecipe(entry.userId, scope.appId, "production"),
                    },
                    {
                      key: "changes",
                      value: yield* changes.listChanges(entry.userId, scope.appId),
                    },
                  ];
                } else if (scope.kind === "change")
                  data = [
                    {
                      key: `${scope.repo}:${scope.number}`,
                      value: yield* changes.changeDetail(
                        entry.userId,
                        scope.appId,
                        scope.repo,
                        scope.number,
                      ),
                    },
                  ];
                else
                  data = [
                    {
                      key: `${scope.repo}:${scope.number}`,
                      value: {
                        comments: yield* changes.listComments(
                          entry.userId,
                          scope.appId,
                          scope.repo,
                          scope.number,
                        ),
                      },
                    },
                  ];
                kept.value = data;
                return data;
              }),
            );
            values.push(...cached);
          }
          if (projects !== undefined) return { values, removals: [] as HqRemoval[] };
          const present = new Set(values.map((value) => value.key));
          const removals = entry.journal
            .keys()
            .filter((key) => !present.has(key))
            .flatMap((key) => {
              const removal = navigationRemoval(
                { ...current, forPerson: (user) => viewFor(current, user) },
                entry.userId,
                key,
                new Set(entry.journal.keys()),
              );
              return removal === undefined ? [] : [removal];
            });
          return { values, removals: [...removals, ...policyRemovals] };
        });
      const refreshUnlocked = (entry: Entry) =>
        Effect.gen(function* () {
          while (true) {
            if (entry.failure?.disposition === "refused") return;
            const current = yield* sourceNow;
            if (entry.sourceVersion !== sourceVersion) entry.dirty = true;
            if (!entry.dirty) return;
            const generation = entry.generation;
            const version = sourceVersion;
            if (entry.scope.kind === "navigation") yield* changeSourceNow;
            const menuVersion = changeVersion;
            // Reuse the validated source; the check after the read still fences revocations.
            const data = yield* load(entry, current);
            yield* sourceNow;
            if (current !== source || generation !== entry.generation || version !== sourceVersion)
              continue;
            if (
              entry.scope.kind === "navigation" &&
              (changeFence.dirty() || menuVersion !== changeVersion)
            )
              continue;
            let baseline = false;
            if (entry.scope.kind === "agentUsage") {
              const value = readUsageAccess(data.values[0]?.value);
              if (Option.isSome(value)) {
                baseline = entry.usageAccess !== value.value.generation.access;
                entry.usageAccess = value.value.generation.access;
              }
            }
            if (entry.scope.kind === "attention") {
              const read = readAttentionSource(data.values[0]?.value);
              if (Option.isSome(read) && read.value.attention !== null) {
                const next = json([
                  read.value.attention.source.environmentId,
                  read.value.attention.source.epoch,
                  read.value.attention.source.incarnation,
                ]);
                baseline = next !== entry.attentionSource;
                entry.attentionSource = next;
              }
            }
            const message = entry.journal.commit(data.values, data.removals, baseline);
            entry.sourceVersion = version;
            entry.dirty = generation !== entry.generation;
            delete entry.failure;
            if (message !== undefined) yield* send(entry, [message]);
            if (
              entry.scope.kind === "navigation" &&
              (releaseSource === undefined || releaseFence.dirty())
            )
              yield* Effect.forkIn(refreshReleases, hubScope);
            return;
          }
        }).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const facts = metadata(error);
              const code = facts.code ?? "unavailable";
              if (refusalProvesRemoval(code)) {
                const message = entry.journal.commit(
                  [],
                  entry.journal.keys().map((key) => ({
                    key,
                    reason:
                      code === "forbidden" || code === "usage_page_invalidated"
                        ? "no-access"
                        : "deleted",
                  })),
                  entry.scope.kind === "agentUsage",
                );
                if (message !== undefined) yield* send(entry, [message]);
              }
              entry.failure = {
                type: "scope-error",
                scope: entry.scope,
                code,
                reason: facts.reason ?? null,
                disposition: refusalDisposition(code),
              };
              yield* send(entry, [entry.failure]);
            }),
          ),
        );
      const refresh = (entry: Entry) => entry.one.withPermits(1)(refreshUnlocked(entry));
      const scheduleRefresh = (entry: Entry) =>
        Effect.gen(function* () {
          if (entry.refreshing) return;
          entry.refreshing = true;
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              do {
                yield* refresh(entry);
              } while (entry.dirty && entry.failure === undefined);
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  entry.refreshing = false;
                }),
              ),
            ),
          );
        });
      const demanded = (entry: Entry) =>
        [...connections].some(
          (connection) =>
            connection.userId === entry.userId && connection.scopes.has(hqScopeKey(entry.scope)),
        );
      const prune = () => {
        pruneIdleScopes(
          journals,
          (entry) => !entry.refreshing && entry.subscribing === 0 && !demanded(entry),
          512,
        );
        const users = new Set([...journals.values()].map((entry) => entry.userId));
        for (const user of personViews.keys()) if (!users.has(user)) personViews.delete(user);
        for (const [key, record] of seen) if (!users.has(record.userId)) seen.delete(key);
        while (contents.size > 256) contents.delete(contents.keys().next().value!);
      };
      const invalidate = (kind: "structure" | "detail" | "roles") =>
        Effect.gen(function* () {
          if (kind === "structure" || kind === "roles") sourceFence.invalidate();
          if (kind === "structure") {
            changeFence.invalidate();
            releaseFence.invalidate();
          }
          if (kind === "detail" || kind === "structure") contents.clear();
          for (const entry of journals.values()) {
            const affected =
              kind === "roles" ||
              kind === "structure" ||
              (entry.scope.kind !== "attention" &&
                entry.scope.kind !== "navigation" &&
                entry.scope.kind !== "agentUsage");
            if (affected) {
              delete entry.failure;
              entry.dirty = true;
              entry.generation += 1;
              if (demanded(entry)) yield* scheduleRefresh(entry);
            }
          }
        });
      const refreshAttention = (projectId: string, forgotten = false) =>
        Effect.gen(function* () {
          overviewCache = undefined;
          if (forgotten)
            for (const [key, record] of seen) if (record.projectId === projectId) seen.delete(key);
          const all = yield* overviewsNow;
          for (const entry of journals.values()) {
            if (
              entry.scope.kind === "agentUsage" &&
              source !== undefined &&
              entry.failure === undefined &&
              entry.usageOwners?.has(projectId) === true &&
              usageOwnerFor(source, all, entry.userId, projectId) !==
                entry.usageOwners.get(projectId)
            ) {
              entry.dirty = true;
              entry.generation += 1;
              if (demanded(entry)) yield* scheduleRefresh(entry);
            }
            if (entry.scope.kind === "attention" && entry.scope.projectId === projectId) {
              if (entry.failure?.code.endsWith("_not_found")) delete entry.failure;
              entry.dirty = true;
              entry.generation += 1;
              if (demanded(entry)) yield* scheduleRefresh(entry);
            } else if (
              entry.scope.kind === "navigation" &&
              entry.failure === undefined &&
              source !== undefined &&
              observedProjects(viewFor(source, entry.userId)).some(
                (project) => project.projectId === projectId,
              )
            ) {
              if (!demanded(entry)) {
                entry.dirty = true;
                entry.generation += 1;
                continue;
              }
              yield* entry.one.withPermits(1)(
                Effect.gen(function* () {
                  if (sourceFence.dirty() || entry.sourceVersion !== sourceVersion)
                    return yield* scheduleRefresh(entry);
                  const generation = entry.generation;
                  const data = yield* load(entry, source!, new Set([projectId]));
                  if (generation !== entry.generation || sourceFence.dirty()) return;
                  const message = entry.journal.commit(data.values);
                  if (message !== undefined) yield* send(entry, [message]);
                }),
              );
            }
          }
        });
      const refreshAppValues = Effect.fnUntraced(function* (
        changed: ReadonlySet<string>,
        version: number,
        menuVersion?: number,
      ) {
        if (source === undefined) return;
        for (const entry of journals.values()) {
          if (entry.scope.kind !== "navigation" || entry.failure !== undefined) continue;
          const apps = viewFor(source, entry.userId).apps.filter(
            (app) => changed.has(app.id) && app.can.read_change.allow,
          );
          if (apps.length === 0) continue;
          if (!demanded(entry)) {
            entry.dirty = true;
            entry.generation += 1;
            continue;
          }
          yield* entry.one.withPermits(1)(
            Effect.gen(function* () {
              if (
                version !== sourceVersion ||
                sourceFence.dirty() ||
                entry.sourceVersion !== sourceVersion ||
                entry.dirty ||
                (menuVersion !== undefined &&
                  (changeFence.dirty() || menuVersion !== changeVersion))
              ) {
                entry.dirty = true;
                entry.generation += 1;
                return yield* scheduleRefresh(entry);
              }
              const values = apps.flatMap((app) => {
                const read = navigationApp(source!, entry.userId, app);
                return Option.isSome(read) ? [{ key: `app:${app.id}`, value: read.value }] : [];
              });
              const message = entry.journal.commit(values);
              if (message !== undefined) yield* send(entry, [message]);
            }),
          );
        }
      });
      const navigationUnavailable = (label: string) => (error: unknown) =>
        Effect.gen(function* () {
          for (const entry of journals.values()) {
            if (entry.scope.kind !== "navigation" || entry.failure !== undefined) continue;
            entry.dirty = true;
            entry.generation += 1;
            if (demanded(entry))
              yield* send(entry, [
                {
                  type: "scope-error",
                  scope: entry.scope,
                  code: "unavailable",
                  reason: null,
                  disposition: "transient",
                },
              ]);
          }
          yield* Effect.logWarning(label, error);
        });
      const refreshChanges = Effect.gen(function* () {
        if (source === undefined || sourceFence.dirty()) return;
        const version = sourceVersion;
        const fresh = yield* changeSourceNow;
        if (sourceFence.dirty() || version !== sourceVersion) return;
        const changed = new Set(
          [...source.appIds].filter(
            (appId) => fresh.fingerprints.get(appId) !== publishedChanges?.fingerprints.get(appId),
          ),
        );
        publishedChanges = fresh;
        if (changed.size > 0) yield* refreshAppValues(changed, version, changeVersion);
      }).pipe(Effect.catch(navigationUnavailable("Change navigation read unavailable")));
      const refreshEnvironments = Effect.gen(function* () {
        if (source === undefined || sourceFence.dirty()) return;
        const version = sourceVersion;
        const fresh = yield* structure.environments;
        if (sourceFence.dirty() || version !== sourceVersion) return;
        const changed = new Set(
          [...source.appIds].filter(
            (appId) => fresh.fingerprints.get(appId) !== environmentSource?.fingerprints.get(appId),
          ),
        );
        environmentSource = fresh;
        if (changed.size === 0) return;
        yield* refreshAppValues(changed, version);
      }).pipe(Effect.catch(navigationUnavailable("Environment navigation read unavailable")));
      const refreshReleases: Effect.Effect<void> = releaseOne
        .withPermits(1)(
          Effect.gen(function* () {
            if (source === undefined || sourceFence.dirty()) return;
            if (releaseSource !== undefined && !releaseFence.dirty()) return;
            const version = sourceVersion;
            let fresh: ReleaseNavigationSource;
            for (;;) {
              const started = releaseFence.capture();
              fresh = yield* releases.navigation;
              if (releaseFence.accept(started)) break;
            }
            if (sourceFence.dirty() || version !== sourceVersion) {
              releaseFence.invalidate();
              return;
            }
            const changed = new Set(
              [...source.appIds].filter(
                (appId) => fresh.fingerprints.get(appId) !== releaseSource?.fingerprints.get(appId),
              ),
            );
            releaseSource = fresh;
            if (changed.size > 0) yield* refreshAppValues(changed, version);
          }),
        )
        .pipe(
          Effect.catch(navigationUnavailable("Release navigation read unavailable")),
          Effect.provideService(Scope.Scope, hubScope),
        );
      type Signal =
        | { kind: "structure" | "detail" | "roles" | "environment" | "usage" | "auto-update" }
        | { kind: "attention" | "forget"; projectId: string };
      const pulls = yield* Effect.forEach(
        [
          autoUpdate.changes.pipe(Stream.map((): Signal => ({ kind: "auto-update" }))),
          (usageReader.changes ?? Stream.empty).pipe(Stream.map((): Signal => ({ kind: "usage" }))),
          structure.changes.pipe(Stream.map((): Signal => ({ kind: "structure" }))),
          roles.views.pipe(
            Stream.filter((seen) => fingerprint(seen.view) !== rolesFingerprint),
            Stream.map((): Signal => ({ kind: "roles" })),
          ),
          changes.changes.pipe(
            Stream.map((): Signal => {
              changeFence.invalidate();
              releaseFence.invalidate();
              return { kind: "detail" };
            }),
          ),
          releases.changes.pipe(
            Stream.map((): Signal => {
              releaseFence.invalidate();
              return { kind: "environment" };
            }),
          ),
          deploys.changes.pipe(
            Stream.map((): Signal => {
              releaseFence.invalidate();
              return { kind: "environment" };
            }),
          ),
          overviews.changes.pipe(
            Stream.map((projectId): Signal => ({ kind: "attention", projectId })),
          ),
          overviews.forgotten.pipe(
            Stream.map((projectId): Signal => ({ kind: "forget", projectId })),
          ),
        ],
        Stream.toPull,
      );
      const signals = yield* Queue.unbounded<Signal>();
      const pending = new Set<string>();
      for (const pull of pulls)
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.flatMap(pull, (batch) =>
              Effect.forEach(
                batch,
                (signal) => {
                  const key = json(signal);
                  if (pending.has(key)) return Effect.void;
                  pending.add(key);
                  return Queue.offer(signals, signal).pipe(Effect.asVoid);
                },
                { discard: true },
              ),
            ),
          ).pipe(Effect.ignore),
          { startImmediately: true },
        );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(signals), (signal) => {
            pending.delete(json(signal));
            if (signal.kind === "auto-update")
              return Effect.gen(function* () {
                for (const entry of journals.values())
                  if (entry.scope.kind === "navigation" && entry.failure === undefined)
                    yield* entry.one.withPermits(1)(
                      Effect.gen(function* () {
                        const policy = yield* policyFor(entry.userId);
                        const message = entry.journal.commit(policy.values, policy.removals);
                        if (message !== undefined) yield* send(entry, [message]);
                      }),
                    );
              }).pipe(Effect.catch(navigationUnavailable("Automatic-update policy unavailable")));
            if (signal.kind === "usage")
              return Effect.gen(function* () {
                for (const entry of journals.values())
                  if (entry.scope.kind === "agentUsage" && entry.failure === undefined) {
                    entry.dirty = true;
                    entry.generation += 1;
                    if (demanded(entry)) yield* scheduleRefresh(entry);
                  }
              });
            return signal.kind === "attention" || signal.kind === "forget"
              ? refreshAttention(signal.projectId, signal.kind === "forget")
              : signal.kind === "environment"
                ? Effect.andThen(
                    invalidate("detail"),
                    Effect.andThen(refreshEnvironments, refreshReleases),
                  )
                : signal.kind === "detail"
                  ? Effect.andThen(
                      invalidate("detail"),
                      Effect.andThen(refreshChanges, refreshReleases),
                    )
                  : invalidate(signal.kind);
          }),
        ),
        { startImmediately: true },
      );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.andThen(
            Effect.sleep(recheck),
            Effect.gen(function* () {
              if (connections.size === 0) return;
              const active = [...journals.values()].filter(demanded);
              if (active.every((entry) => entry.failure?.code === HQ_ZEROPS_REFUSED.code)) return;
              yield* roles.recent.pipe(
                Effect.catch((error) => {
                  const facts = metadata(error);
                  const code =
                    facts.code === HQ_ZEROPS_REFUSED.code ? facts.code : "permissions_unverified";
                  return Effect.forEach(
                    active,
                    (entry) => {
                      const failure: HqScopeFailure = {
                        type: "scope-error",
                        scope: entry.scope,
                        code,
                        reason: facts.reason ?? null,
                        disposition: refusalDisposition(code),
                      };
                      if (failure.disposition === "refused") entry.failure = failure;
                      return send(entry, [failure]);
                    },
                    { discard: true },
                  );
                }),
              );
              // The status value is shared; ticking health never rebuilds person navigation.
              const status = yield* statusValue;
              yield* Effect.forEach(
                active.filter(
                  (entry) => entry.scope.kind === "navigation" && entry.failure === undefined,
                ),
                (entry) =>
                  entry.one.withPermits(1)(
                    Effect.gen(function* () {
                      const message = entry.journal.commit([status]);
                      if (message !== undefined) yield* send(entry, [message]);
                    }),
                  ),
                { discard: true },
              );
            }),
          ),
        ),
      );
      return HqScopes.of({
        open: (userId, sessionId) =>
          Effect.gen(function* () {
            const queue = yield* Queue.unbounded<ScopeOutput>();
            const wanted = new Map<string, number>();
            const connection = {
              userId,
              queue,
              scopes: new Set<string>(),
              wanted,
              failures: new Map<string, string>(),
              ended: false,
            };
            yield* Effect.acquireRelease(
              Effect.sync(() => connections.add(connection)),
              () =>
                Effect.sync(() => {
                  for (const key of connection.scopes) {
                    const entry = journals.get(json([userId, key]));
                    if (entry !== undefined) entry.lastUsed = ++usage;
                  }
                  connections.delete(connection);
                  prune();
                }),
            );
            let demandSequence = 0;
            const subscribe = (subscription: HqSubscription, demand: number) =>
              Effect.gen(function* () {
                const key = hqScopeKey(subscription.scope);
                if (wanted.get(key) !== demand) return;
                const id = json([userId, key]);
                let entry = journals.get(id);
                if (entry === undefined) {
                  entry = {
                    userId,
                    sessions: new Set<string>(),
                    lastUsed: ++usage,
                    scope: subscription.scope,
                    journal: makeScopeJournal(
                      subscription.scope,
                      `${incarnation}:${journals.size}:${NodeCrypto.randomUUID()}`,
                    ),
                    dirty: true,
                    one: Semaphore.makeUnsafe(1),
                    generation: 0,
                    sourceVersion: 0,
                    refreshing: false,
                    subscribing: 0,
                  };
                  journals.set(id, entry);
                }
                const target = entry;
                target.lastUsed = ++usage;
                target.subscribing += 1;
                yield* target.one
                  .withPermits(1)(
                    Effect.gen(function* () {
                      if (sessionId !== undefined && !target.sessions.has(sessionId)) {
                        target.sessions.add(sessionId);
                        if (target.sessions.size > 64)
                          target.sessions.delete(target.sessions.values().next().value!);
                        delete target.failure;
                        target.dirty = true;
                      }
                      for (;;) {
                        // Refresh broadcasts to registered siblings, then this connection catches up once.
                        if (wanted.get(key) !== demand) return;
                        connection.scopes.delete(key);
                        yield* refreshUnlocked(target);
                        if (wanted.get(key) !== demand) return;
                        if (
                          target.failure === undefined &&
                          (target.dirty || target.sourceVersion !== sourceVersion)
                        )
                          continue;
                        const generation = target.generation;
                        const version = sourceVersion;
                        const deliver = (messages: ReadonlyArray<ScopeOutput>) =>
                          Effect.sync(() => {
                            if (
                              wanted.get(key) !== demand ||
                              generation !== target.generation ||
                              version !== sourceVersion
                            )
                              return false;
                            connection.scopes.add(key);
                            offer(connection, messages);
                            return true;
                          });
                        const outgoing: ScopeOutput[] = [];
                        let provenRemovals: ReadonlyArray<HqRemoval> = [];
                        if (target.failure?.disposition === "refused") {
                          if (
                            subscription.knownKeys !== undefined &&
                            refusalProvesRemoval(target.failure.code)
                          ) {
                            const reason =
                              target.failure.code === "forbidden" ? "no-access" : "deleted";
                            provenRemovals = subscription.knownKeys
                              .filter((key) => validKey(target.scope, key))
                              .map((key) => ({ key, reason }));
                            const proof = target.journal.commit([], provenRemovals);
                            if (proof !== undefined) yield* send(target, [proof]);
                          }
                          const reset = target.journal.resume(undefined, provenRemovals)[0]!;
                          if (reset.removals.length > 0) outgoing.push(reset);
                        }
                        if (target.failure !== undefined) {
                          if (yield* deliver([...outgoing, target.failure])) return;
                          continue;
                        }
                        if (
                          subscription.knownKeys !== undefined &&
                          subscription.scope.kind === "navigation"
                        ) {
                          const present = new Set(target.journal.keys());
                          // The just-refreshed source and journal form one accepted coverage cut.
                          const current = source!;
                          const removals = subscription.knownKeys
                            .filter((key) => !present.has(key))
                            .flatMap((key) => {
                              const removal = navigationRemoval(
                                { ...current, forPerson: (user) => viewFor(current, user) },
                                userId,
                                key,
                              );
                              return removal === undefined ? [] : [removal];
                            });
                          if (wanted.get(key) !== demand) return;
                          provenRemovals = removals;
                          const proof = target.journal.commit([], removals);
                          if (proof !== undefined) yield* send(target, [proof]);
                        }
                        const replay = target.journal.resume(subscription.cursor, provenRemovals);
                        const reset = target.journal.resume()[0]!;
                        if (
                          yield* deliver([
                            ...replay,
                            {
                              type: "scope-ready",
                              scope: target.scope,
                              incarnation: reset.incarnation,
                              revision: reset.revision,
                            },
                          ])
                        )
                          return;
                      }
                    }),
                  )
                  .pipe(
                    Effect.ensuring(
                      Effect.sync(() => {
                        target.subscribing -= 1;
                      }),
                    ),
                  );
              });
            return {
              messages: Stream.fromQueue(queue),
              request: (request) =>
                Effect.gen(function* () {
                  switch (request.type) {
                    case "pong":
                      return;
                    case "retry": {
                      connection.ended = false;
                      const keys =
                        request.scopes === undefined
                          ? undefined
                          : new Set(request.scopes.map(hqScopeKey));
                      sourceFence.invalidate();
                      contents.clear();
                      overviewCache = undefined;
                      for (const entry of journals.values()) {
                        if (
                          entry.userId !== userId ||
                          (keys !== undefined && !keys.has(hqScopeKey(entry.scope)))
                        )
                          continue;
                        entry.dirty = true;
                        entry.generation += 1;
                        yield* entry.one.withPermits(1)(
                          Effect.gen(function* () {
                            delete entry.failure;
                            connection.failures.delete(hqScopeKey(entry.scope));
                            if (demanded(entry)) yield* refreshUnlocked(entry);
                          }),
                        );
                      }
                      return;
                    }
                    case "subscribe": {
                      const demanded: Array<{ subscription: HqSubscription; demand: number }> = [];
                      for (const subscription of request.scopes) {
                        const key = hqScopeKey(subscription.scope);
                        const usageScopes = new Set(
                          [...connections]
                            .filter((value) => value.userId === userId)
                            .flatMap((value) =>
                              [...value.wanted.keys()].filter((key) =>
                                key.startsWith('["agentUsage"'),
                              ),
                            ),
                        );
                        if (
                          subscription.scope.kind === "agentUsage" &&
                          !usageScopes.has(key) &&
                          usageScopes.size >= USAGE_REPORT_LIMITS.scopesPerPerson
                        ) {
                          yield* Queue.offer(queue, {
                            type: "scope-error",
                            scope: subscription.scope,
                            code: "usage_too_many_reports",
                            reason: null,
                            disposition: "refused",
                          });
                          continue;
                        }
                        if (!wanted.has(key) && wanted.size >= 128) {
                          yield* Queue.offer(queue, {
                            type: "scope-error",
                            scope: subscription.scope,
                            code: "too_many_scopes",
                            reason: null,
                            disposition: "refused",
                          });
                          continue;
                        }
                        demandSequence += 1;
                        wanted.set(key, demandSequence);
                        connection.failures.delete(key);
                        connection.scopes.delete(key);
                        demanded.push({ subscription, demand: demandSequence });
                      }
                      yield* Effect.forEach(
                        demanded,
                        ({ subscription, demand }) => subscribe(subscription, demand),
                        { discard: true, concurrency: "unbounded" },
                      );
                      return;
                    }
                    case "unsubscribe":
                      for (const scope of request.scopes) {
                        const key = hqScopeKey(scope);
                        wanted.delete(key);
                        connection.failures.delete(key);
                        const held = journals.get(json([userId, key]));
                        if (held !== undefined) held.lastUsed = ++usage;
                        connection.scopes.delete(key);
                      }
                      prune();
                      return;
                    case "compare": {
                      yield* changes
                        .compare(userId, request.appId, request.repo, {
                          ...(request.base === undefined ? {} : { base: request.base }),
                          head: request.head,
                        })
                        .pipe(
                          Effect.flatMap((result) =>
                            Queue.offer(queue, {
                              type: "compare",
                              requestId: request.requestId,
                              appId: request.appId,
                              repo: request.repo,
                              result,
                            }),
                          ),
                          Effect.catch((error) => {
                            const facts = metadata(error);
                            return Queue.offer(queue, {
                              type: "compare-error",
                              requestId: request.requestId,
                              appId: request.appId,
                              repo: request.repo,
                              code: facts.code ?? "unavailable",
                              reason: facts.reason ?? null,
                              disposition: refusalDisposition(facts.code ?? "unavailable"),
                            });
                          }),
                        );
                      return;
                    }
                    case "move-offers": {
                      yield* structure.moveDestinations(userId, request.projectId).pipe(
                        Effect.flatMap((offers) =>
                          Queue.offer(queue, {
                            type: "move-offers",
                            requestId: request.requestId,
                            projectId: request.projectId,
                            ...offers,
                          }),
                        ),
                        Effect.catch((error) => {
                          const facts = metadata(error);
                          return Queue.offer(queue, {
                            type: "move-offers-error",
                            requestId: request.requestId,
                            projectId: request.projectId,
                            code: facts.code ?? "unavailable",
                            reason: facts.reason ?? null,
                            disposition: refusalDisposition(facts.code ?? "unavailable"),
                          });
                        }),
                      );
                      return;
                    }
                    case "handover-candidates": {
                      yield* Effect.gen(function* () {
                        const current = yield* sourceNow;
                        if (
                          !current.facts.members.some(
                            (member) =>
                              member.kind === "person" &&
                              member.status === "ACTIVE" &&
                              roleAtLeast(member.roleCode, "ADMIN") &&
                              member.userId === userId,
                          ) ||
                          !observedProjects(viewFor(current, userId)).some(
                            (project) => project.projectId === request.projectId,
                          )
                        )
                          return yield* new ScopeReadRefused({
                            code: "forbidden",
                            reason: "no-access",
                          });
                        return current.facts.members
                          .filter(
                            (member) => member.kind === "person" && member.status === "ACTIVE",
                          )
                          .map((member) => ({
                            userId: member.userId,
                            clientUserId: member.clientUserId,
                            name: member.name,
                            avatarUrl: member.avatarUrl ?? null,
                          }));
                      }).pipe(
                        Effect.flatMap((candidates) =>
                          Queue.offer(queue, {
                            type: "handover-candidates",
                            requestId: request.requestId,
                            projectId: request.projectId,
                            candidates,
                          }),
                        ),
                        Effect.catch((error) => {
                          const facts = metadata(error);
                          return Queue.offer(queue, {
                            type: "handover-candidates-error",
                            requestId: request.requestId,
                            projectId: request.projectId,
                            code: facts.code ?? "unavailable",
                            reason: facts.reason ?? null,
                            disposition: refusalDisposition(facts.code ?? "unavailable"),
                          });
                        }),
                      );
                      return;
                    }
                    case "seen": {
                      const source = yield* sourceNow;
                      if (
                        !observedProjects(viewFor(source, userId)).some(
                          (project) => project.projectId === request.projectId,
                        )
                      )
                        return;
                      const attention = (yield* overviews.all).get(request.projectId)?.attention;
                      const ids = request.resultIds.filter((id) =>
                        attention?.results.some((result) => result.turnId === id),
                      );
                      const prior = yield* loadSeen(userId, request.projectId);
                      for (const id of ids) {
                        yield* leader.write(
                          sql`INSERT INTO hq_attention_seen (user_id, project_id, result_id) VALUES (${userId}, ${request.projectId}, ${id}) ON CONFLICT DO NOTHING`,
                        );
                        prior.add(id);
                      }
                      const entry = journals.get(json([userId, "navigation"]));
                      if (entry !== undefined) {
                        entry.dirty = true;
                        yield* refresh(entry);
                      }
                    }
                  }
                }).pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      if (request.type !== "pong") prune();
                    }),
                  ),
                  Effect.catch((error) => {
                    const facts = metadata(error);
                    const code = facts.code ?? "unavailable";
                    return Queue.offer(queue, {
                      type: "scope-error",
                      scope: { kind: "navigation" },
                      code,
                      reason: facts.reason ?? null,
                      disposition: refusalDisposition(code),
                    }).pipe(Effect.asVoid);
                  }),
                ),
            };
          }),
      });
    }),
  );
