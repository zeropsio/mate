import { describe, expect, it } from "vite-plus/test";

import { handOverCandidates, handOverOffered, mateKeyRefused } from "./mateHandOver.logic";

const member = (
  userId: string | undefined,
  fullName: string,
  status: string | undefined = "ACTIVE",
) => ({
  id: `cu-${userId ?? fullName}`,
  ...(userId === undefined ? {} : { userId }),
  ...(status === undefined ? {} : { status }),
  user: { ...(userId === undefined ? {} : { id: userId }), fullName, email: `${fullName}@acme.io` },
});

describe("handing a Mate over", () => {
  it("offers it in the Mate's menu where HQ says the person may, and nowhere HQ does not say so", () => {
    expect(handOverOffered({ mayHandOver: true } as never)).toBe(true);
    expect(handOverOffered({ mayHandOver: false } as never)).toBe(false);
    expect(handOverOffered({} as never)).toBe(false);
    expect(handOverOffered(undefined)).toBe(false);
  });

  it("picks among the organization's active members by person id", () => {
    const members = [
      member("u-eva", "Eva"),
      member("u-ann", "Ann"),
      // Invited, not joined: no person to hand it to yet.
      member(undefined, "Pending", "WAITING_TO_ACCEPT"),
      member("u-old", "Old", "SUSPENDED"),
    ];
    expect(handOverCandidates(members)).toEqual([
      { userId: "u-ann", name: "Ann" },
      { userId: "u-eva", name: "Eva" },
    ]);
  });

  it("a Mate whose key Zerops refused says so, with its hand-over as the primary action for whoever HQ says may", () => {
    expect(mateKeyRefused({ keyRefused: true, mayHandOver: true } as never, "Fen")).toEqual({
      headline: "Fen can't connect: Zerops refused its key.",
      sentence: "Hand it over to give it a new key. Whoever you pick becomes its owner.",
      handOver: true,
    });
    expect(mateKeyRefused({ keyRefused: true, mayHandOver: false } as never, "Fen")).toEqual({
      headline: "Fen can't connect: Zerops refused its key.",
      sentence:
        "It connects again once an owner or admin of the organization, or its owner, hands it over.",
      handOver: false,
    });
    // HQ does not say its key was refused: the Mate's page is its own.
    expect(mateKeyRefused({ mayHandOver: true } as never, "Fen")).toBeNull();
  });
});
