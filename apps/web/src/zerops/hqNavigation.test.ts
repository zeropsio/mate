import { HQ_SLOW, NOT_READ_HQ, type HqNavigationRead } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import { hqOutage } from "./hqNavigation";

const at = (hour: number, minute: number) => new Date(2026, 9, 2, hour, minute).getTime();
const STRUCTURE = { apps: [], ungrouped: [] };
const read = (over: Partial<HqNavigationRead>): HqNavigationRead => ({
  ...NOT_READ_HQ,
  read: "read",
  structure: STRUCTURE,
  ...over,
});

describe("hqOutage: what the menu says while HQ does not answer", () => {
  it.each<[string, HqNavigationRead, ReturnType<typeof hqOutage>]>([
    ["HQ answers", read({ link: { kind: "live" } }), null],
    ["nothing asked yet", NOT_READ_HQ, null],
    [
      "catching up before it ever read",
      { ...NOT_READ_HQ, read: "reading", retrying: true },
      { kind: "syncing", line: "Reconnecting…", again: false },
    ],
    [
      "refused, in its own words",
      read({ refusal: "Zerops refused HQ." }),
      {
        kind: "refused",
        line: "Zerops refused HQ. Showing what HQ last said.",
        again: true,
      },
    ],
    [
      "slow on a connection that holds, before it ever read",
      { ...NOT_READ_HQ, read: "reading", slow: true },
      { kind: "slow", line: HQ_SLOW, again: false },
    ],
    [
      "refused before it ever read",
      { ...NOT_READ_HQ, read: "reading", refusal: "Zerops refused HQ." },
      { kind: "refused", line: "Zerops refused HQ.", again: true },
    ],
  ])("%s", (_case, navigation, said) => {
    expect(hqOutage(navigation, "24-hour", at(14, 20))).toEqual(said);
  });
});
