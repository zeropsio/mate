/** Mate database reads: explicit sampled detail intents, one writer and the common stream retry/refusal policy. */
import {
  WS_METHODS,
  type EnvironmentId,
  type ZeropsDataConsolePath,
  type ZeropsDataConsoleRequest,
  type ZeropsDataConsoleResponse,
  type ZeropsDataConsoleService,
  type ZeropsDataConsoleNode,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Fiber from "effect/Fiber";
import * as Random from "effect/Random";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { request as rpcRequest } from "../../rpc/client.ts";
import {
  applyTablePage,
  applyTreePage,
  buildDataMentionEntries,
  collapseTreePath,
  documentListingModel,
  emptyTable,
  expandTreePath,
  resolveServiceAffordances,
  type DataMentionEntry,
} from "../../zerops/dataConsole.ts";
import {
  databaseKey,
  databaseScope,
  emptyDatabasePanel,
  type DatabasePanelValue,
  type DatabaseValue,
} from "../families/database.ts";
import type { ScopeKey } from "../model.ts";
import { streamOf } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { classifyDatabaseFailure } from "./databaseFailure.ts";
import {
  makeDatabaseSessionWire,
  startDatabaseSession,
  type DatabaseSessionWire,
} from "./databaseSession.ts";
import { STREAM_POLICY, type StreamEvent, type StreamFault } from "../streamMachine.ts";

export interface DatabaseWire {
  readonly session?: DatabaseSessionWire;
  readonly call: (
    environmentId: EnvironmentId,
    request: ZeropsDataConsoleRequest,
  ) => Promise<ZeropsDataConsoleResponse>;
}
export interface DatabaseReadIntent {
  readonly request: ZeropsDataConsoleRequest;
  readonly target: string;
  readonly cursor?: string;
  readonly grid?: boolean;
  readonly manual?: boolean;
}
export type DatabasePanelIntent =
  | { readonly kind: "clear-selection" }
  | { readonly kind: "clear-query" }
  | { readonly kind: "clear-filter" }
  | { readonly kind: "clear-search" }
  | { readonly kind: "clear-grid" }
  | { readonly kind: "reset-tree"; readonly path: ZeropsDataConsolePath }
  | { readonly kind: "expand" | "collapse"; readonly path: ZeropsDataConsolePath };

export interface DatabaseReads {
  readonly read: (
    environmentId: EnvironmentId,
    panelId: string,
    intent: DatabaseReadIntent,
  ) => Promise<void>;
  readonly update: (
    environmentId: EnvironmentId,
    panelId: string,
    intent: DatabasePanelIntent,
  ) => void;
  /** Once per account session; remount never revives a refused read. */
  readonly catalog: (environmentId: EnvironmentId) => Promise<void>;
  readonly demandCatalog: (environmentId: EnvironmentId) => () => void;
  readonly demandSession: (environmentId: EnvironmentId) => () => void;
  readonly mention: (environmentId: EnvironmentId, entry: DataMentionEntry) => Promise<void>;
  readonly release: (environmentId: EnvironmentId, panelId: string) => void;
  readonly close: () => void;
}

export function makeDatabaseWire(registry: EnvironmentRegistry["Service"]): DatabaseWire {
  return {
    session: makeDatabaseSessionWire(registry),
    call: async (environmentId, input) => {
      const result = await Effect.runPromise(
        Effect.result(
          registry.run(environmentId, rpcRequest(WS_METHODS.zeropsDataConsoleCall, input)).pipe(
            Effect.timeout(STREAM_POLICY.baselineTimeoutMs),
            Effect.catchCause((cause) => Effect.fail(classifyDatabaseFailure(Cause.squash(cause)))),
          ),
        ),
      );
      if (Result.isFailure(result)) throw result.failure;
      return result.success;
    },
  };
}

/** A source answer folds into a retained presentation model; cursor pages append only to their own target. */
export function applyDatabaseAnswer(
  value: DatabasePanelValue,
  intent: DatabaseReadIntent,
  response: ZeropsDataConsoleResponse,
): DatabasePanelValue {
  const { request, target, cursor } = intent;
  if (response.kind === "services") return { ...value, services: response.services };
  if (response.kind === "tree" && request.kind === "tree")
    return { ...value, tree: applyTreePage(value.tree, request.path, response, cursor) };
  if (response.kind === "blob") {
    const { kind: _kind, ...blob } = response;
    return { ...value, blob };
  }
  if (response.kind === "count") return { ...value, tableCount: response.count };
  if (response.kind === "search" && request.kind === "search") {
    const page = documentListingModel(
      response.nodes,
      response.nextCursor === "" ? undefined : response.nextCursor,
    );
    const previous = value.documentSearchResult;
    return {
      ...value,
      documentSearchResult: {
        query: request.q,
        listing:
          cursor === undefined || previous?.query !== request.q
            ? page
            : {
                nodes: [...previous.listing.nodes, ...page.nodes],
                model: {
                  ...page.model,
                  rows: [...previous.listing.model.rows, ...page.model.rows],
                },
              },
      },
    };
  }
  if (response.kind === "table") {
    if (target === "filtered" || target === "query") {
      if (request.kind !== "query") return value;
      const field = target === "filtered" ? "filtered" : "queryState";
      const previous = value[field];
      return {
        ...value,
        [field]: {
          stmt: request.stmt,
          model: applyTablePage(
            cursor === undefined || previous?.stmt !== request.stmt ? emptyTable : previous.model,
            response.page,
            cursor,
          ),
        },
      };
    }
    return {
      ...value,
      tableModel: applyTablePage(
        cursor === undefined ? emptyTable : value.tableModel,
        response.page,
        cursor,
      ),
    };
  }
  return value;
}

export function makeDatabaseReads({
  store,
  wire,
}: {
  readonly store: AccountStore;
  readonly wire: DatabaseWire;
}): DatabaseReads {
  let closed = false;
  let revision = 0;
  for (const [key, fact] of store.state().facts)
    if (key.startsWith("database:") && fact.revision.kind === "mate-link")
      revision = Math.max(revision, fact.revision.sequence);
  const attempts = new Map<ScopeKey, { readonly token: number; cancelRetry?: () => void }>();
  const catalogs = new Map<EnvironmentId, Promise<void>>();
  const sessions = new Map<
    EnvironmentId,
    { count: number; readonly stop: () => void; readonly retry: () => void }
  >();
  const catalogHolders = new Map<EnvironmentId, number>();
  const signal = (scope: ScopeKey, event: StreamEvent) =>
    store.dispatch({
      kind: "stream",
      key: scope,
      now: Effect.runSync(Clock.currentTimeMillis),
      event,
    });
  const valueAt = (environmentId: EnvironmentId, panelId: string) => {
    const fact = readsOfState(store.state()).fact("database", databaseKey(environmentId, panelId));
    return fact.kind === "known" ? fact.value : undefined;
  };
  const panelAt = (environmentId: EnvironmentId, panelId: string): DatabasePanelValue => {
    const value = valueAt(environmentId, panelId);
    return value?.kind === "panel" ? value : emptyDatabasePanel;
  };
  const write = (
    environmentId: EnvironmentId,
    panelId: string,
    scope: ScopeKey,
    value: DatabaseValue,
    partial = false,
    baseline = false,
  ) => {
    const generation = streamOf(store.state(), scope).generation;
    const row = {
      family: "database",
      id: databaseKey(environmentId, panelId),
      value,
      revision: { kind: "mate-link", sequence: ++revision },
    } as const;
    if (baseline) {
      store.dispatch({ kind: "baseline-begin", scope, generation });
      store.dispatch({
        kind: "baseline-commit",
        scope,
        generation,
        via: "mate-direct",
        rows: [row],
        members: [row.id],
        partial,
      });
    } else
      store.dispatch({
        kind: "rows",
        scope,
        generation,
        via: "mate-direct",
        method: "read",
        rows: [row],
      });
  };
  const cancel = (scope: ScopeKey) => {
    const active = attempts.get(scope);
    active?.cancelRetry?.();
    attempts.delete(scope);
    signal(scope, { kind: "demand", demanded: false });
  };
  const denyEnvironment = (environmentId: EnvironmentId, fault: StreamFault) => {
    for (const [key] of store.state().facts) {
      if (key.startsWith(`database:${environmentId}/`))
        store.dispatch({
          kind: "access",
          family: "database",
          id: key.slice("database:".length),
          access: "denied",
        });
    }
    for (const scope of attempts.keys())
      if (scope.startsWith(`mate:${encodeURIComponent(environmentId)}:database:`)) {
        signal(scope, { kind: "fault", fault, jitter: 0 });
        cancel(scope);
      }
  };
  const sample = async (
    environmentId: EnvironmentId,
    panelId: string,
    target: string,
    source: () => Promise<{ readonly value: DatabaseValue; readonly partial?: boolean }>,
    manual: boolean,
  ): Promise<void> => {
    if (closed) return;
    const scope = databaseScope(environmentId, panelId, target);
    const before = streamOf(store.state(), scope);
    if (!manual && (before.phase === "refused" || before.phase === "live")) return;
    const previous = attempts.get(scope);
    previous?.cancelRetry?.();
    const active: { readonly token: number; cancelRetry?: () => void } = {
      token: (previous?.token ?? 0) + 1,
    };
    attempts.set(scope, active);
    signal(scope, { kind: "demand", demanded: true });
    signal(scope, {
      kind:
        manual && (before.phase === "refused" || before.phase === "recovering")
          ? "manual-retry"
          : "attempt",
    });
    const current = () => !closed && attempts.get(scope) === active;
    const run = async (): Promise<void> => {
      if (!current()) return;
      signal(scope, { kind: "handshake" });
      try {
        const result = await source();
        if (!current()) return;
        write(environmentId, panelId, scope, result.value, result.partial, true);
        signal(scope, { kind: "baseline-committed" });
      } catch (error) {
        if (!current()) return;
        const fault = classifyDatabaseFailure(error);
        signal(scope, { kind: "fault", fault, jitter: Effect.runSync(Random.next) });
        if (fault.outcome === "authoritative-denial") denyEnvironment(environmentId, fault);
        const next = streamOf(store.state(), scope).next;
        if (next.kind === "retry") {
          const waiting = Effect.runFork(
            Effect.sleep(Math.max(0, next.at - Effect.runSync(Clock.currentTimeMillis))).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (!current()) return;
                  signal(scope, { kind: "retry-due" });
                  void run();
                }),
              ),
            ),
          );
          active.cancelRetry = () => {
            Effect.runFork(Fiber.interrupt(waiting));
          };
        }
      }
    };
    await run();
  };

  const read: DatabaseReads["read"] = async (environmentId, panelId, intent) => {
    if (closed) return;
    if (intent.manual !== false) sessions.get(environmentId)?.retry();
    const value = panelAt(environmentId, panelId);
    const scope = databaseScope(environmentId, panelId, intent.target);
    if (
      (intent.cursor !== undefined || intent.request.kind === "tree") &&
      ["connecting", "baselining"].includes(streamOf(store.state(), scope).phase)
    )
      return;
    if (
      intent.manual === false &&
      ["refused", "live"].includes(streamOf(store.state(), scope).phase)
    )
      return;
    write(environmentId, panelId, scope, {
      ...value,
      targets: [...new Set([...value.targets, intent.target])],
      latestTarget: intent.target,
      gridTarget: intent.grid ? intent.target : value.gridTarget,
    });
    await sample(
      environmentId,
      panelId,
      intent.target,
      async () => {
        const response = await wire.call(environmentId, intent.request);
        return {
          value: applyDatabaseAnswer(panelAt(environmentId, panelId), intent, response),
          partial:
            response.kind === "table"
              ? response.page.nextCursor !== ""
              : response.kind === "tree" || response.kind === "search"
                ? response.nextCursor !== ""
                : false,
        };
      },
      intent.manual ?? true,
    );
  };
  const update: DatabaseReads["update"] = (environmentId, panelId, intent) => {
    if (closed) return;
    let value = panelAt(environmentId, panelId);
    const targets =
      intent.kind === "clear-selection"
        ? ["table", "blob", "count", "filtered", "search"]
        : intent.kind === "clear-query"
          ? ["query"]
          : intent.kind === "clear-filter"
            ? ["filtered"]
            : intent.kind === "clear-search"
              ? ["search"]
              : [];
    for (const target of targets) cancel(databaseScope(environmentId, panelId, target));
    value = {
      ...value,
      targets: value.targets.filter((target) => !targets.includes(target)),
      latestTarget: targets.includes(value.latestTarget ?? "") ? undefined : value.latestTarget,
    };
    switch (intent.kind) {
      case "clear-selection":
        value = {
          ...value,
          tableModel: emptyTable,
          tableCount: undefined,
          filtered: undefined,
          blob: undefined,
          documentSearchResult: undefined,
          gridTarget: undefined,
        };
        break;
      case "clear-query":
        value = { ...value, queryState: undefined };
        break;
      case "clear-filter":
        value = { ...value, filtered: undefined };
        break;
      case "clear-search":
        value = { ...value, documentSearchResult: undefined };
        break;
      case "clear-grid":
        value = { ...value, gridTarget: undefined };
        break;
      case "reset-tree":
        for (const target of value.targets)
          if (target.startsWith("tree/")) cancel(databaseScope(environmentId, panelId, target));
        value = {
          ...value,
          tree: expandTreePath(emptyDatabasePanel.tree, intent.path),
          targets: value.targets.filter((target) => !target.startsWith("tree/")),
        };
        break;
      case "expand":
        value = { ...value, tree: expandTreePath(value.tree, intent.path) };
        break;
      case "collapse":
        value = { ...value, tree: collapseTreePath(value.tree, intent.path) };
        break;
    }
    write(environmentId, panelId, databaseScope(environmentId, panelId, "view"), value);
  };

  const catalog: DatabaseReads["catalog"] = (environmentId) => {
    const scope = databaseScope(environmentId, "catalog");
    if (valueAt(environmentId, "catalog")?.kind === "catalog") return Promise.resolve();
    const existing = catalogs.get(environmentId);
    if (existing !== undefined && streamOf(store.state(), scope).phase !== "paused")
      return existing;
    const load = sample(
      environmentId,
      "catalog",
      "value",
      async () => {
        const discovery = await wire.call(environmentId, { kind: "refresh" });
        if (discovery.kind !== "services")
          throw {
            outcome: "definitive-refusal",
            message: "The database catalog answer was incomplete.",
          } satisfies StreamFault;
        const browsable = discovery.services
          .filter((service) => resolveServiceAffordances(service).canBrowse)
          .slice(0, 20);
        let partial = discovery.services.length > 20;
        const tables: ZeropsDataConsoleNode[] = [];
        const collapsed: Record<string, ReadonlyArray<string>> = {};
        for (const service of browsable) {
          const walked = await walkService(environmentId, service, wire);
          tables.push(...walked.tables);
          collapsed[service.hostname] = walked.collapsed;
          partial ||= walked.partial;
        }
        return {
          value: {
            kind: "catalog",
            entries: buildDataMentionEntries(browsable, tables, collapsed),
          },
          partial,
        };
      },
      false,
    );
    catalogs.set(environmentId, load);
    return load;
  };
  const demandSession: DatabaseReads["demandSession"] = (environmentId) => {
    if (closed || wire.session === undefined) return () => {};
    let entry = sessions.get(environmentId);
    if (entry === undefined) {
      entry = {
        count: 0,
        ...startDatabaseSession({
          store,
          environmentId,
          wire: wire.session,
          onDenied: () =>
            denyEnvironment(environmentId, {
              outcome: "authoritative-denial",
              message: "The Mate refused the data console.",
            }),
        }),
      };
      sessions.set(environmentId, entry);
    }
    entry.count++;
    let released = false;
    return () => {
      if (released || closed) return;
      released = true;
      entry.count--;
      if (entry.count === 0) {
        entry.stop();
        sessions.delete(environmentId);
      }
    };
  };
  const demandCatalog: DatabaseReads["demandCatalog"] = (environmentId) => {
    catalogHolders.set(environmentId, (catalogHolders.get(environmentId) ?? 0) + 1);
    void catalog(environmentId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (catalogHolders.get(environmentId) ?? 1) - 1;
      if (remaining > 0) catalogHolders.set(environmentId, remaining);
      else {
        catalogHolders.delete(environmentId);
        cancel(databaseScope(environmentId, "catalog"));
      }
    };
  };
  const mention: DatabaseReads["mention"] = (environmentId, entry) =>
    sample(
      environmentId,
      `mention/${entry.token}`,
      "value",
      async () => ({
        value: {
          kind: "result",
          response: await wire.call(environmentId, {
            kind: "table",
            path: { service: entry.service, segments: entry.segments },
            page: { limit: 1 },
          }),
        },
      }),
      true,
    );
  const release: DatabaseReads["release"] = (environmentId, panelId) => {
    for (const scope of attempts.keys())
      if (scope.startsWith(databaseScope(environmentId, panelId, "").slice(0, -1))) cancel(scope);
  };
  return {
    read,
    update,
    catalog,
    demandCatalog,
    demandSession,
    mention,
    release,
    close: () => {
      if (closed) return;
      for (const scope of attempts.keys()) cancel(scope);
      closed = true;
      for (const session of sessions.values()) session.stop();
      sessions.clear();
      catalogs.clear();
      catalogHolders.clear();
    },
  };
}

/** Bounded schema discovery preserves read tables if another branch is damaged or unavailable. */
async function walkService(
  environmentId: EnvironmentId,
  service: ZeropsDataConsoleService,
  wire: DatabaseWire,
): Promise<{
  readonly tables: ReadonlyArray<ZeropsDataConsoleNode>;
  readonly collapsed: ReadonlyArray<string>;
  readonly partial: boolean;
}> {
  const collapsed: string[] = [];
  const tables: ZeropsDataConsoleNode[] = [];
  let partial = false;
  const tree = async (path: ZeropsDataConsolePath) => {
    try {
      const answer = await wire.call(environmentId, { kind: "tree", path });
      if (answer.kind !== "tree") {
        partial = true;
        return undefined;
      }
      partial ||= answer.nextCursor !== "";
      return answer;
    } catch (error) {
      if (classifyDatabaseFailure(error).outcome === "authoritative-denial") throw error;
      partial = true;
      return undefined;
    }
  };
  let root = await tree({ service: service.hostname, segments: [] });
  while (
    root?.nodes.length === 1 &&
    root.nextCursor === "" &&
    root.nodes[0]?.kind === "container" &&
    root.nodes[0].hasChildren
  ) {
    const only = root.nodes[0];
    const segment = only.path.segments.at(-1);
    if (segment === undefined || only.path.segments.length !== collapsed.length + 1) break;
    collapsed.push(segment);
    root = await tree(only.path);
  }
  for (const node of root?.nodes ?? []) {
    if (tables.length >= 200) {
      partial = true;
      break;
    }
    if (node.kind === "tabular") tables.push(node);
    else if (node.kind === "container" && node.hasChildren)
      for (const child of (await tree(node.path))?.nodes ?? []) {
        if (tables.length >= 200) {
          partial = true;
          break;
        }
        if (child.kind === "tabular") tables.push(child);
      }
  }
  return { tables, collapsed, partial };
}
