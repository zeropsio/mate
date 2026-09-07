/**
 * The composer's `@` catalog of a Zerops project's data: the services the
 * Data surface can browse and the tables inside them, so typing `@db.orders`
 * offers the table next to the workspace's files.
 *
 * The catalog is read once per project for the session and kept in memory —
 * a schema listing is small, changes rarely, and a mention menu must answer
 * on the keystroke rather than wait for a round trip. A failure is absorbed
 * into `failed`: the composer keeps offering files and simply has no data
 * entries to add. A project that is not a Zerops one never gets here, because
 * nothing calls `load` until its Data session reports `ready`.
 */
import {
  buildDataMentionEntries,
  type DataMentionEntry,
  resolveServiceAffordances,
} from "@t3tools/client-runtime/zerops/dataConsole";
import type {
  EnvironmentId,
  ZeropsDataConsoleNode,
  ZeropsDataConsoleRequest,
  ZeropsDataConsoleResponse,
  ZeropsDataConsoleService,
} from "@t3tools/contracts";
import { create } from "zustand";

/** Bounds on one project's catalog, so a pathological schema cannot stall the menu. */
const MAX_SERVICES = 20;
const MAX_TABLES_PER_SERVICE = 200;

export type DataCatalogStatus = "loading" | "ready" | "failed";

export interface DataCatalogEntry {
  readonly status: DataCatalogStatus;
  readonly entries: ReadonlyArray<DataMentionEntry>;
}

/** Issues one Data console request; resolves `undefined` when the call failed. */
export type DataConsoleCaller = (
  request: ZeropsDataConsoleRequest,
) => Promise<ZeropsDataConsoleResponse | undefined>;

interface DataCatalogState {
  readonly byEnvironment: Record<string, DataCatalogEntry>;
  readonly load: (environmentId: EnvironmentId, call: DataConsoleCaller) => Promise<void>;
}

async function collectTabularNodes(
  service: ZeropsDataConsoleService,
  call: DataConsoleCaller,
): Promise<ReadonlyArray<ZeropsDataConsoleNode>> {
  const root = await call({ kind: "tree", path: { service: service.hostname, segments: [] } });
  if (root?.kind !== "tree") return [];
  const tables: ZeropsDataConsoleNode[] = [];
  for (const node of root.nodes) {
    if (tables.length >= MAX_TABLES_PER_SERVICE) break;
    if (node.kind === "tabular") {
      tables.push(node);
      continue;
    }
    // One more level only: a schema holds tables, and a deeper walk would
    // cost a round trip per container for entries nobody mentions.
    if (node.kind !== "container" || !node.hasChildren) continue;
    const children = await call({ kind: "tree", path: node.path });
    if (children?.kind !== "tree") continue;
    for (const child of children.nodes) {
      if (tables.length >= MAX_TABLES_PER_SERVICE) break;
      if (child.kind === "tabular") tables.push(child);
    }
  }
  return tables;
}

export const useZeropsDataCatalogStore = create<DataCatalogState>((set, get) => ({
  byEnvironment: {},
  load: async (environmentId, call) => {
    if (get().byEnvironment[environmentId] !== undefined) return;
    const write = (entry: DataCatalogEntry) => {
      set((state) => ({ byEnvironment: { ...state.byEnvironment, [environmentId]: entry } }));
    };
    write({ status: "loading", entries: [] });
    try {
      // `refresh` re-runs the console's discovery; a plain `services` call
      // answers with whatever existed when the console started, so a service
      // created since would never be offered as a mention.
      const discovered = await call({ kind: "refresh" });
      if (discovered?.kind !== "services") {
        write({ status: "failed", entries: [] });
        return;
      }
      const browsable = discovered.services
        .filter((service) => resolveServiceAffordances(service).canBrowse)
        .slice(0, MAX_SERVICES);
      const tables: ZeropsDataConsoleNode[] = [];
      for (const service of browsable) {
        tables.push(...(await collectTabularNodes(service, call)));
      }
      write({ status: "ready", entries: buildDataMentionEntries(browsable, tables) });
    } catch {
      write({ status: "failed", entries: [] });
    }
  },
}));
