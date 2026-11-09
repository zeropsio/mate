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
      "away past its budget",
      read({ link: { kind: "unreachable", since: at(14, 5) } }),
      {
        kind: "last-known",
        line: "HQ is not reachable since 14:05 — showing what it last said. Reconnecting…",
        again: true,
      },
    ],
    [
      "restarting within a deploy's span",
      read({ link: { kind: "restarting", since: at(14, 19) } }),
      null,
    ],
    [
      "catching up before it ever read",
      { ...NOT_READ_HQ, read: "reading", retrying: true },
      { kind: "syncing", line: "Reconnecting…", again: false },
    ],
    [
      "its first retries as far apart as they get",
      { ...NOT_READ_HQ, read: "reading", retrying: true, capped: true },
      { kind: "unavailable", line: "HQ unavailable. Retrying every minute.", again: true },
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
