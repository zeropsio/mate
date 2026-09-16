import { describe, expect, it } from "vite-plus/test";

import {
  doorThrowawayName,
  giteaThrowawayName,
  isThrowawayName,
  withThrowaway,
  type ZeropsThrowawayPlatform,
} from "./zeropsThrowaway.ts";

const VALUE = "THE-THROWAWAY-VALUE";

function fakePlatform(overrides: Partial<ZeropsThrowawayPlatform> = {}): {
  platform: ZeropsThrowawayPlatform;
  calls: Array<string>;
  bodies: Array<unknown>;
} {
  const calls: Array<string> = [];
  const bodies: Array<unknown> = [];
  return {
    calls,
    bodies,
    platform: {
      mint: (input) => {
        calls.push(`mint:${input.clientId}:${input.name}`);
        bodies.push(input);
        return Promise.resolve({ id: "tok-1", token: VALUE });
      },
      remove: (input) => {
        calls.push(`remove:${input.clientId}:${input.tokenId}`);
        return Promise.resolve();
      },
      ...overrides,
    },
  };
}

describe("throwaway names", () => {
  it.each([
    ["mate-door:proj-1:n1", () => doorThrowawayName("proj-1", "n1")],
    [
      "gitea-signin:web-926-3000.prg1.zerops.app:n1",
      () => giteaThrowawayName("https://web-926-3000.prg1.zerops.app", "n1"),
    ],
    // The host, without the scheme and without a path: it is what the broker
    // compares its own GITEA_PUBLIC_URL against.
    [
      "gitea-signin:web-926-3000.prg1.zerops.app:n1",
      () => giteaThrowawayName("https://web-926-3000.prg1.zerops.app/", "n1"),
    ],
    ["gitea-signin:localhost:3000:n1", () => giteaThrowawayName("http://localhost:3000", "n1")],
  ])("%s", (expected, build) => {
    expect(build()).toBe(expected);
  });

  it("refuses a Gitea URL with no host", () => {
    expect(() => giteaThrowawayName("https://", "n1")).toThrow(/names no Gitea host/u);
  });

  it.each([
    ["mate-door:p:n", true],
    ["gitea-signin:h:n", true],
    ["zcp-Aurora - dev", false],
    ["mate-broker", false],
    // A prefix is not a name.
    ["mate-door", false],
  ])("recognises %s as ours: %s", (name, expected) => {
    expect(isThrowawayName(name)).toBe(expected);
  });
});

describe("withThrowaway", () => {
  it("mints with no grants and no flags, under the name it was given", async () => {
    const { platform, bodies } = fakePlatform();
    await withThrowaway({
      platform,
      clientId: "org-1",
      name: doorThrowawayName("proj-1", "n1"),
      use: () => Promise.resolve("ok"),
    });
    // The mint port carries the org and the name and nothing else: grants and
    // flags are not an option a caller has.
    expect(bodies).toEqual([{ clientId: "org-1", name: "mate-door:proj-1:n1" }]);
  });

  it("hands the value to exactly one callback and returns that callback's answer", async () => {
    const { platform } = fakePlatform();
    const seen: Array<string> = [];
    const answer = await withThrowaway({
      platform,
      clientId: "org-1",
      name: "mate-door:p:n",
      use: (token) => {
        seen.push(token);
        return Promise.resolve({ admitted: true });
      },
    });
    expect(seen).toEqual([VALUE]);
    // The value is not in the result, so a caller cannot keep it by accident.
    expect(JSON.stringify(answer)).not.toContain(VALUE);
  });

  const table: ReadonlyArray<{
    readonly name: string;
    readonly use: () => Promise<unknown>;
    readonly throws: boolean;
  }> = [
    { name: "the receiver admitted the caller", use: () => Promise.resolve("in"), throws: false },
    {
      name: "the receiver refused the caller",
      use: () => Promise.reject(new Error("403 zerops_read_only")),
      throws: true,
    },
    {
      name: "the network never answered",
      use: () => Promise.reject(new TypeError("Failed to fetch")),
      throws: true,
    },
  ];

  it.each(table.map((row) => [row.name, row] as const))(
    "deletes the throwaway after %s",
    async (_name, row) => {
      const { platform, calls } = fakePlatform();
      const run = withThrowaway({
        platform,
        clientId: "org-1",
        name: "mate-door:p:n",
        use: row.use,
      });
      if (row.throws) await expect(run).rejects.toThrow();
      else await run;
      expect(calls).toEqual(["mint:org-1:mate-door:p:n", "remove:org-1:tok-1"]);
    },
  );

  it("does not turn a deletion it could not make into a failed call", async () => {
    // A throwaway has no rights; the start-up sweep is the backstop. Failing
    // a successful sign-in over a leftover row would be the worse trade.
    const orphaned: Array<unknown> = [];
    const { platform } = fakePlatform({
      remove: () => Promise.reject(new Error("429")),
    });
    await expect(
      withThrowaway({
        platform,
        clientId: "org-1",
        name: "mate-door:p:n",
        use: () => Promise.resolve("in"),
        onOrphaned: (cause) => orphaned.push(cause),
      }),
    ).resolves.toBe("in");
    expect(orphaned).toHaveLength(1);
  });

  it("keeps the original failure when the deletion also fails", async () => {
    const { platform } = fakePlatform({ remove: () => Promise.reject(new Error("429")) });
    await expect(
      withThrowaway({
        platform,
        clientId: "org-1",
        name: "mate-door:p:n",
        use: () => Promise.reject(new Error("the door refused")),
      }),
    ).rejects.toThrow("the door refused");
  });

  it("deletes nothing when the mint itself failed", async () => {
    const calls: Array<string> = [];
    const platform: ZeropsThrowawayPlatform = {
      mint: () => Promise.reject(new Error("roleLevelExceeded")),
      remove: (input) => {
        calls.push(`remove:${input.tokenId}`);
        return Promise.resolve();
      },
    };
    await expect(
      withThrowaway({
        platform,
        clientId: "org-1",
        name: "mate-door:p:n",
        use: () => Promise.resolve("never"),
      }),
    ).rejects.toThrow("roleLevelExceeded");
    expect(calls).toEqual([]);
  });
});
