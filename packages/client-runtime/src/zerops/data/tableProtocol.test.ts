import { describe, expect, it } from "@effect/vitest";

import { directTicket, organization } from "./__fixtures__/index.ts";
import { serviceVariablesDescriptor } from "./entityTable.ts";
import { decodeTableSearch } from "./tableProtocol.ts";
import type { TableQueryDescriptor } from "./types.ts";

const variables = serviceVariablesDescriptor(organization, [
  "s-1",
  "s-2",
  "service",
  "service-a",
  "app",
  "mate",
]);
const ticketFor = (descriptor: TableQueryDescriptor) =>
  directTicket({ kind: "query", descriptor } as never);

describe("a table search's answer", () => {
  it.each([
    ["no items", {}],
    ["items that are not a list", { items: null }],
  ])("with %s answers a read by id as finding none of its ids", (_, envelope) => {
    const decoded = decodeTableSearch(ticketFor({ ...variables, ids: ["v-1", "v-2"] }), envelope);
    expect(decoded.observations).toMatchObject([{ kind: "table-rows-observed", rows: [] }]);
  });

  it("with no items says nothing of a whole list", () => {
    const decoded = decodeTableSearch(ticketFor(variables), {});
    expect(decoded.observations).toEqual([]);
    expect(decoded.issues).toMatchObject([{ kind: "malformed-envelope" }]);
  });
});
