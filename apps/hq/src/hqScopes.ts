// @effect-diagnostics nodeBuiltinImport:off -- scope incarnations are unique to this Core process.
import * as NodeCrypto from "node:crypto";
import {
  HQ_ZEROPS_REFUSED,
  HqNavigationApp,
  HqNavigationProject,
  hqScopeKey,
  type HqScope,
  type HqScopeFailure,
  type HqStreamMessage,
  type HqStreamRequest,
  type HqSubscription,
  type HqValue,
  type HqRemoval,
} from "@t3tools/shared/hqStream";
import { asOrgRole } from "@t3tools/shared/zeropsRoles";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type { SqlError } from "effect/unstable/sql/SqlError";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ZeropsRefused, type ZeropsError } from "./zerops/api.ts";
import { Changes } from "./changes.ts";
import { pruneIdleScopes } from "./scopeRetention.ts";
import { Deploys } from "./deploys.ts";
import type { EnvironmentSource } from "./environmentNavigation.ts";
import { healthParts } from "./health.ts";
import { Leader } from "./leader.ts";
import { MateOverviews, type MateOverviewEntry } from "./mateOverviews.ts";
import { Official } from "./official.ts";
import { navigationRemoval } from "./navigationRemoval.ts";
import { Recomputes } from "./recomputes.ts";
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
    case "navigation":
      return (
        key === "org" || key === "status" || /^(?:app|project|person|press):[^:]{1,128}$/u.test(key)
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
const refusalProvesRemoval = (code: string) => code === "forbidden" || code.endsWith("_not_found");
const refusalDisposition = (code: string) =>
  code === HQ_ZEROPS_REFUSED.code || code === "unsupported" || refusalProvesRemoval(code)
    ? ("refused" as const)
    : ("transient" as const);
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const hqScopesLayer = (build?: string, recheck = Duration.seconds(30)) =>
  Layer.effect(
    HqScopes,
    Effect.gen(function* () {
      const structure = yield* Structure;
      const changes = yield* Changes;
      const releases = yield* Releases;
      const deploys = yield* Deploys;
      const overviews = yield* MateOverviews;
      const roles = yield* Roles;
      const official = yield* Official;
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const recomputes = yield* Recomputes;
      const operations = yield* HqOperationReader;
      const readHealth = healthParts.pipe(
        Effect.provideContext(yield* Effect.context<Effect.Services<typeof healthParts>>()),
      );
      const sourceOne = yield* Semaphore.make(1);
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
        return scope.kind === "navigation"
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
          (project) => project.can?.observe_mate.allow === true,
        );
      const loadSeen = (userId: string, projectId: string) =>
        Effect.gen(function* () {
          const key = json([userId, projectId]);
          for (;;) {
            const epoch = yield* overviews.seenEpoch;
            const prior = seen.get(key);
            if (prior !== undefined && prior.epoch === epoch) return prior.ids;
            const rows = yield* sql<{
              readonly result_id: string;
            }>`SELECT result_id FROM hq_attention_seen WHERE user_id = ${userId} AND project_id = ${projectId}`;
            if (epoch !== (yield* overviews.seenEpoch)) continue;
            const ids = new Set(rows.map((row) => row.result_id));
            seen.set(key, { userId, projectId, epoch, ids });
            return ids;
          }
        });
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
      const load = (entry: Entry, projects?: ReadonlySet<string>) =>
        Effect.gen(function* () {
          const current = projects === undefined ? yield* sourceNow : source!;
          const view = viewFor(current, entry.userId);
          const scope = entry.scope;
          const all = yield* overviewsNow;
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
          if (scope.kind === "navigation") {
            const member = current.facts.members.find(
              (member) => member.kind === "person" && member.userId === entry.userId,
            );
            const acknowledgements = new Map<string, Set<string>>();
            yield* Effect.forEach(
              observable.filter(
                (project) =>
                  (projects === undefined || projects.has(project.projectId)) &&
                  (all.get(project.projectId)?.attention?.results.length ?? 0) > 0,
              ),
              (project) =>
                Effect.map(loadSeen(entry.userId, project.projectId), (ids) =>
                  acknowledgements.set(project.projectId, ids),
                ),
              { discard: true, concurrency: "unbounded" },
            );
            const person = (projectId: string) => {
              const project = current.facts.projects.find((project) => project.id === projectId);
              const role = asOrgRole(
                project?.userRoles.find((role) => role.clientUserId === member?.clientUserId)
                  ?.roleCode ??
                  member?.roleCode ??
                  "NO_ACCESS",
              );
              const owner = project?.userRoles.find((role) => role.roleCode === "OWNER");
              const attention = observable.some((project) => project.projectId === projectId)
                ? all.get(projectId)?.attention
                : null;
              return {
                role,
                mayWrite: observable.some((project) => project.projectId === projectId),
                mine:
                  owner !== undefined
                    ? owner.clientUserId === member?.clientUserId
                    : (() => {
                        const login = all.get(projectId)?.overview?.logins;
                        const project = [
                          ...view.ungrouped,
                          ...view.apps.flatMap((app) => app.projects),
                        ].find((project) => project.projectId === projectId);
                        const signers = project?.mate?.signers;
                        const signer =
                          login?.["claude-code"]?.signedInBy ??
                          login?.["claude-code"]?.lastSignedInBy ??
                          signers?.["claude-code"] ??
                          login?.codex?.signedInBy ??
                          login?.codex?.lastSignedInBy ??
                          signers?.codex;
                        return signer !== undefined && signer !== null && signer === entry.userId;
                      })(),
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
              });
              if (Option.isSome(read))
                values.push({ key: `project:${project.projectId}`, value: read.value });
            }
            if (projects === undefined)
              for (const [projectId, press] of Object.entries(view.presses)) {
                values.push({ key: `press:${projectId}`, value: press });
              }
            const named = new Set([
              ...[...view.ungrouped, ...view.apps.flatMap((app) => app.projects)].flatMap(
                (project) => [project.mate?.madeBy, project.mate?.standupRequestedBy],
              ),
              ...observable.flatMap((project) =>
                Object.values(all.get(project.projectId)?.overview?.logins ?? {}).flatMap(
                  (login) => [login.signedInBy, login.lastSignedInBy],
                ),
              ),
              ...current.facts.projects
                .filter((project) =>
                  [...view.ungrouped, ...view.apps.flatMap((app) => app.projects)].some(
                    (listed) => listed.projectId === project.id,
                  ),
                )
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
            if (projects === undefined)
              for (const member of current.facts.members)
                if (member.kind === "person" && named.has(member.userId))
                  values.push({
                    key: `person:${member.userId}`,
                    value: { name: member.name, clientUserId: member.clientUserId },
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
          return { values, removals };
        });
      const refreshUnlocked = (entry: Entry) =>
        Effect.gen(function* () {
          while (true) {
            if (entry.failure?.disposition === "refused") return;
            yield* sourceNow;
            if (entry.sourceVersion !== sourceVersion) entry.dirty = true;
            if (!entry.dirty) return;
            const generation = entry.generation;
            const version = sourceVersion;
            const data = yield* load(entry);
            yield* sourceNow;
            if (generation !== entry.generation || version !== sourceVersion) continue;
            const message = entry.journal.commit(data.values, data.removals);
            entry.sourceVersion = version;
            entry.dirty = generation !== entry.generation;
            delete entry.failure;
            if (message !== undefined) yield* send(entry, [message]);
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
                    reason: code === "forbidden" ? "no-access" : "deleted",
                  })),
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
          if (kind === "detail" || kind === "structure") contents.clear();
          for (const entry of journals.values()) {
            const affected =
              kind === "roles" ||
              kind === "structure" ||
              (entry.scope.kind !== "attention" && entry.scope.kind !== "navigation");
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
          for (const entry of journals.values()) {
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
                  const data = yield* load(entry, new Set([projectId]));
                  if (generation !== entry.generation || sourceFence.dirty()) return;
                  const message = entry.journal.commit(data.values);
                  if (message !== undefined) yield* send(entry, [message]);
                }),
              );
            }
          }
        });
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
                entry.dirty
              )
                return yield* scheduleRefresh(entry);
              const values = apps.flatMap((app) => {
                const read = navigationApp(source!, entry.userId, app);
                return Option.isSome(read) ? [{ key: `app:${app.id}`, value: read.value }] : [];
              });
              const message = entry.journal.commit(values);
              if (message !== undefined) yield* send(entry, [message]);
            }),
          );
        }
      }).pipe(
        Effect.catch((error) =>
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
            yield* Effect.logWarning("Environment navigation read unavailable", error);
          }),
        ),
      );
      type Signal =
        | { kind: "structure" | "detail" | "roles" | "environment" }
        | { kind: "attention" | "forget"; projectId: string };
      const pulls = yield* Effect.forEach(
        [
          structure.changes.pipe(Stream.map((): Signal => ({ kind: "structure" }))),
          roles.views.pipe(
            Stream.filter((seen) => fingerprint(seen.view) !== rolesFingerprint),
            Stream.map((): Signal => ({ kind: "roles" })),
          ),
          changes.changes.pipe(Stream.map((): Signal => ({ kind: "detail" }))),
          releases.changes.pipe(Stream.map((): Signal => ({ kind: "environment" }))),
          deploys.changes.pipe(Stream.map((): Signal => ({ kind: "environment" }))),
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
            return signal.kind === "attention" || signal.kind === "forget"
              ? refreshAttention(signal.projectId, signal.kind === "forget")
              : signal.kind === "environment"
                ? Effect.andThen(invalidate("detail"), refreshEnvironments)
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
                    case "move-offers": {
                      yield* structure.moveDestinations(userId, request.projectId).pipe(
                        Effect.flatMap((moveTo) =>
                          Queue.offer(queue, {
                            type: "move-offers",
                            requestId: request.requestId,
                            projectId: request.projectId,
                            moveTo,
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
