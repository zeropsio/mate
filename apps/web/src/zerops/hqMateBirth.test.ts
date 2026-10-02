import { HqError, type HqApi } from "@t3tools/client-runtime/zerops/hq";
import { describe, expect, it } from "vite-plus/test";

import { createMateRecord, markClosedOffAtHq, recordMateBirth } from "./hqMateBirth";

/** An HQ that records each write, and refuses the ones `refuse` names with `code`. */
const hqOf = (refuse: Partial<Record<keyof HqApi, string>> = {}) => {
  const writes: Array<string> = [];
  const write = (name: keyof HqApi, line: string) => async (): Promise<void> => {
    const code = refuse[name];
    if (code !== undefined) {
      throw new HqError({ kind: "refused", code, status: 409, message: code });
    }
    writes.push(line);
  };
  const api = {
    createMate: (mate: { readonly projectId: string }) =>
      write("createMate", `record ${mate.projectId}`)(),
    recordStandUp: (projectId: string) => write("recordStandUp", `standup ${projectId}`)(),
    recordClosedOff: (projectId: string) => write("recordClosedOff", `closed-off ${projectId}`)(),
  } as unknown as HqApi;
  return { api, writes };
};

describe("a Mate's birth at HQ", () => {
  it.each([
    { birth: { standUp: true, closedOff: true }, writes: ["standup p1", "closed-off p1"] },
    { birth: { standUp: false, closedOff: true }, writes: ["closed-off p1"] },
    { birth: { standUp: true, closedOff: false }, writes: ["standup p1"] },
    { birth: { standUp: false, closedOff: false }, writes: [] },
  ])("records the ask, then the close-off, as asked: $birth", async ({ birth, writes }) => {
    const hq = hqOf();
    await recordMateBirth(hq.api, "p1", birth);
    expect(hq.writes).toEqual(writes);
  });

  // The close-off step runs before the registration writes the record: a Mate HQ holds no record of
  // yet is marked with it, by the registration after.
  it("leaves a close-off to the registration where HQ holds no record yet", async () => {
    const hq = hqOf({ recordClosedOff: "mate_not_found" });
    await expect(markClosedOffAtHq(hq.api, "p1")).resolves.toBeUndefined();
  });

  it("says any other refusal of the close-off", async () => {
    const hq = hqOf({ recordClosedOff: "forbidden" });
    await expect(markClosedOffAtHq(hq.api, "p1")).rejects.toMatchObject({ code: "forbidden" });
  });

  // Finish setup asked again after the record was written: the record stands.
  it("keeps a record HQ holds already", async () => {
    const hq = hqOf({ createMate: "conflict" });
    await expect(
      createMateRecord(hq.api, { projectId: "p1", name: "Ada", face: "" }),
    ).resolves.toBeUndefined();
  });

  it("says any other refusal of the record", async () => {
    const hq = hqOf({ createMate: "forbidden" });
    await expect(
      createMateRecord(hq.api, { projectId: "p1", name: "Ada", face: "" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
