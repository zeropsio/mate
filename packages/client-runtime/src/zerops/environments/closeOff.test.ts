import { describe, expect, it } from "vite-plus/test";

import type { HqStructure } from "../hq/client.ts";
import { closedOffOf, closeOffGate, closeOffWordOf } from "./closeOff.ts";

// Restores 0.12.3's close-off gate inside the lease model: nobody is let into a Mate before its
// project is closed off, and Finish setup does that. HQ's word alone says closed off (ADR 0002):
// no project tag says it, and no clock stands in for it (2026-10-05). Security review 4, 6 and 10:
// a hold needs a fact. HQ's record saying the project is not closed off holds a Mate with the
// press's marker, or whose marker is not read; HQ saying nothing — down, no official HQ, another
// organization, a project missing from its structure — holds only where this browser knows its
// close-off has not happened.
describe("closeOffGate — whether a Mate may be connected before its project is closed off", () => {
  it.each([
    // Closed off, by HQ's word: let in, whatever its container says.
    { marker: true, closedOff: true, pending: true, want: "connect" },
    { marker: "unread", closedOff: true, pending: false, want: "connect" },
    // No press marker: a Mate made before the press closed projects off.
    { marker: false, closedOff: false, pending: false, want: "connect" },
    // HQ's record says it is not closed off: held, however old its container.
    { marker: true, closedOff: false, pending: false, want: "open" },
    { marker: "unread", closedOff: false, pending: false, want: "checking" },
    { marker: "unknown", closedOff: false, pending: false, want: "checking" },
    // HQ says nothing: held only on this browser's own evidence.
    { marker: true, closedOff: "unknown", pending: false, want: "connect" },
    { marker: "unread", closedOff: "unknown", pending: false, want: "connect" },
    { marker: true, closedOff: "unknown", pending: true, want: "awaiting-hq" },
    { marker: "unread", closedOff: "unknown", pending: true, want: "awaiting-hq" },
    { marker: false, closedOff: "unknown", pending: true, want: "connect" },
  ] as const)(
    "marker $marker, closed off $closedOff, pending here $pending: $want",
    ({ marker, closedOff, pending, want }) => {
      expect(closeOffGate({ marker, closedOff, pendingHere: pending })).toBe(want);
    },
  );
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
    // A project its structure lacks — a view a moment behind — is not known open.
    { case: "missing from HQ's structure", current: true, projectId: "p-none", want: "unknown" },
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
