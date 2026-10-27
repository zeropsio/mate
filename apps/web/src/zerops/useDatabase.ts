/** Projection reads and detail intents for Data; no source response reaches a component or hook. */
import {
  databaseCatalog,
  databasePanel,
  databaseServices,
  emptyDatabasePanel,
  databaseMentionContext,
  type DatabasePanelRead,
  type DatabaseReadIntent,
} from "@t3tools/client-runtime/data";
import type {
  DataConsoleServiceRow,
  DataMentionEntry,
} from "@t3tools/client-runtime/zerops/dataConsole";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useContext, useEffect } from "react";
import { RegistryContext } from "@effect/atom-react";
import { useEnvironmentProjectRef } from "./useZeropsFeeds";
import { useAccountDataOptional, useProjection } from "./ZeropsAccountData";

const NO_PANEL: DatabasePanelRead = {
  ...emptyDatabasePanel,
  readStates: {},
  withheld: false,
  detailTarget: "table",
  detailDataTarget: "table",
  detailTable: emptyDatabasePanel.tableModel,
  inventory: [],
  pendingTreeKeys: new Set(),
  tableLoadMorePending: false,
  filteredLoadMorePending: false,
  queryLoadMorePending: false,
  documentSearchLoadMorePending: false,
  errorText: undefined,
  gridNotice: undefined,
  coverage: "unknown",
  settled: false,
  refused: false,
};
const EMPTY_PANEL = Atom.make(NO_PANEL);
const EMPTY_CATALOG = Atom.make({
  status: "loading" as const,
  entries: [] as ReadonlyArray<DataMentionEntry>,
  coverage: "unknown" as const,
  refused: false,
});

export function useDatabasePanel(environmentId: EnvironmentId | null, service: string | null) {
  const panelId = service ?? { kind: "picker" as const };
  const account = useAccountDataOptional();
  const database = account?.database;
  const value = useProjection(
    databasePanel,
    environmentId === null ? null : { environmentId, panelId },
    EMPTY_PANEL,
  );
  useEffect(
    () => () => {
      if (environmentId !== null) database?.release(environmentId, service ?? { kind: "picker" });
    },
    [database, environmentId, service],
  );
  return {
    ...value,
    available: database != null,
    read: (intent: DatabaseReadIntent) =>
      environmentId === null
        ? Promise.resolve()
        : (database?.read(environmentId, panelId, intent) ?? Promise.resolve()),
    update: (intent: Parameters<NonNullable<typeof database>["update"]>[2]) => {
      if (environmentId !== null) database?.update(environmentId, panelId, intent);
    },
  };
}

export function useDatabaseCatalog(environmentId: EnvironmentId | null) {
  return useProjection(databaseCatalog, environmentId, EMPTY_CATALOG);
}

/** Holds lazy catalog demand while a mention is being typed and Data is available. */
export function useDatabaseCatalogDemand(
  environmentId: EnvironmentId | null,
  demanded: boolean,
): void {
  const database = useAccountDataOptional()?.database;
  useEffect(() => {
    if (environmentId !== null && demanded) return database?.demandCatalog(environmentId);
  }, [database, demanded, environmentId]);
}

/** A flow reads the projection only after its sampled detail intent settles. */
export function useDatabaseMentionRead(environmentId: EnvironmentId) {
  const account = useAccountDataOptional();
  const registry = useContext(RegistryContext);
  return async (entry: DataMentionEntry) => {
    if (account?.database == null) return undefined;
    await account.database.mention(environmentId, entry);
    // The projection is read through the account's registry by the host flow; no second result cache.
    const result = registry.get(
      account.data.project(databaseMentionContext, { environmentId, entry }),
    );
    account.database.release(environmentId, { kind: "mention", token: entry.token });
    return result;
  };
}

const EMPTY_SERVICES = Atom.make([] as ReadonlyArray<DataConsoleServiceRow>);
export function useDatabaseServices(environmentId: EnvironmentId | null, service: string | null) {
  const panelId = service ?? { kind: "picker" as const };
  const account = useAccountDataOptional();
  const project = useEnvironmentProjectRef(environmentId);
  return useProjection(
    databaseServices,
    environmentId === null
      ? null
      : {
          environmentId,
          panelId,
          platform:
            project === null
              ? null
              : {
                  orgId: project.organization.organizationId,
                  projectId: project.projectId,
                  viewer: account?.viewer,
                },
        },
    EMPTY_SERVICES,
  );
}
