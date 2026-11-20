import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { makeAccountStore, readsOfState } from "../store.ts";
import { databaseCatalog, databasePanel } from "../projections/database.ts";
import { makeDatabaseReads } from "./database.ts";

const env = EnvironmentId.make("database-test");
const node = {
  name: "orders",
  kind: "tabular" as const,
  path: { service: "db", segments: ["orders"] },
  hasChildren: false,
};
const table = (row: string, cursor = "") => ({
  kind: "table" as const,
  page: {
    columns: [
      {
        name: "name",
        dataType: "text",
        pk: false,
        editable: false,
        reason: "",
        sortable: true,
        sortReason: "",
      },
    ],
    rows: [[row]],
    nextCursor: cursor,
    rowKeyCols: [],
    bestEffort: false,
    numbered: false,
  },
});

function fixture(call: Parameters<typeof makeDatabaseReads>[0]["wire"]["call"]) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const database = makeDatabaseReads({ store, wire: { call } });
  const panel = () =>
    databasePanel.derive(readsOfState(store.state()), { environmentId: env, panelId: "db" });
  return {
    database,
    panel,
    close: () => {
      database.close();
      registry.dispose();
    },
  };
}

// witness: packages/client-runtime/src/data/adapters/database.ts | cursor === undefined ? emptyTable : value.tableModel → cursor !== undefined ? emptyTable : value.tableModel
it("AD35: A data console page is appended without losing the first page", async () => {
  const f = fixture((_, request) =>
    Promise.resolve(
      request.kind === "table" && request.page?.cursor === "next"
        ? table("second")
        : table("first", "next"),
    ),
  );
  await f.database.read(env, "db", {
    request: { kind: "table", path: node.path },
    target: "table",
  });
  await f.database.read(env, "db", {
    request: { kind: "table", path: node.path, page: { cursor: "next" } },
    target: "table",
    cursor: "next",
  });
  expect(f.panel().tableModel.rows).toEqual([["first"], ["second"]]);
  f.close();
});

// witness: packages/client-runtime/src/data/adapters/database.ts | ...applyDatabaseAnswer(panelAt(environmentId, panelId), intent, response) → ...applyDatabaseAnswer(value, intent, response)
it("AD36: Concurrent inventory and summary reads keep both answers", async () => {
  const f = fixture((_, request) =>
    Promise.resolve(
      request.kind === "summary"
        ? { kind: "summary", maskedConnection: "postgresql://••••@db" }
        : { kind: "tree", nodes: [node], nextCursor: "" },
    ),
  );
  try {
    await Promise.all([
      f.database.read(env, "db", {
        request: { kind: "tree", path: node.path },
        target: "tree/root",
      }),
      f.database.read(env, "db", {
        request: { kind: "summary", service: "db" },
        target: "summary",
      }),
    ]);
    expect(Object.values(f.panel().tree.entries).flatMap((entry) => entry.nodes)).toEqual([node]);
    expect(f.panel().summary?.maskedConnection).toBe("postgresql://••••@db");
  } finally {
    f.close();
  }
});

/** An answer the case releases when it chooses, so a late answer arrives after a newer one. */
function answer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// witness: packages/client-runtime/src/data/adapters/database.ts | const current = () => !closed && attempts.get(scope) === active; → const current = () => !closed;
it("AD+1: A closed data console selection's answer never fills the next selection", async () => {
  const first = answer<ReturnType<typeof table>>();
  const second = answer<ReturnType<typeof table>>();
  const answers = [first, second];
  const f = fixture(() => answers.shift()!.promise);
  try {
    const closedRead = f.database.read(env, "db", {
      request: { kind: "table", path: node.path },
      target: "table",
    });
    f.database.update(env, "db", { kind: "clear-selection" });
    const nextRead = f.database.read(env, "db", {
      request: { kind: "table", path: { service: "db", segments: ["customers"] } },
      target: "table",
    });
    second.resolve(table("customers"));
    await nextRead;
    first.resolve(table("orders"));
    await closedRead;
    expect(f.panel().tableModel.rows).toEqual([["customers"]]);
  } finally {
    f.close();
  }
});

// witness: packages/client-runtime/src/data/adapters/database.ts | if (key.startsWith(`database:${encodeURIComponent(environmentId)}/`)) → if (key.startsWith("database:"))
it("AD+2: An owner-proven denial purges only the refused Mate's database values", async () => {
  const other = EnvironmentId.make("database-test-other");
  let refused = false;
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const database = makeDatabaseReads({
    store,
    wire: {
      call: (environmentId) =>
        refused && environmentId === env
          ? Promise.reject({ outcome: "authoritative-denial", message: "Read access was removed." })
          : Promise.resolve(table("protected")),
    },
  });
  const panel = (environmentId: EnvironmentId) =>
    databasePanel.derive(readsOfState(store.state()), { environmentId, panelId: "db" });
  const intent = { request: { kind: "table", path: node.path }, target: "table" } as const;
  try {
    await database.read(env, "db", intent);
    await database.read(other, "db", intent);
    refused = true;
    await database.read(env, "db", intent);
    expect(panel(env)).toMatchObject({ withheld: true, tableModel: { rows: [] } });
    expect(panel(other)).toMatchObject({ withheld: false, tableModel: { rows: [["protected"]] } });
  } finally {
    database.close();
    registry.dispose();
  }
});

// witness: packages/client-runtime/src/data/adapters/database.ts | if (classifyDatabaseFailure(error).outcome === "authoritative-denial") throw error; → if (classifyDatabaseFailure(error).outcome !== "authoritative-denial") throw error;
it("AD+3: A service whose tree read fails is still offered, with the tables it did read", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const archive = {
    name: "archive",
    kind: "container" as const,
    path: { service: "db", segments: ["archive"] },
    hasChildren: true,
  };
  const database = makeDatabaseReads({
    store,
    wire: {
      call: (_, request) =>
        request.kind === "refresh"
          ? Promise.resolve({
              kind: "services",
              project: { id: "p", name: "p" },
              services: [
                {
                  hostname: "db",
                  type: "postgresql@16",
                  family: "sql",
                  support: "full",
                  actions: [{ id: "readTable", enabled: true, readOnly: true, reason: "" }],
                  status: "running",
                },
              ],
              allowWrites: false,
            })
          : request.kind === "tree" && request.path.segments.length === 0
            ? Promise.resolve({ kind: "tree", nodes: [node, archive], nextCursor: "" })
            : Promise.reject(new Error("The archive schema could not be listed.")),
    },
  });
  try {
    await database.catalog(env);
    const catalog = databaseCatalog.derive(readsOfState(store.state()), env);
    expect(catalog.status).toBe("ready");
    expect(catalog.entries.map((entry) => entry.token)).toEqual(["db", "db.orders"]);
  } finally {
    database.close();
    registry.dispose();
  }
});
