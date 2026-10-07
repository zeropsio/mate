import { describe, expect, it } from "vite-plus/test";

import {
  onlyTheseCanAddAProject,
  resolveAddProjectVerb,
  finishMateSetupScope,
  finishMateSetupVerb,
  resolveMateRegistration,
  type MateRegistration,
} from "./groupCreation.ts";
import type { ZeropsRegistry } from "./hq/registry.ts";

const ACME: ZeropsRegistry = {
  groups: [
    {
      groupId: "g-acme",
      name: "Acme",
      projects: [{ projectId: "p-fen", kind: "mate" }],
    },
  ],
};

const at = (ms: number) => `@${String(ms)}`;

describe("who may add a project: whom HQ offers making an application", () => {
  it("offers it where HQ does", () => {
    expect(resolveAddProjectVerb({ offer: { kind: "allowed" }, at })).toEqual({ offered: true });
  });

  it("does not offer it to a member who can create projects — the registry is not theirs", () => {
    // The same person IS offered *Add Mate*: making a project is a platform
    // right, writing the registry is not.
    const verb = resolveAddProjectVerb({
      offer: { kind: "refused", reason: "not_structure_writer" },
      admins: [{ id: "cu-9", user: { fullName: "Jan Novák" } }],
      at,
    });
    expect(verb).toEqual({ offered: false, reason: "Only Jan Novák adds a project." });
  });

  it.each([
    [{ kind: "unknown" } as const, "HQ has not said yet."],
    [{ kind: "unavailable", since: 5 } as const, "HQ unavailable since @5."],
  ])("offers it neither before HQ has said nor while it does not answer: %j", (offer, reason) => {
    expect(resolveAddProjectVerb({ offer, at })).toEqual({ offered: false, reason });
  });

  it.each([
    { admins: [], expected: "Only an owner or admin adds a project." },
    {
      admins: [{ id: "a", user: { fullName: "Jan" } }],
      expected: "Only Jan adds a project.",
    },
    {
      admins: [
        { id: "a", user: { fullName: "Jan" } },
        { id: "b", user: { email: "eva@acme.test" } },
      ],
      expected: "Only Jan and eva@acme.test add a project.",
    },
    {
      admins: [
        { id: "a", user: { fullName: "Jan" } },
        { id: "b", user: { fullName: "Eva" } },
        { id: "c", user: { fullName: "Petr" } },
      ],
      expected: "Only Jan, Eva and Petr add a project.",
    },
    // A name nobody can be read for is better absent than guessed at.
    { admins: [{ id: "a" }], expected: "Only an owner or admin adds a project." },
  ])("names who can: $expected", ({ admins, expected }) => {
    expect(onlyTheseCanAddAProject(admins)).toBe(expected);
  });
});

describe("resolveMateRegistration", () => {
  it("is registered once the registry names the project", () => {
    expect(resolveMateRegistration({ registry: ACME, projectId: "p-fen" })).toBe("registered");
  });

  it("waits for an owner for a Mate a member created", () => {
    expect(resolveMateRegistration({ registry: ACME, projectId: "p-new" })).toBe("unplaced");
  });
});

describe("finishMateSetupVerb", () => {
  const HALF_MADE = {
    registration: "registered" as MateRegistration,
    containerMissing: false,
    pressStopped: false,
    closedOffMissing: false,
    pressedElsewhere: false,
    viewerIsAdder: false,
    hasContainer: true,
    containerKnown: true,
    recordMissing: false,
    mayCreateRecord: false,
  };
  it.each([
    { registration: "unplaced" as MateRegistration },
    { recordMissing: true, mayCreateRecord: true },
    { pressStopped: true },
    { keyWider: true, mayEditRecord: true },
  ])("waits for the container read before finishing $registration", (reason) => {
    expect(
      finishMateSetupVerb({
        ...HALF_MADE,
        ...reason,
        writer: true,
        hasContainer: false,
        containerKnown: false,
      }),
    ).toBeUndefined();
  });
  it.each([
    {
      name: "an owner, on a Mate nobody has registered",
      input: { ...HALF_MADE, registration: "unplaced" },
      writer: true,
      expected: "Finish setup",
    },
    {
      name: "an admin, who may write the registry too",
      input: { ...HALF_MADE, registration: "unplaced" },
      writer: true,
      expected: "Finish setup",
    },
    {
      name: "an owner, on a Mate whose container never came",
      input: { ...HALF_MADE, containerMissing: true },
      writer: true,
      expected: "Finish setup",
    },
    {
      name: "an owner, on a Mate whose press in this tab stopped",
      input: { ...HALF_MADE, pressStopped: true },
      writer: true,
      expected: "Finish setup",
    },
    {
      name: "an owner, on a Mate whose press stopped before its close-off was marked",
      input: { ...HALF_MADE, closedOffMissing: true },
      writer: true,
      expected: "Finish setup",
    },
    // A press another browser holds at HQ is still running: its Mate reads unregistered, or not
    // closed off, while it runs, and finishing it then would race it.
    {
      name: "nobody, on a Mate another browser still presses, that nobody has registered yet",
      input: { ...HALF_MADE, registration: "unplaced", pressedElsewhere: true },
      writer: true,
      expected: undefined,
    },
    {
      name: "nobody, on a Mate another browser still presses, whose close-off is not marked yet",
      input: { ...HALF_MADE, closedOffMissing: true, pressedElsewhere: true },
      writer: true,
      expected: undefined,
    },
    {
      name: "an owner, at once, on a Mate whose press in this tab stopped",
      input: { ...HALF_MADE, pressStopped: true, pressedElsewhere: true },
      writer: true,
      expected: "Finish setup",
    },
    // Closing off is all the adder may do, and a Mate with no container has nothing to close off:
    // never reported finished (pass 28 review).
    {
      name: "nobody but an owner or admin, on a Mate whose press stopped before its container",
      input: { ...HALF_MADE, pressStopped: true, viewerIsAdder: true, hasContainer: false },
      writer: false,
      expected: undefined,
    },
    // Closing off needs no registry rights: the member who added it may close it off.
    {
      name: "the member who added it, on a Mate its press left open",
      input: { ...HALF_MADE, closedOffMissing: true, viewerIsAdder: true },
      writer: false,
      expected: "Finish setup",
    },
    {
      name: "another member, on a Mate a press left open",
      input: { ...HALF_MADE, closedOffMissing: true },
      writer: false,
      expected: undefined,
    },
    {
      name: "the member who added it, on a Mate nobody has registered: that is an owner's",
      input: { ...HALF_MADE, registration: "unplaced", viewerIsAdder: true },
      writer: false,
      expected: undefined,
    },
    {
      name: "the member who made it, and cannot finish it",
      input: { ...HALF_MADE, registration: "unplaced" },
      writer: false,
      expected: undefined,
    },
    {
      name: "a BASIC_USER, who may not finish it",
      input: { ...HALF_MADE, containerMissing: true },
      writer: false,
      expected: undefined,
    },
    {
      name: "an owner, on a Mate already whole",
      input: HALF_MADE,
      writer: true,
      expected: undefined,
    },
    // A Mate HQ holds no record of — its record's write failed mid-way, or it sits in no
    // application with none — is finished by whoever HQ's rule lets create its record.
    {
      name: "whoever may create its record, on a Mate HQ holds no record of",
      input: { ...HALF_MADE, recordMissing: true, mayCreateRecord: true },
      writer: false,
      expected: "Finish setup",
    },
    // E2E 2026-10-03 (F6): a press that stopped before its container left a `mate` project in no
    // application, with no container and no record — finished into its container's import.
    {
      name: "an owner, on a Mate in no application whose press stopped before its container",
      input: { ...HALF_MADE, hasContainer: false, recordMissing: true, mayCreateRecord: true },
      writer: true,
      expected: "Finish setup",
    },
    {
      name: "nobody else, on a Mate HQ holds no record of",
      input: { ...HALF_MADE, recordMissing: true },
      writer: true,
      expected: undefined,
    },
    {
      name: "nobody, on a Mate another browser still presses, whose record is not written yet",
      input: { ...HALF_MADE, recordMissing: true, mayCreateRecord: true, pressedElsewhere: true },
      writer: true,
      expected: undefined,
    },
    // ADR 0003's fallout: HQ says its key reads other projects — Finish setup takes that off, at
    // once, for whoever HQ offers editing the Mate's record: the one it tells the key's id to.
    {
      name: "the project's admin, on a Mate whose key reads other projects",
      input: { ...HALF_MADE, keyWider: true, mayEditRecord: true },
      writer: false,
      expected: "Finish setup",
    },
    {
      name: "a registry writer HQ does not offer the Mate's record, on a Mate whose key reads other projects",
      input: { ...HALF_MADE, keyWider: true, mayEditRecord: false },
      writer: true,
      expected: undefined,
    },
    {
      name: "a member, on a Mate whose key reads other projects",
      input: { ...HALF_MADE, keyWider: true, mayEditRecord: false, viewerIsAdder: true },
      writer: false,
      expected: undefined,
    },
    {
      name: "somebody whose role has not been read yet",
      input: { ...HALF_MADE, registration: "unplaced" },
      writer: false,
      expected: undefined,
    },
  ] as const)("offers nothing but the right verb to $name", ({ input, writer, expected }) => {
    expect(finishMateSetupVerb({ ...input, writer })).toBe(expected);
  });
});

// The web review, 2026-10-05: an admin who is also the Mate's adder, while HQ has not said whether
// they write the registry, was offered the close-off alone and its registration skipped unsaid.
describe("finishMateSetupVerb while HQ has not said who writes the registry", () => {
  const HALF_MADE = {
    registration: "registered" as MateRegistration,
    containerMissing: false,
    pressStopped: false,
    closedOffMissing: false,
    pressedElsewhere: false,
    viewerIsAdder: false,
    hasContainer: true,
    containerKnown: true,
    recordMissing: false,
    mayCreateRecord: false,
  };
  it.each([
    [
      "a half-made Mate, whatever the viewer added",
      { ...HALF_MADE, pressStopped: true, viewerIsAdder: true },
      undefined,
    ],
    [
      "a Mate HQ holds no record of, whose record HQ offers",
      { ...HALF_MADE, recordMissing: true, mayCreateRecord: true },
      "Finish setup",
    ],
  ] as const)("waits for HQ on %s", (_, input, expected) => {
    expect(finishMateSetupVerb({ ...input, writer: undefined })).toBe(expected);
  });
});

describe("finishMateSetupScope", () => {
  it.each([
    { writer: true, want: "whole" },
    { writer: false, want: "close-off" },
  ])("a registry writer $writer: $want", ({ writer, want }) => {
    expect(finishMateSetupScope(writer)).toBe(want);
  });
});
