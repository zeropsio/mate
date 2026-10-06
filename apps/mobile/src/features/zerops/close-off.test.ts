import { describe, expect, it } from "vite-plus/test";
import { type HqMateSetup } from "@t3tools/client-runtime/data";

import { CLOSE_OFF_STOPPED_LINE, checkCloseOff, makeCloseOffFacts } from "./close-off";
import { connectMate } from "./connect";

describe("checkCloseOff — HQ navigation evidence on mobile", () => {
  it.each([
    { name: "unfinished marked setup", closedOff: false, marker: true, verdict: "held" },
    { name: "finished setup", closedOff: true, marker: true, verdict: "clear" },
    { name: "older unmarked Mate", closedOff: false, marker: false, verdict: "clear" },
    { name: "partial marker evidence", closedOff: false, marker: "unknown", verdict: "held" },
    {
      name: "outage or refusal without a prior hold",
      closedOff: "unknown",
      marker: true,
      verdict: "clear",
    },
    { name: "no navigation evidence", closedOff: "unknown", marker: "unknown", verdict: "clear" },
  ] as const)("$name", async ({ closedOff, marker, verdict }) => {
    const facts = makeCloseOffFacts();
    expect(await checkCloseOff(facts, { projectId: "p-mate", setup: { closedOff, marker } })).toBe(
      verdict,
    );
    expect([...facts.read()]).toEqual(verdict === "held" ? ["p-mate"] : []);
  });

  it("retains a known hold through an outage, then releases it on completion evidence", async () => {
    const facts = makeCloseOffFacts();
    const check = (setup: HqMateSetup) => checkCloseOff(facts, { projectId: "p-mate", setup });
    expect(await check({ closedOff: false, marker: true })).toBe("held");
    expect(await check({ closedOff: "unknown", marker: true })).toBe("held");
    expect(await check({ closedOff: true, marker: true })).toBe("clear");
    expect([...facts.read()]).toEqual([]);
  });
});

describe("connectMate — a held Mate says why, and is not connected", () => {
  it("answers with the stopped line before any Connect", async () => {
    const asked: Array<string> = [];
    const result = await connectMate(
      {
        connect: async (key) => {
          asked.push(key);
          return { _tag: "Closed" };
        },
      },
      "p-mate:zcp",
      async () => "held",
    );
    expect([result, asked]).toEqual([{ _tag: "Failed", error: CLOSE_OFF_STOPPED_LINE }, []]);
  });
});
