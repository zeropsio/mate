import { describe, expect, it } from "vite-plus/test";

import { CLOSE_OFF_STOPPED_LINE, checkCloseOff, makeCloseOffFacts } from "./close-off";
import { connectMate } from "./connect";

// The phone holds no HQ word. When a person opens a Mate, it reads its project's isolation once
// (no store carries it): a Mate whose container carries the press's marker on a project not closed
// off is held, saying why. No fact, no hold — isolation unknown or unreadable lets it in.
describe("checkCloseOff — a Mate's close-off, read as the person opens it on the phone", () => {
  const run = async (isolation: string | undefined | "fails", marker: boolean | "fails" = true) => {
    const facts = makeCloseOffFacts();
    const reads: Array<string> = [];
    const verdict = await checkCloseOff(facts, {
      projectId: "p-mate",
      readIsolation: async () => {
        reads.push("isolation");
        if (isolation === "fails") throw new Error("down");
        return isolation;
      },
      readMarker: async () => {
        reads.push("marker");
        if (marker === "fails") throw new Error("down");
        return marker;
      },
    });
    return { verdict, held: [...facts.read()], reads };
  };

  it.each([
    {
      case: "not isolated, marked: held",
      isolation: "none",
      marker: true,
      verdict: "held",
      held: ["p-mate"],
    },
    {
      case: "isolated: let in, its marker unread",
      isolation: "service",
      marker: true,
      verdict: "clear",
      held: [],
    },
    {
      case: "not isolated, no marker: an older Mate",
      isolation: "none",
      marker: false,
      verdict: "clear",
      held: [],
    },
    {
      case: "isolation unknown: no hold",
      isolation: undefined,
      marker: true,
      verdict: "clear",
      held: [],
    },
    {
      case: "isolation unreadable: no hold",
      isolation: "fails",
      marker: true,
      verdict: "clear",
      held: [],
    },
    {
      case: "marker unreadable: no hold",
      isolation: "none",
      marker: "fails",
      verdict: "clear",
      held: [],
    },
  ] as const)("$case", async ({ isolation, marker, verdict, held }) => {
    const ran = await run(isolation, marker);
    expect([ran.verdict, ran.held]).toEqual([verdict, held]);
  });

  it("reads the marker only where the project is not isolated", async () => {
    expect((await run("service")).reads).toEqual(["isolation"]);
  });

  it("lets go of a hold once a later open finds it closed off", async () => {
    const facts = makeCloseOffFacts();
    const check = (isolation: string) =>
      checkCloseOff(facts, {
        projectId: "p-mate",
        readIsolation: async () => isolation,
        readMarker: async () => true,
      });
    await check("none");
    expect([...facts.read()]).toEqual(["p-mate"]);
    await check("service");
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
