import { NOT_READ_HQ, type HqNavigationRead } from "@t3tools/client-runtime/data";
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
  it.each<[string, HqNavigationRead, number | null, ReturnType<typeof hqOutage>]>([
    ["HQ answers", read({ live: true }), null, null],
    ["nothing asked yet", NOT_READ_HQ, null, null],
    [
      "catching up on what it read",
      read({ reconnecting: true }),
      at(14, 5),
      {
        kind: "last-known",
        line: "HQ is not reachable since 14:05 — showing what it last said. Reconnecting…",
        again: false,
      },
    ],
    [
      "catching up before it ever read",
      { ...NOT_READ_HQ, read: "reading", reconnecting: true },
      at(14, 5),
      { kind: "syncing", line: "Reconnecting…", again: false },
    ],
    [
      "its retries as far apart as they get",
      read({ reconnecting: true, capped: true }),
      at(14, 5),
      {
        kind: "last-known",
        line: "HQ is not reachable since 14:05 — showing what it last said. Retrying every minute.",
        again: true,
      },
    ],
    [
      "refused, in its own words",
      read({ refusal: "Zerops refused HQ." }),
      at(14, 5),
      {
        kind: "last-known",
        line: "Zerops refused HQ. HQ is not reachable since 14:05 — showing what it last said.",
        again: true,
      },
    ],
    [
      "refused before it ever read",
      { ...NOT_READ_HQ, read: "reading", refusal: "Zerops refused HQ." },
      at(14, 5),
      { kind: "unavailable", line: "Zerops refused HQ. HQ unavailable since 14:05.", again: true },
    ],
  ])("%s", (_case, navigation, downSince, said) => {
    expect(hqOutage(navigation, downSince, "24-hour", at(14, 20))).toEqual(said);
  });
});
