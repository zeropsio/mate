/** Read-only database details, sampled by a Mate on explicit demand; retained only in the account's memory. */
import type {
  EnvironmentId,
  ZeropsDataConsoleBlob,
  ZeropsDataConsolePath,
  ZeropsDataConsoleService,
  ZeropsDataConsoleResponse,
} from "@t3tools/contracts";
import {
  emptyTable,
  emptyTree,
  treePathKey,
  type DataConsoleNodeListing,
  type DataConsoleTableModel,
  type DataConsoleTree,
  type DataMentionEntry,
} from "../../zerops/dataConsole.ts";
import type { ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

export interface DatabaseQueryValue {
  readonly stmt: string;
  readonly model: DataConsoleTableModel;
}

export interface DatabasePanelValue {
  readonly kind: "panel";
  readonly services: ReadonlyArray<ZeropsDataConsoleService> | undefined;
  readonly tree: DataConsoleTree;
  readonly tableModel: DataConsoleTableModel;
  readonly tableCount: number | undefined;
  readonly filtered: DatabaseQueryValue | undefined;
  readonly queryState: DatabaseQueryValue | undefined;
  readonly blob: ZeropsDataConsoleBlob | undefined;
  readonly documentSearchResult:
    | { readonly query: string; readonly listing: DataConsoleNodeListing }
    | undefined;
  /** Each detail target runs the common stream machine independently. */
  readonly targets: ReadonlyArray<string>;
  readonly latestTarget: string | undefined;
  readonly gridTarget: string | undefined;
}

export interface DatabaseCatalogValue {
  readonly kind: "catalog";
  readonly entries: ReadonlyArray<DataMentionEntry>;
}

export interface DatabaseResultValue {
  readonly kind: "result";
  readonly response: ZeropsDataConsoleResponse;
}

export type DatabaseValue = DatabasePanelValue | DatabaseCatalogValue | DatabaseResultValue;

declare module "../model.ts" {
  interface FamilyValues {
    readonly database: DatabaseValue;
  }
}

export const databaseFamily: FamilySpec<"database"> = {
  family: "database",
  authority: "mate",
  scope: { source: "mate", suffix: "database", leaving: "removed", demand: "detail", mode: "once" },
};

export const databaseKey = (environmentId: EnvironmentId, panelId: string): string =>
  `${environmentId}/${panelId}`;
export const databaseScope = (
  environmentId: EnvironmentId,
  panelId: string,
  target = "value",
): ScopeKey =>
  `mate:${encodeURIComponent(environmentId)}:database:${encodeURIComponent(panelId)}/${encodeURIComponent(target)}`;
export const databaseTreeTarget = (path: ZeropsDataConsolePath): string =>
  `tree/${treePathKey(path)}`;

export const emptyDatabasePanel: DatabasePanelValue = {
  kind: "panel",
  services: undefined,
  tree: emptyTree,
  tableModel: emptyTable,
  tableCount: undefined,
  filtered: undefined,
  queryState: undefined,
  blob: undefined,
  documentSearchResult: undefined,
  targets: [],
  latestTarget: undefined,
  gridTarget: undefined,
};

/** The console process's source-owned status; subscribing observes it without starting it. */
export interface DatabaseSessionValue {
  readonly status: import("@t3tools/contracts").ZeropsDataConsoleStatus;
  readonly reason?: string;
}
declare module "../model.ts" {
  interface FamilyValues {
    readonly databaseSession: DatabaseSessionValue;
  }
}
export const databaseSessionFamily: FamilySpec<"databaseSession"> = {
  family: "databaseSession",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "database-session",
    leaving: "removed",
    demand: "detail",
    mode: "realtime",
  },
};
export const databaseSessionScope = (environmentId: EnvironmentId): ScopeKey =>
  `mate:database-session-${encodeURIComponent(environmentId)}:database-session`;
