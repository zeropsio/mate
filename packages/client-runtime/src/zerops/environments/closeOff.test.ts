import { describe, expect, it } from "vite-plus/test";

import type { HqStructure } from "../hq/client.ts";
import { closedOffOf, closeOffGate, closeOffWordOf, zcpYoung } from "./closeOff.ts";

// Restores 0.12.3's close-off gate inside the lease model: nobody is let into a Mate before its
// project is closed off, and Finish setup does that. The gate fails closed on a known open project;
// a young container a press may still be setting up is held quietly until its facts are known; an
// older Mate is never held for a marker or an HQ word nobody can read (pass 28 review).
describe("closeOffGate — whether a Mate may be connected before its project is closed off", () => {
  it.each([
    // HQ says closed off: the Mate is let in, whatever its container says.
    { marker: true, closedOff: true, young: true, want: "connect" },
    { marker: "unread", closedOff: true, young: true, want: "connect" },
    // No press marker: a Mate made before the press closed projects off.
    { marker: false, closedOff: false, young: true, want: "connect" },
    { marker: false, closedOff: "unknown", young: false, want: "connect" },
    // The press's marker on a project HQ says is not closed off: held, and said why.
    { marker: true, closedOff: false, young: true, want: "open" },
    { marker: true, closedOff: false, young: false, want: "open" },
    // HQ's word not current: a young Mate is held quietly, an older one connects.
    { marker: true, closedOff: "unknown", young: true, want: "unsure" },
    { marker: true, closedOff: "unknown", young: false, want: "connect" },
    // Its marker not read yet, or unreadable: the same.
    { marker: "unread", closedOff: false, young: true, want: "unsure" },
    { marker: "unknown", closedOff: false, young: true, want: "unsure" },
    { marker: "unread", closedOff: false, young: false, want: "connect" },
    { marker: "unknown", closedOff: "unknown", young: false, want: "connect" },
  ] as const)(
    "marker $marker, closed off $closedOff, young $young: $want",
    ({ marker, closedOff, young, want }) => {
      expect(closeOffGate({ marker, closedOff, young })).toBe(want);
    },
  );
});

describe("zcpYoung — a container a press may still be setting up", () => {
  const NOW = Date.parse("2026-09-23T10:00:00Z");
  it.each([
    { created: "2026-09-23T09:59:00Z", want: true },
    { created: "2026-09-23T08:01:00Z", want: true },
    { created: "2026-09-23T07:59:00Z", want: false },
    { created: undefined, want: false },
  ])("made $created: $want", ({ created, want }) => {
    expect(zcpYoung(created, NOW)).toBe(want);
  });
});

describe("closedOffOf — HQ's word on a Mate's project being closed off", () => {
  const mate = (closedOff: boolean | undefined) =>
    ({
      projectId: "",
      name: "",
      face: "",
      ...(closedOff === undefined ? {} : { closedOff }),
    }) as never;
  const structure: HqStructure = {
    ungrouped: [
      { projectId: "p-closed", name: "Ada", mate: mate(true) },
      { projectId: "p-open", name: "Bo", mate: mate(false) },
      { projectId: "p-silent", name: "Cy", mate: mate(undefined) },
    ],
    apps: [
      {
        id: "app-1",
        name: "shop",
        projects: [
          { projectId: "p-app-closed", name: "Di", kind: "mate", mate: mate(true) },
          { projectId: "p-stage", name: "stage", kind: "stage", mate: null },
        ],
      },
    ],
  } as never;

  it.each([
    { case: "closed off, HQ's answer now", current: true, projectId: "p-closed", want: true },
    { case: "closed off, in an application", current: true, projectId: "p-app-closed", want: true },
    {
      case: "closed off stays closed off on a stale word",
      current: false,
      projectId: "p-closed",
      want: true,
    },
    { case: "not closed off, HQ's answer now", current: true, projectId: "p-open", want: false },
    { case: "not closed off, a stale word", current: false, projectId: "p-open", want: "unknown" },
    { case: "no record, HQ's answer now", current: true, projectId: "p-none", want: false },
    {
      case: "an older HQ says nothing of it",
      current: true,
      projectId: "p-silent",
      want: "unknown",
    },
    {
      case: "another organization",
      current: true,
      projectId: "p-closed",
      organizationId: "org-2",
      want: "unknown",
    },
  ])("$case: $want", ({ current, projectId, organizationId, want }) => {
    const word = closeOffWordOf("org-1", structure, current);
    expect(closedOffOf(word, organizationId ?? "org-1", projectId)).toBe(want);
  });

  it("knows nothing without a word", () => {
    expect(closedOffOf(null, "org-1", "p-closed")).toBe("unknown");
  });
});
