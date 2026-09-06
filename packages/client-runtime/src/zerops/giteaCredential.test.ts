import { describe, expect, it } from "vite-plus/test";

import {
  GITEA_REPO_ENV_KEY,
  GITEA_TOKEN_ENV_KEY,
  GITEA_URL_ENV_KEY,
  giteaTokenName,
  planGiteaCredential,
} from "./giteaCredential.ts";

const ORIGIN = "https://web-2fe9-3000.prg1.zerops.app";

/** What a service read gives back: a sensitive value is never the value. */
const SETTLED = {
  [GITEA_URL_ENV_KEY]: ORIGIN,
  [GITEA_TOKEN_ENV_KEY]: "REDACTED",
  [GITEA_REPO_ENV_KEY]: "mate/aurora",
};

describe("giteaTokenName", () => {
  it.each([
    ["Iris", "mate/Iris"],
    ["  Fen  ", "mate/Fen"],
  ] as const)("names %s's token %s", (bot, expected) => {
    expect(giteaTokenName(bot)).toBe(expected);
  });

  it.each([["", "   "]] as const)("has no name for a Mate called %o", (bot) => {
    expect(giteaTokenName(bot)).toBeUndefined();
  });
});

describe("planGiteaCredential", () => {
  it("refuses to plan for a Mate with no name", () => {
    // A token nobody can attribute is worse than no token.
    expect(planGiteaCredential({ giteaOrigin: ORIGIN, botName: " ", current: {} })).toBeUndefined();
  });

  it("mints and writes everything for a Mate that has nothing", () => {
    const plan = planGiteaCredential({
      giteaOrigin: ORIGIN,
      botName: "Iris",
      repository: "mate/aurora",
      current: {},
    });

    expect(plan).toEqual({
      upToDate: false,
      mintTokenNamed: "mate/Iris",
      write: [GITEA_URL_ENV_KEY, GITEA_TOKEN_ENV_KEY, GITEA_REPO_ENV_KEY],
      values: { [GITEA_URL_ENV_KEY]: ORIGIN, [GITEA_REPO_ENV_KEY]: "mate/aurora" },
      restart: true,
    });
  });

  it("carries no value for the token: the caller mints it", () => {
    const plan = planGiteaCredential({ giteaOrigin: ORIGIN, botName: "Iris", current: {} });
    expect(plan?.write).toContain(GITEA_TOKEN_ENV_KEY);
    expect(plan?.values).not.toHaveProperty(GITEA_TOKEN_ENV_KEY);
  });

  it("does nothing for a Mate already holding this instance's credential", () => {
    // The token reads REDACTED and is never compared — its presence is the signal.
    expect(
      planGiteaCredential({
        giteaOrigin: ORIGIN,
        botName: "Iris",
        repository: "mate/aurora",
        current: SETTLED,
      }),
    ).toEqual({ upToDate: true, write: [], values: {}, restart: false });
  });

  it("ignores a trailing slash on the instance's origin", () => {
    expect(
      planGiteaCredential({
        giteaOrigin: `${ORIGIN}/`,
        botName: "Iris",
        repository: "mate/aurora",
        current: SETTLED,
      })?.upToDate,
    ).toBe(true);
  });

  it("leaves the repository alone when the caller does not know it", () => {
    const plan = planGiteaCredential({ giteaOrigin: ORIGIN, botName: "Iris", current: SETTLED });
    expect(plan?.upToDate).toBe(true);
  });

  it("moves a Mate to another repository without minting a token", () => {
    const plan = planGiteaCredential({
      giteaOrigin: ORIGIN,
      botName: "Iris",
      repository: "mate/borealis",
      current: SETTLED,
    });

    expect(plan).toEqual({
      upToDate: false,
      write: [GITEA_REPO_ENV_KEY],
      values: { [GITEA_REPO_ENV_KEY]: "mate/borealis" },
      restart: true,
    });
  });

  it("mints again when the instance changed, whatever the old token was", () => {
    // A token belongs to the Gitea that issued it, so a different origin makes
    // the one in place worthless without reading it.
    const plan = planGiteaCredential({
      giteaOrigin: "https://web-9999-3000.prg1.zerops.app",
      botName: "Iris",
      repository: "mate/aurora",
      current: SETTLED,
    });

    expect(plan?.mintTokenNamed).toBe("mate/Iris");
    expect(plan?.write).toEqual([GITEA_URL_ENV_KEY, GITEA_TOKEN_ENV_KEY]);
  });

  it("mints for a Mate that has the instance but no token", () => {
    const plan = planGiteaCredential({
      giteaOrigin: ORIGIN,
      botName: "Iris",
      current: { [GITEA_URL_ENV_KEY]: ORIGIN },
    });

    expect(plan?.mintTokenNamed).toBe("mate/Iris");
    expect(plan?.write).toEqual([GITEA_TOKEN_ENV_KEY]);
  });

  it("always restarts when it writes: an env write reaches new processes only", () => {
    const plan = planGiteaCredential({ giteaOrigin: ORIGIN, botName: "Iris", current: {} });
    expect(plan?.restart).toBe(true);
  });
});
