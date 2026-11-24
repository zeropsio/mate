import type { StopServiceRow } from "@t3tools/client-runtime/zerops/flow";
import type { ZeropsServiceRow } from "@t3tools/client-runtime/zerops/serviceMap";
import { expect, it } from "vite-plus/test";

import { placeServiceTable } from "./place/place.logic.ts";

const code = (state?: NonNullable<StopServiceRow["job"]>["state"]) =>
  ({
    hostname: "web",
    repository: "shop",
    job: state === undefined ? undefined : { state, line: "", reason: undefined },
  }) as StopServiceRow;
const listed = { service: { hostname: "web", type: "nodejs@22" } } as ZeropsServiceRow;

// witness: apps/web/src/components/zerops/place/place.logic.ts | return { ...row, absent: { add: !open } }; → return { ...row, absent: { add: true } };
it("MN54: A service HQ deploys and Zerops lacks is one row, offering Add only when HQ has no job open for it, and none once Zerops lists it; breaks: the stage lists it twice, or Add creates it again while HQ is adding it", () => {
  const refused = placeServiceTable({
    code: [code("refused")],
    platform: [],
    notInZerops: ["web"],
  });
  expect(refused.slots).toEqual([]);
  expect(refused.rows.map((row) => [row.hostname, row.absent?.add])).toEqual([["web", true]]);
  for (const state of ["queued", "submitting", "building", "unresolved"] as const) {
    const open = placeServiceTable({ code: [code(state)], platform: [], notInZerops: ["web"] });
    expect(open.rows[0]?.absent?.add).toBe(false);
  }
  const arrived = placeServiceTable({
    code: [code()],
    platform: [listed],
    notInZerops: ["web"],
  });
  expect(arrived.rows[0]?.absent).toBeUndefined();
  expect(arrived.slots).toEqual([]);
});
