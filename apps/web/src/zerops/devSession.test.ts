import { describe, expect, it } from "vite-plus/test";

import { installMateDevSession, type MateDevHost } from "./devSession";

describe("installMateDevSession", () => {
  it("hands an agent's /auth/login session to the tab's adopter, refresh token and all", async () => {
    const host: MateDevHost = {};
    const adopted: unknown[] = [];
    installMateDevSession(host, async (session) => {
      adopted.push(session);
    });

    await host.__mateDev?.adoptSession({ accessToken: "at-1", refreshToken: "rt-1" });

    expect(adopted).toEqual([{ accessToken: "at-1", refreshToken: "rt-1" }]);
  });
});
