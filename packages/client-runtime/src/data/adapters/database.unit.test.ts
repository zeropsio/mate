import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { makeAccountStore, readsOfState } from "../store.ts";
import { databasePanel } from "../projections/database.ts";
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
