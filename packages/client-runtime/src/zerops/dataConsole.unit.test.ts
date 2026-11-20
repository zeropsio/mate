import type { ZeropsDataConsoleNode, ZeropsDataConsoleService } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  applyTreePage,
  buildDataMentionEntries,
  buildFilteredTableStatement,
  collapsedPrefix,
  emptyTree,
} from "./dataConsole.ts";

const browsableService = (hostname: string): ZeropsDataConsoleService => ({
  hostname,
  type: "postgresql@16",
  family: "sql",
  support: "full",
  actions: [{ id: "readTable", enabled: true, readOnly: true, reason: "" }],
  status: "running",
});

const node = (
  kind: "tabular" | "container",
  service: string,
  segments: ReadonlyArray<string>,
): ZeropsDataConsoleNode => ({
  name: segments[segments.length - 1] ?? service,
  kind,
  path: { service, segments },
  hasChildren: kind === "container",
});

// witness: packages/client-runtime/src/zerops/dataConsole.ts | const token = `${service.hostname}.${visible.join(".")}`; → const token = fullToken;
it("ZV96: A table under a database's only schema is mentioned by its short name, and its full path still finds it", () => {
  const entries = buildDataMentionEntries(
    [browsableService("db")],
    [node("tabular", "db", ["public", "orders"])],
    { db: ["public"] },
  );
  const table = entries.find((entry) => entry.kind === "table");
  expect(table?.token).toBe("db.orders");
  expect(table?.aliases).toEqual(["db.public.orders"]);
});

// witness: packages/client-runtime/src/zerops/dataConsole.ts | if (entry.nodes.length !== 1 || entry.nextCursor !== undefined) return prefix; → if (entry.nodes.length < 1 || entry.nextCursor !== undefined) return prefix;
it("ZV97: A database with two schemas keeps each table's schema in its mention, so tables of one name stay apart", () => {
  let tree = applyTreePage(
    emptyTree,
    { service: "db", segments: [] },
    {
      nodes: [node("container", "db", ["public"]), node("container", "db", ["billing"])],
      nextCursor: "",
    },
  );
  for (const schema of ["public", "billing"]) {
    tree = applyTreePage(
      tree,
      { service: "db", segments: [schema] },
      { nodes: [node("tabular", "db", [schema, "orders"])], nextCursor: "" },
    );
  }
  const tables = [
    node("tabular", "db", ["public", "orders"]),
    node("tabular", "db", ["billing", "orders"]),
  ];
  const entries = buildDataMentionEntries([browsableService("db")], tables, {
    db: collapsedPrefix(tree, "db"),
  });
  expect(entries.filter((entry) => entry.kind === "table").map((entry) => entry.token)).toEqual([
    "db.public.orders",
    "db.billing.orders",
  ]);
});

// witness: packages/client-runtime/src/zerops/dataConsole.ts | const body = dialect === "mysql" ? value.split("\\").join("\\\\") : value; → const body = value;
it("ZV+5: The data console quotes identifiers per dialect and escapes quotes, backslashes and LIKE wildcards", () => {
  expect(
    buildFilteredTableStatement({
      dialect: "postgresql",
      path: { service: "db", segments: ["public", 'odd"name'] },
      filters: [
        { column: 'we"ird', op: "contains", value: "50%_off!" },
        { column: "note", op: "eq", value: String.raw`it's a \ path` },
      ],
    }),
  ).toBe(
    String.raw`SELECT * FROM "public"."odd""name" WHERE "we""ird" LIKE '%50!%!_off!!%' ESCAPE '!' AND "note" = 'it''s a \ path'`,
  );
  expect(
    buildFilteredTableStatement({
      dialect: "mysql",
      path: { service: "db", segments: ["shop", "odd`name"] },
      filters: [
        { column: "we`ird", op: "startsWith", value: "a_b" },
        { column: "note", op: "eq", value: String.raw`it's a \ path` },
      ],
    }),
  ).toBe(
    "SELECT * FROM `shop`.`odd``name` WHERE `we``ird` LIKE 'a!_b%' ESCAPE '!' AND `note` = " +
      String.raw`'it''s a \\ path'`,
  );
});
