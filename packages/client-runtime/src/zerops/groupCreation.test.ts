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
    expect(resolveMateRegistration({ registry: ACME, projectId: "p-new" })).toBe("awaiting-owner");
  });
});

describe("finishMateSetupVerb", () => {
  const HALF_MADE = {
    registration: "registered" as MateRegistration,
    containerMissing: false,
    pressStopped: false,
    closedOffMissing: false,
    pastGrace: true,
    viewerIsAdder: false,
    hasContainer: true,
    recordMissing: false,
    mayCreateRecord: false,
  };
  it.each([
    {
      name: "an owner, on a Mate nobody has registered",
      input: { ...HALF_MADE, registration: "awaiting-owner" },
      writer: true,
      expected: "Finish setup",
    },
    {
      name: "an admin, who may write the registry too",
      input: { ...HALF_MADE, registration: "awaiting-owner" },
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
    // A press may still be running in another browser for two minutes: its Mate reads
    // unregistered, or not closed off, for those seconds, and finishing it then would race it.
    {
      name: "nobody, on a Mate made a moment ago that nobody has registered yet",
      input: { ...HALF_MADE, registration: "awaiting-owner", pastGrace: false },
      writer: true,
      expected: undefined,
    },
    {
      name: "nobody, on a Mate made a moment ago whose close-off is not marked yet",
      input: { ...HALF_MADE, closedOffMissing: true, pastGrace: false },
      writer: true,
      expected: undefined,
    },
    {
      name: "an owner, at once, on a Mate whose press in this tab stopped",
      input: { ...HALF_MADE, pressStopped: true, pastGrace: false },
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
      input: { ...HALF_MADE, registration: "awaiting-owner", viewerIsAdder: true },
      writer: false,
      expected: undefined,
    },
    {
      name: "the member who made it, and cannot finish it",
      input: { ...HALF_MADE, registration: "awaiting-owner" },
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
      name: "nobody, on a Mate made a moment ago whose record is not written yet",
      input: { ...HALF_MADE, recordMissing: true, mayCreateRecord: true, pastGrace: false },
      writer: true,
      expected: undefined,
    },
    {
      name: "somebody whose role has not been read yet",
      input: { ...HALF_MADE, registration: "awaiting-owner" },
      writer: false,
      expected: undefined,
    },
  ] as const)("offers nothing but the right verb to $name", ({ input, writer, expected }) => {
    expect(finishMateSetupVerb({ ...input, writer })).toBe(expected);
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
