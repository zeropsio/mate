import { expect, it } from "vite-plus/test";
import type { AddMateDoor } from "../../zerops/addMateDoor";
import { projectMateOffers } from "./SidebarProjectRow.logic";

// witness: apps/web/src/components/zerops/SidebarProjectRow.logic.ts | automatedMates: input.door.kind === "offered" && input.automatedMates, → automatedMates: input.door.kind === "offered" && true,
it("MN104: a project group offers New Mate and Automated Mates according to its Add door and whether HQ makes automated Mates; breaks: a project offers automation this HQ cannot make or hides an action the viewer may use", () => {
  const cases: ReadonlyArray<{
    door: AddMateDoor;
    automatedMates: boolean;
    expected: { newMate: boolean; automatedMates: boolean };
  }> = [
    {
      door: { kind: "offered" },
      automatedMates: true,
      expected: { newMate: true, automatedMates: true },
    },
    {
      door: { kind: "offered" },
      automatedMates: false,
      expected: { newMate: true, automatedMates: false },
    },
    {
      door: { kind: "off", why: "Ask an Owner" },
      automatedMates: true,
      expected: { newMate: true, automatedMates: false },
    },
    {
      door: { kind: "none" },
      automatedMates: true,
      expected: { newMate: false, automatedMates: false },
    },
    {
      door: { kind: "unknown" },
      automatedMates: true,
      expected: { newMate: false, automatedMates: false },
    },
  ];
  for (const { door, automatedMates, expected } of cases)
    expect(projectMateOffers({ door, automatedMates })).toEqual(expected);
});
