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
  // The record comes before the container (F6b), so its birth is the ask alone: the close-off is
  // marked by the press's close-off step, after the isolation it marks — zcp imports the runtimes
  // on the mark.
  it.each([
    { birth: { standUp: true }, writes: ["standup p1"] },
    { birth: { standUp: false }, writes: [] },
  ])("records the ask, as asked, and never the close-off: $birth", async ({ birth, writes }) => {
    const hq = hqOf();
    await recordMateBirth(hq.api, "p1", birth);
    expect(hq.writes).toEqual(writes);
  });

  // A Mate whose attach was refused has no record to mark: Finish setup, which writes its record
  // first, marks it at its own close-off.
  it("marks nothing where HQ holds no record of the Mate", async () => {
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
