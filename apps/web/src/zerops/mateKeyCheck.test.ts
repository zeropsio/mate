import { describe, expect, it } from "vite-plus/test";

import { checkMateKey, mateKeyCheckOffered } from "./mateKeyCheck";

// Security review 2: an HQ older than this pass keeps no word on a Mate's key. An owner or an
// admin asks, from the Mate's menu, what its key can read: only then is the organization's token
// list read (never on a load, 2026-10-03), and a key that reads other projects is hardened by the
// same harden Finish setup runs.
describe("mateKeyCheckOffered — the check, where HQ keeps no word on a Mate's key", () => {
  it.each([
    { case: "an older Core's record, a writer", mate: { face: "" }, writer: true, want: true },
    { case: "an older Core's record, a member", mate: { face: "" }, writer: false, want: false },
    {
      case: "a Core that says the key is narrow",
      mate: { face: "", keyWider: false },
      writer: true,
      want: false,
    },
    {
      case: "a Core that says it is wider: Finish setup",
      mate: { face: "", keyWider: true },
      writer: true,
      want: false,
    },
    { case: "no record: adopting it hardens", mate: null, writer: true, want: false },
  ])("$case: $want", ({ mate, writer, want }) => {
    expect(mateKeyCheckOffered({ mate, writer })).toBe(want);
  });
});

describe("checkMateKey — what its key reads, and the harden where it reads more", () => {
  const OWN = { projectId: "p-mate", roleCode: "BASIC_USER" as const };
  const run = async (
    projects: ReadonlyArray<{ projectId: string; roleCode: string }>,
    refused = false,
  ) => {
    const calls: Array<string> = [];
    const outcome = await checkMateKey({
      projectId: "p-mate",
      listTokens: async () => {
        calls.push("tokens");
        return [
          {
            id: "tok-1",
            name: "zcp-shop",
            created: "2026-09-01T00:00:00Z",
            projects: projects as never,
          },
        ];
      },
      containerCreated: async () => {
        calls.push("services");
        return "2026-09-02T00:00:00Z";
      },
      harden: async (keyTokenId) => {
        calls.push(`harden ${keyTokenId}`);
        return { keyNotLowered: refused ? "Not allowed." : null };
      },
    });
    return { outcome, calls };
  };

  it("hardens a key that reads other projects, by its id, and says so", async () => {
    expect(await run([OWN, { projectId: "p-prod", roleCode: "READ_ONLY" }])).toEqual({
      outcome: { kind: "narrowed" },
      calls: ["services", "tokens", "harden tok-1"],
    });
  });

  it("writes nothing where its key reads its own project alone", async () => {
    expect(await run([OWN])).toEqual({ outcome: { kind: "own" }, calls: ["services", "tokens"] });
  });

  it("says a key the platform would not let this account lower", async () => {
    expect(
      (await run([OWN, { projectId: "p-prod", roleCode: "READ_ONLY" }], true)).outcome,
    ).toEqual({
      kind: "not-lowered",
      reason: "Not allowed.",
    });
  });
});
