import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { makeAccountStore, readsOfState } from "../store.ts";
import { databaseCatalog, databasePanel } from "../projections/database.ts";
import { makeDatabaseReads } from "./database.ts";

const env = EnvironmentId.make("database-test");
const service = {
  hostname: "db",
  type: "postgresql",
  family: "sql",
  support: "full",
  actions: [{ id: "readTable", enabled: true, readOnly: true, reason: "" }],
  status: "running",
};
const node = {
  name: "orders",
  kind: "tabular" as const,
  path: { service: "db", segments: ["orders"] },
  hasChildren: false,
};
const services = {
  kind: "services" as const,
  project: { id: "p", name: "p" },
  services: [service],
  allowWrites: false,
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
    store,
    database,
    panel,
    close: () => {
      database.close();
      registry.dispose();
    },
  };
}

describe("database source reads", () => {
  it("stores pages once and fences a superseded read", async () => {
    let finish: ((value: ReturnType<typeof table>) => void) | undefined;
    let calls = 0;
    const f = fixture(() =>
      ++calls === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(table("new")),
    );
    const first = f.database.read(env, "db", {
      request: { kind: "table", path: node.path },
      target: "table",
    });
    await f.database.read(env, "db", {
      request: { kind: "table", path: node.path },
      target: "table",
    });
    finish!(table("old"));
    await first;
    expect(f.panel().tableModel.rows).toEqual([["new"]]);
    f.close();
  });

  it("appends a page without losing the first page", async () => {
    let calls = 0;
    const f = fixture(() =>
      Promise.resolve(++calls === 1 ? table("first", "next") : table("second")),
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

  it.each([
    ["outage", { outcome: "transient", message: "offline" }, false],
    ["refusal", { outcome: "definitive-refusal", message: "denied", code: "unsupported" }, true],
  ] as const)(
    "retains source values during %s with an honest projection",
    async (_name, fault, refused) => {
      let fail = false;
      const f = fixture(() => (fail ? Promise.reject(fault) : Promise.resolve(table("retained"))));
      await f.database.read(env, "db", {
        request: { kind: "table", path: node.path },
        target: "table",
        grid: true,
      });
      fail = true;
      await f.database.read(env, "db", {
        request: { kind: "table", path: node.path },
        target: "table",
        grid: true,
      });
      expect(f.panel().tableModel.rows).toEqual([["retained"]]);
      expect(f.panel().refused).toBe(refused);
      expect(f.panel().settled).toBe(false);
      f.close();
    },
  );

  it("discovers mention tables while reporting incomplete catalog coverage", async () => {
    const f = fixture((_, request) =>
      Promise.resolve(
        request.kind === "refresh" ? services : { kind: "tree", nodes: [node], nextCursor: "more" },
      ),
    );
    await f.database.catalog(env);
    const result = databaseCatalog.derive(readsOfState(f.store.state()), env);
    expect(result.entries.map((entry) => entry.token)).toEqual(["db", "db.orders"]);
    expect(result.coverage).toBe("partial");
    f.close();
  });
});

describe("database lifetime and refusal", () => {
  it("does not retry a refused initial detail on remount or on a rebuilt adapter", async () => {
    let calls = 0;
    const call = () => {
      calls += 1;
      return Promise.reject({ outcome: "definitive-refusal", message: "denied" });
    };
    const f = fixture(call);
    const intent = { request: { kind: "refresh" as const }, target: "services", manual: false };
    await f.database.read(env, "db", intent);
    f.database.release(env, "db");
    await f.database.read(env, "db", intent);
    f.database.close();
    const rebuilt = makeDatabaseReads({ store: f.store, wire: { call } });
    await rebuilt.read(env, "db", intent);
    expect(calls).toBe(1);
    await rebuilt.read(env, "db", { ...intent, manual: true });
    expect(calls).toBe(2);
    rebuilt.close();
    f.close();
  });

  it("orders new samples after retained facts when its host is rebuilt", async () => {
    const f = fixture(() => Promise.resolve(table("first")));
    await f.database.read(env, "db", {
      request: { kind: "table", path: node.path },
      target: "table",
    });
    f.database.close();
    const rebuilt = makeDatabaseReads({
      store: f.store,
      wire: { call: () => Promise.resolve(table("new host")) },
    });
    await rebuilt.read(env, "db", { request: { kind: "table", path: node.path }, target: "table" });
    expect(f.panel().tableModel.rows).toEqual([["new host"]]);
    rebuilt.close();
    f.close();
  });

  it("does not let a closed selection's result populate the next selection", async () => {
    let finish: ((value: ReturnType<typeof table>) => void) | undefined;
    const f = fixture(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.database.read(env, "db", {
      request: { kind: "table", path: node.path },
      target: "table",
    });
    f.database.update(env, "db", { kind: "clear-selection" });
    finish!(table("obsolete"));
    await pending;
    expect(f.panel().tableModel.rows).toEqual([]);
    f.close();
  });
});

it("purges only the refused Mate's database values after owner-proven denial", async () => {
  let deny = false;
  const f = fixture(() =>
    deny
      ? Promise.reject({ outcome: "authoritative-denial", message: "No access" })
      : Promise.resolve(table("protected")),
  );
  const request = { kind: "table" as const, path: node.path };
  await f.database.read(env, "db", { request, target: "table" });
  await f.database.read(env, "other", { request, target: "table" });
  deny = true;
  await f.database.read(env, "db", { request, target: "table" });
  expect(f.panel().tableModel.rows).toEqual([]);
  expect(readsOfState(f.store.state()).fact("database", `${env}/other`).kind).toBe("withheld");
  f.close();
});

it("marks a retained first page as partial until its remaining page is read", async () => {
  const f = fixture(() => Promise.resolve(table("first", "remaining")));
  await f.database.read(env, "db", {
    request: { kind: "table", path: node.path },
    target: "table",
  });
  expect(f.panel().coverage).toBe("partial");
  expect(f.panel().tableModel.nextCursor).toBe("remaining");
  f.close();
});

it("publishes tree pending changes through its keyed projection atom", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let finish:
    | ((response: {
        readonly kind: "tree";
        readonly nodes: ReadonlyArray<never>;
        readonly nextCursor: string;
      }) => void)
    | undefined;
  const reads = makeDatabaseReads({
    store,
    wire: {
      call: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  const atom = store.data.project(databasePanel, { environmentId: env, panelId: "db" });
  expect(registry.get(atom).pendingTreeKeys.size).toBe(0);
  const pending = reads.read(env, "db", {
    request: { kind: "tree", path: node.path },
    target: `tree/${JSON.stringify([node.path.service, ...node.path.segments])}`,
  });
  expect(registry.get(atom).pendingTreeKeys.size).toBe(1);
  finish!({ kind: "tree", nodes: [], nextCursor: "" });
  await pending;
  expect(registry.get(atom).pendingTreeKeys.size).toBe(0);
  reads.close();
  registry.dispose();
});
