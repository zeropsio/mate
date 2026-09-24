import { describe, expect, it } from "vite-plus/test";

import { zeropsMateOwner } from "./useZeropsMateOwners";

describe("zeropsMateOwner", () => {
  it("is the member's name and the picture the account bar would pick", () => {
    expect(
      zeropsMateOwner({
        id: "cu-jan",
        user: {
          fullName: "Jan Novák",
          avatar: { smallAvatarUrl: null, externalAvatarUrl: "https://cdn/jan.png" },
        },
      }),
    ).toEqual({ name: "Jan Novák", initials: "JN", avatarUrl: "https://cdn/jan.png" });
  });

  it("falls back to initials, and to an e-mail for a name", () => {
    expect(zeropsMateOwner({ id: "cu-q", user: { email: "quiet@example.com" } })).toEqual({
      name: "quiet@example.com",
      initials: "Q",
      avatarUrl: null,
    });
  });

  for (const [name, member] of [
    ["no member at all", undefined],
    ["a member with no user record", { id: "cu-x" }],
    ["a member the platform names nowhere", { id: "cu-blank", user: {} }],
  ] as const) {
    it(`is nobody for ${name}`, () => {
      expect(zeropsMateOwner(member)).toBeUndefined();
    });
  }
});
