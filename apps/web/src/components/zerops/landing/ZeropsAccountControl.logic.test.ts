import { describe, expect, it } from "vite-plus/test";

import { zeropsAccountDisplay, zeropsInitials } from "./ZeropsAccountControl.logic";

describe("zeropsAccountDisplay", () => {
  it.each([
    {
      name: "a full record",
      user: {
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        avatar: {
          smallAvatarUrl: "https://cdn/ada-s.png",
          largeAvatarUrl: "https://cdn/ada-l.png",
        },
      },
      expected: {
        name: "Ada",
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        initials: "AL",
        avatarUrl: "https://cdn/ada-s.png",
      },
    },
    {
      name: "the test account: a first name, no picture",
      user: {
        email: "ales+onboarding@zerops.io",
        fullName: "Aleš",
        firstName: "Aleš",
        lastName: "",
        avatar: { smallAvatarUrl: null, largeAvatarUrl: null, externalAvatarUrl: null },
      },
      expected: {
        name: "Aleš",
        fullName: "Aleš",
        email: "ales+onboarding@zerops.io",
        initials: "A",
        avatarUrl: null,
      },
    },
    {
      name: "names split but never joined by the platform",
      user: { email: "grace@example.com", firstName: " Grace ", lastName: "Hopper", avatar: null },
      expected: {
        name: "Grace",
        fullName: "Grace Hopper",
        email: "grace@example.com",
        initials: "GH",
        avatarUrl: null,
      },
    },
    {
      name: "only an email",
      user: { email: "ops@example.com" },
      expected: {
        name: "ops",
        fullName: null,
        email: "ops@example.com",
        initials: "O",
        avatarUrl: null,
      },
    },
    {
      name: "an external picture when the platform has none of its own",
      user: {
        email: "x@example.com",
        fullName: "Xin Li",
        avatar: { smallAvatarUrl: "  ", externalAvatarUrl: "https://gravatar/x" },
      },
      expected: {
        name: "Xin",
        fullName: "Xin Li",
        email: "x@example.com",
        initials: "XL",
        avatarUrl: "https://gravatar/x",
      },
    },
    {
      name: "nobody",
      user: null,
      expected: { name: "Account", fullName: null, email: null, initials: "A", avatarUrl: null },
    },
  ])("derives the display for $name", ({ user, expected }) => {
    expect(zeropsAccountDisplay(user)).toEqual(expected);
  });

  it("prefers the first name the record splits out over the first word of the full name", () => {
    expect(
      zeropsAccountDisplay({
        email: "m@example.com",
        fullName: "Dr. Mary Jackson",
        firstName: "Mary",
      }).name,
    ).toBe("Mary");
  });
});

describe("zeropsInitials", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["Aleš", "A"],
    ["  Jean  Luc  Picard ", "JP"],
    ["émile zola", "ÉZ"],
    ["", ""],
  ])("turns %j into %j", (source, initials) => {
    expect(zeropsInitials(source)).toBe(initials);
  });
});
