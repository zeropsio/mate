import { expect, it } from "vite-plus/test";
import { HqError, type HqApi } from "../../zerops/hq/client.ts";
import { acquireHqPressLease } from "./executors/hqPressLease.ts";

function refusingReceipt(reason: string) {
  const writes: Parameters<HqApi["holdPress"]>[] = [];
  const api: Pick<HqApi, "holdPress" | "endPress"> = {
    holdPress: async (projectId, body) => {
      writes.push([projectId, body]);
      if (body.importProcessId !== undefined)
        throw new HqError({
          kind: "refused",
          code: "forbidden",
          reason,
          status: 403,
          message: "HQ refused the press write",
        });
    },
    endPress: async () => {},
  };
  return { api, writes };
}

// witness: packages/client-runtime/src/data/operations/executors/hqPressLease.ts | && projectId === held) → && projectId !== held)
it("OP47: A competing press refuses the receipt and lapses the hold", async () => {
  const { api } = refusingReceipt("press_held");
  const hold = acquireHqPressLease(api, null, { kind: "mate" }, "owner-1");
  await hold.take("project-1");
  expect(await hold.imported("service-1")).toBe("refused");
  expect(hold.lapsed()).toBe(true);
});

// witness: packages/client-runtime/src/data/operations/executors/hqPressLease.ts | return outcome.kind; → return outcome.kind === "refused" && !lapsed ? "recorded" : outcome.kind;
it("OP48: A receipt write HQ refused never reports a recovered import as recorded", async () => {
  const { api, writes } = refusingReceipt("not_mate_operator");
  const hold = acquireHqPressLease(api, null, { kind: "mate", appId: "app-1" }, "owner-1");
  expect(await hold.take("project-1")).toBe("held");
  expect(await hold.imported("service-1")).toBe("refused");
  expect(writes.at(-1)).toEqual([
    "project-1",
    expect.objectContaining({ importProcessId: "service-1" }),
  ]);
  await hold.end(false);
});
