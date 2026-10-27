import { expect, it } from "vite-plus/test";
import { chiefRegistrationOffered } from "./chiefRegistration.logic";

const eligible = {
  project: { id: "chief", tagList: ["mate", "chief"] },
  own: null,
  maySetUp: true,
  mayObserve: true,
  anotherPersonsChief: false,
  ownershipAnswered: true,
} as const;

it.each([
  ["a tagged unregistered project offers Make this my Chief", {}, true],
  ["a person with a different Chief may register this project", { own: "old-chief" }, true],
  ["unread Chief ownership offers no registration", { ownershipAnswered: false }, false],
  ["an unread project offers no Chief registration", { project: undefined }, false],
  [
    "an ordinary project offers no Chief registration",
    { project: { id: "mate", tagList: ["mate"] } },
    false,
  ],
  ["unknown personal Chief state offers no registration", { own: undefined }, false],
  ["the person's registered Chief offers no registration", { own: "chief" }, false],
  ["a person not offered Chief setup gets no registration control", { maySetUp: false }, false],
  [
    "a person who cannot operate the project gets no registration control",
    { mayObserve: false },
    false,
  ],
  [
    "another person's registered Chief offers no registration",
    { anotherPersonsChief: true },
    false,
  ],
] as const)("%s", (_title, change, expected) => {
  expect(chiefRegistrationOffered({ ...eligible, ...change })).toBe(expected);
});
