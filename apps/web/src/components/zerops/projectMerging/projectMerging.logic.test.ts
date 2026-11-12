/**
 * Who merges a project's changes, as its page says and sets it: the row's line, the checklist an
 * Owner or Admin picks from, and when Save has anything to send.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  draftPicked,
  draftSends,
  mergingDraft,
  mergingLine,
  mergingPeople,
  mergingSave,
  shownMergers,
} from "./projectMerging.logic";

const member = (id: string, fullName: string, roleCode: string, status = "ACTIVE") => ({
  id: `cu-${id}`,
  status,
  roleCode,
  user: { id: `u-${id}`, fullName },
});

const MEMBERS = [
  member("sam", "Sam Rivers", "BASIC_USER"),
  member("teo", "Teo Hartmann", "ADMIN"),
  member("ada", "Ada Keller", "NO_ACCESS"),
  member("mira", "Mira Osei", "OWNER"),
  member("ines", "Ines Brandt", "BASIC_USER", "WAITING_AUTHORIZATION"),
];

describe("the Merging row's line", () => {
  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | if (people === null) return "Everyone working here can merge"; →
  it("A project that limits nothing says everyone working there can merge", () => {
    expect(mergingLine(null)).toBe("Everyone working here can merge");
  });

  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | people.length === 1 ? "person" : "people" → "people"
  it("A project that limits it says how many people merge beside the Owner and Admins", () => {
    expect(mergingLine(["u-ada", "u-sam"])).toBe("Owner, Admins and 2 people merge");
    expect(mergingLine(["u-ada"])).toBe("Owner, Admins and 1 person merge");
  });

  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | if (people.length === 0) return "Only the Owner and Admins merge"; →
  it("With nobody named it says only the Owner and Admins merge", () => {
    expect(mergingLine([])).toBe("Only the Owner and Admins merge");
  });
});

describe("the people to pick from", () => {
  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)) →
  it("Owners and Admins come first, always merging; everyone else follows by name", () => {
    expect(
      mergingPeople(MEMBERS, []).map(({ name, role, always }) => [name, role, always]),
    ).toEqual([
      ["Mira Osei", "Owner", true],
      ["Teo Hartmann", "Admin", true],
      ["Ada Keller", "Guest", false],
      ["Sam Rivers", "Works on every project", false],
    ]);
  });

  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | .filter(({ member }) => active(member)) →
  it("Someone invited who has not joined cannot be picked", () => {
    expect(mergingPeople(MEMBERS, []).map(({ userId }) => userId)).not.toContain("u-ines");
  });

  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | return [...people, ...left]; → return people;
  it("Someone named who is no longer an active member stays in the list, to be unchecked", () => {
    const people = mergingPeople(MEMBERS, ["u-ada", "u-gone", "u-ines"]);
    expect(people.slice(-2)).toEqual([
      {
        userId: "u-gone",
        name: "Someone no longer in the organization",
        role: "no longer active",
        always: false,
      },
      { userId: "u-ines", name: "Ines Brandt", role: "no longer active", always: false },
    ]);
  });
});

describe("Save", () => {
  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | enabled: !over && !sameMergers(current, sends), → enabled: !over,
  it("Save has nothing to send until the choice or the picks differ from what stands", () => {
    const stands = mergingDraft(["u-ada", "u-sam"]);
    expect(mergingSave(["u-ada", "u-sam"], stands).enabled).toBe(false);
    expect(mergingSave(["u-ada", "u-sam"], draftPicked(stands, "u-sam", false)).enabled).toBe(true);
    expect(mergingSave(["u-ada", "u-sam"], { ...stands, limited: false }).enabled).toBe(true);
  });

  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | draft.limited ? draft.people : null → draft.people
  it("Choosing everyone lifts the limit and keeps the picks for choosing back", () => {
    const everyone = { ...mergingDraft(["u-ada"]), limited: false };
    expect(draftSends(everyone)).toBeNull();
    expect(draftSends({ ...everyone, limited: true })).toEqual(["u-ada"]);
  });

  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | const over = sends !== null && sends.length > HQ_MERGERS_MAX; → const over = false;
  it("More people than HQ takes are not sent, and the section says how many it takes", () => {
    const many = Array.from({ length: 51 }, (_, index) => `u-${String(index)}`);
    expect(mergingSave(null, { limited: true, people: many })).toEqual({
      enabled: false,
      tooMany: "Pick at most 50 people.",
    });
  });
});

describe("what the page shows after its own save", () => {
  // witness: apps/web/src/components/zerops/projectMerging/projectMerging.logic.ts | answer !== null && sameMergers(held, answer.over) ? answer.now : held → held
  it("HQ's answer stands until its navigation says anything else than it said at the answer", () => {
    const answer = { over: null, now: ["u-ada"] };
    expect(shownMergers(null, answer)).toEqual(["u-ada"]);
    expect(shownMergers(["u-sam"], answer)).toEqual(["u-sam"]);
    expect(shownMergers(null, null)).toBeNull();
  });
});
