import { NOT_READ_HQ, type HqNavigationRead } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import { hqOfficialOf, hqOutage } from "./hqNavigation";

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
      { kind: "syncing", line: "Last known · Reconnecting…", again: false },
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
        kind: "unavailable",
        line: "HQ unavailable since 14:05. Retrying every minute.",
        again: true,
      },
    ],
    [
      "refused, in its own words",
      read({ refusal: "Zerops refused HQ." }),
      at(14, 5),
      { kind: "unavailable", line: "Zerops refused HQ. HQ unavailable since 14:05.", again: true },
    ],
  ])("%s", (_case, navigation, downSince, said) => {
    expect(hqOutage(navigation, downSince, "24-hour", at(14, 20))).toEqual(said);
  });
});

describe("hqOfficialOf: whether the organization has an official HQ, as decided", () => {
  const OFFICIAL = { kind: "official", projectId: "p-hq", address: "hq.example:443" } as const;
  it.each([
    ["the kept verdict or the member list names one", "ready", OFFICIAL, true],
    ["the member list names none", "ready", { kind: "none" }, false],
    ["the member list's names are unclear", "ready", { kind: "unclear", projectIds: [] }, false],
    ["the member list is being read", "loading", { kind: "none" }, null],
    ["nothing has been read", "idle", { kind: "none" }, null],
    ["the member list could not be read", "failed", { kind: "none" }, null],
  ] as const)("%s", (_name, status, hq, expected) => {
    expect(hqOfficialOf({ status, hq })).toBe(expected);
  });
});
