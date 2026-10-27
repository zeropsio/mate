/** Database surfaces read retained source answers and the standing of each demanded read. */
import type { EnvironmentId, ZeropsDataConsoleNode } from "@t3tools/contracts";
import {
  joinServicesWithTopology,
  treePathKey,
  describeTableContext,
  type DataMentionEntry,
  type DataConsoleTableModel,
} from "../../zerops/dataConsole.ts";
import {
  databaseKey,
  databaseScope,
  databaseSessionScope,
  emptyDatabasePanel,
  type DatabasePanelValue,
  type DatabasePanelSlot,
} from "../families/database.ts";
import type { Coverage } from "../model.ts";
import type { Projection } from "../store.ts";
import { inventoryTopology } from "./inventoryTopology.ts";
import { sameValue } from "./equal.ts";

export interface DatabasePanelRead extends DatabasePanelValue {
  readonly withheld: boolean;
  readonly detailTarget: string;
  readonly detailDataTarget: "query" | "filtered" | "table";
  readonly detailTable: DataConsoleTableModel;
  readonly inventory: ReadonlyArray<ZeropsDataConsoleNode>;
  readonly readStates: Readonly<
    Record<
      string,
      {
        readonly pending: boolean;
        readonly error: string | undefined;
        readonly code: string | undefined;
      }
    >
  >;
  readonly pendingTreeKeys: ReadonlySet<string>;
  readonly tableLoadMorePending: boolean;
  readonly filteredLoadMorePending: boolean;
  readonly queryLoadMorePending: boolean;
  readonly documentSearchLoadMorePending: boolean;
  readonly errorText: string | undefined;
  readonly gridNotice:
    | { readonly kind: "unsupported" }
    | { readonly kind: "error"; readonly message: string }
    | undefined;
  readonly coverage: Coverage;
  readonly settled: boolean;
  readonly refused: boolean;
}

export const databasePanel: Projection<
  { readonly environmentId: EnvironmentId; readonly panelId: DatabasePanelSlot },
  DatabasePanelRead
> = {
  name: "databasePanel",
  keyOf: ({ environmentId, panelId }) => databaseKey(environmentId, panelId),
  derive: (read, { environmentId, panelId }) => {
    const fact = read.fact("database", databaseKey(environmentId, panelId));
    const value =
      fact.kind === "known" && fact.value.kind === "panel" ? fact.value : emptyDatabasePanel;
    const stream = (target: string) => read.stream(databaseScope(environmentId, panelId, target));
    const pending = (target: string) => ["connecting", "baselining"].includes(stream(target).phase);
    const error = value.latestTarget === undefined ? undefined : stream(value.latestTarget).fault;
    const grid = value.gridTarget === undefined ? undefined : stream(value.gridTarget).fault;
    const detailTarget =
      value.gridTarget ?? (value.queryState ? "query" : value.filtered ? "filtered" : "table");
    const detailDataTarget = value.queryState ? "query" : value.filtered ? "filtered" : "table";
    const filteredModel = value.filtered?.model;
    const detailTable =
      value.queryState?.model ??
      (filteredModel
        ? {
            ...filteredModel,
            columns: filteredModel.columns.map((column) => {
              const source = value.tableModel.columns.find(
                (original) => original.name === column.name,
              );
              return source ? { ...source, editable: false } : column;
            }),
            rowKeyCols: value.tableModel.rowKeyCols,
            bestEffort: value.tableModel.bestEffort,
          }
        : value.tableModel);
    return {
      ...value,
      detailTarget,
      detailDataTarget,
      detailTable,
      withheld: fact.kind === "withheld",
      inventory: [
        ...new Map(
          Object.values(value.tree.entries)
            .flatMap((entry) => entry.nodes)
            .filter((node) => node.kind !== "container")
            .map((node) => [treePathKey(node.path), node]),
        ).values(),
      ],
      readStates: Object.fromEntries(
        value.targets.map((target) => [
          target,
          {
            pending: pending(target),
            error: stream(target).fault?.message,
            code: stream(target).fault?.code,
          },
        ]),
      ),
      pendingTreeKeys: new Set(
        value.targets.flatMap((target) =>
          target.startsWith("tree/") && pending(target) ? [target.slice(5)] : [],
        ),
      ),
      tableLoadMorePending: pending("table"),
      filteredLoadMorePending: pending("filtered"),
      queryLoadMorePending: pending("query"),
      documentSearchLoadMorePending: pending("search"),
      // The summary's failure is said in the identity, where its retry stands.
      errorText:
        value.latestTarget !== value.gridTarget && value.latestTarget !== "summary"
          ? error?.message
          : undefined,
      gridNotice:
        grid == null
          ? undefined
          : grid.code === "unsupported"
            ? { kind: "unsupported" }
            : { kind: "error", message: grid.message },
      coverage:
        value.targets.length === 0
          ? "unknown"
          : value.targets.some(
                (target) =>
                  read.coverage(databaseScope(environmentId, panelId, target)) !== "complete",
              )
            ? "partial"
            : "complete",
      settled:
        value.targets.length > 0 &&
        value.targets.every((target) => stream(target).phase === "live"),
      refused:
        fact.kind === "withheld" ||
        value.targets.some((target) => stream(target).phase === "refused"),
    };
  },
  equals: (left, right) =>
    left.pendingTreeKeys.size === right.pendingTreeKeys.size &&
    [...left.pendingTreeKeys].every((key) => right.pendingTreeKeys.has(key)) &&
    sameValue(left, right),
};

export interface DatabaseCatalogRead {
  readonly status: "loading" | "ready" | "failed";
  readonly entries: ReadonlyArray<DataMentionEntry>;
  readonly coverage: Coverage;
  readonly refused: boolean;
}
export const databaseCatalog: Projection<EnvironmentId, DatabaseCatalogRead> = {
  name: "databaseCatalog",
  keyOf: (environmentId) => environmentId,
  derive: (read, environmentId) => {
    const fact = read.fact("database", databaseKey(environmentId, { kind: "catalog" }));
    const scope = databaseScope(environmentId, { kind: "catalog" });
    const stream = read.stream(scope);
    const known =
      fact.kind === "known" && fact.value.kind === "catalog" ? fact.value.entries : undefined;
    return {
      entries: known ?? [],
      coverage: read.coverage(scope),
      refused: stream.phase === "refused",
      status:
        known === undefined
          ? ["refused", "recovering"].includes(stream.phase)
            ? "failed"
            : "loading"
          : "ready",
    };
  },
  equals: sameValue,
};

/** A picked table mention's context comes from the same sampled result slot as other database reads. */
export const databaseMentionContext: Projection<
  { readonly environmentId: EnvironmentId; readonly entry: DataMentionEntry },
  { readonly label: string; readonly text: string } | undefined
> = {
  name: "databaseMentionContext",
  keyOf: ({ environmentId, entry }) =>
    databaseKey(environmentId, { kind: "mention", token: entry.token }),
  derive: (read, { environmentId, entry }) => {
    const slot = { kind: "mention", token: entry.token } as const;
    const fact = read.fact("database", databaseKey(environmentId, slot));
    if (read.stream(databaseScope(environmentId, slot)).phase !== "live") return undefined;
    if (
      fact.kind !== "known" ||
      fact.value.kind !== "result" ||
      fact.value.response.kind !== "table"
    )
      return undefined;
    return describeTableContext({
      service: { hostname: entry.service, type: entry.serviceType },
      path: { service: entry.service, segments: entry.segments },
      columns: fact.value.response.page.columns,
    });
  },
  equals: sameValue,
};

/** The picker joins console affordances with the platform's current statuses by service hostname. */
export const databaseServices: Projection<
  {
    readonly environmentId: EnvironmentId;
    readonly panelId: DatabasePanelSlot;
    readonly platform: import("./platformAccess.ts").PlatformAccessKey | null;
  },
  ReadonlyArray<import("../../zerops/dataConsole.ts").DataConsoleServiceRow>
> = {
  name: "databaseServices",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, key) => {
    const panel = databasePanel.derive(read, key);
    const topology =
      key.platform === null ? undefined : inventoryTopology.derive(read, key.platform).view;
    return joinServicesWithTopology(panel.services ?? [], topology?.services);
  },
  equals: sameValue,
};

/** Unknown observation stays unknown; a transport outage retains the console's last owner status. */
export const databaseSession: Projection<
  EnvironmentId,
  import("../families/database.ts").DatabaseSessionValue | undefined
> = {
  name: "databaseSession",
  keyOf: (environmentId) => environmentId,
  derive: (read, environmentId) => {
    const scope = databaseSessionScope(environmentId);
    const stream = read.stream(scope);
    const fact = read.fact("databaseSession", environmentId);
    if (fact.kind === "withheld")
      return { status: "unavailable", reason: "The Mate refused the data console." };
    if (stream.phase === "refused")
      return {
        status: "unavailable",
        ...(stream.fault === null ? {} : { reason: stream.fault.message }),
      };
    return fact.kind === "known" ? fact.value : undefined;
  },
  equals: sameValue,
};
