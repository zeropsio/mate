/** Database surfaces read retained source answers and the standing of each demanded read. */
import type { EnvironmentId } from "@t3tools/contracts";
import {
  joinServicesWithTopology,
  describeTableContext,
  type DataMentionEntry,
} from "../../zerops/dataConsole.ts";
import {
  databaseKey,
  databaseScope,
  databaseSessionScope,
  emptyDatabasePanel,
  type DatabasePanelValue,
} from "../families/database.ts";
import type { Coverage } from "../model.ts";
import type { Projection } from "../store.ts";
import { inventoryTopology } from "./inventoryTopology.ts";
import { sameValue } from "./equal.ts";

export interface DatabasePanelRead extends DatabasePanelValue {
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
  { readonly environmentId: EnvironmentId; readonly panelId: string },
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
    return {
      ...value,
      pendingTreeKeys: new Set(
        value.targets.flatMap((target) =>
          target.startsWith("tree/") && pending(target) ? [target.slice(5)] : [],
        ),
      ),
      tableLoadMorePending: pending("table"),
      filteredLoadMorePending: pending("filtered"),
      queryLoadMorePending: pending("query"),
      documentSearchLoadMorePending: pending("search"),
      errorText: value.latestTarget !== value.gridTarget ? error?.message : undefined,
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
      refused: value.targets.some((target) => stream(target).phase === "refused"),
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
    const fact = read.fact("database", databaseKey(environmentId, "catalog"));
    const scope = databaseScope(environmentId, "catalog");
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
  keyOf: ({ environmentId, entry }) => databaseKey(environmentId, `mention/${entry.token}`),
  derive: (read, { environmentId, entry }) => {
    const fact = read.fact("database", databaseKey(environmentId, `mention/${entry.token}`));
    if (read.stream(databaseScope(environmentId, `mention/${entry.token}`)).phase !== "live")
      return undefined;
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
    readonly panelId: string;
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
