import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_ZEROPS_GUI_URL,
  ZEROPS_HANDOVER_APP_MODE,
  ZEROPS_HANDOVER_CALLBACK_PATH,
  buildZeropsAuthorizeUrl,
  readZeropsHandover,
} from "./handover.ts";

describe("buildZeropsAuthorizeUrl", () => {
  it("names a mode and a nonce, and never a destination", () => {
    // The client never supplies a redirect URL: app.zerops.io maps the mode to
    // a callback from its own registry, so there is nothing to validate and no
    // open-redirect surface. A URL appearing here would be the bug.
    const url = new URL(buildZeropsAuthorizeUrl({ state: "nonce-1" }));

    expect(url.origin).toBe(DEFAULT_ZEROPS_GUI_URL);
    expect(url.pathname).toBe("/authorize-app");
    expect(url.searchParams.get("app")).toBe(ZEROPS_HANDOVER_APP_MODE);
    expect(url.searchParams.get("state")).toBe("nonce-1");
    expect(url.searchParams.get("intent")).toBeNull();
    expect(url.href).not.toContain("http%3A");
  });

  it("asks for the sign-up entry when that is what the user pressed", () => {
    const url = new URL(buildZeropsAuthorizeUrl({ state: "nonce-1", intent: "register" }));
    expect(url.searchParams.get("intent")).toBe("register");
  });

  it("targets a different GUI when one is configured", () => {
    const url = new URL(
      buildZeropsAuthorizeUrl({ state: "n", guiBaseUrl: "https://app.zerops.dev/" }),
    );
    expect(url.origin).toBe("https://app.zerops.dev");
    expect(url.pathname).toBe("/authorize-app");
  });

  it("refuses to build a request with no nonce, because the callback could not be checked", () => {
    expect(() => buildZeropsAuthorizeUrl({ state: "  " })).toThrow();
  });
});

describe("readZeropsHandover", () => {
  const session = (over: Record<string, string> = {}) =>
    new URLSearchParams({
      token: "rt-abc",
      state: "nonce-1",
      clientId: "org-1",
      ...over,
    }).toString();

  it("returns the credential only when the nonce matches the request this tab made", () => {
    const outcome = readZeropsHandover(`#${session()}`, "nonce-1");

    expect(outcome).toEqual({
      kind: "session",
      token: "rt-abc",
      clientId: "org-1",
      zcpClaimed: false,
    });
  });

  it("carries the pool claim so the picker can be skipped for a fresh account", () => {
    const claimed = readZeropsHandover(`#${session({ zcpClaimed: "true" })}`, "nonce-1");
    expect(claimed).toMatchObject({ kind: "session", zcpClaimed: true });

    const notClaimed = readZeropsHandover(`#${session({ zcpClaimed: "false" })}`, "nonce-1");
    expect(notClaimed).toMatchObject({ kind: "session", zcpClaimed: false });
  });

  it("reports no organization rather than an empty one when the platform named none", () => {
    const outcome = readZeropsHandover(
      `#${new URLSearchParams({ token: "rt", state: "n" }).toString()}`,
      "n",
    );
    expect(outcome).toMatchObject({ kind: "session", clientId: null });
  });

  it("tolerates a fragment with or without its leading hash", () => {
    expect(readZeropsHandover(session(), "nonce-1")).toMatchObject({ kind: "session" });
  });

  describe("refuses anything it did not ask for", () => {
    // Every row must come back `mismatched` and must NOT surface the token: a
    // crafted `#refreshToken=…` link would otherwise sign this browser into
    // the attacker's account, and the victim would work inside it.
    const rows: ReadonlyArray<{
      readonly name: string;
      readonly fragment: string;
      readonly expected: string | null;
    }> = [
      { name: "a nonce this tab never issued", fragment: `#${session()}`, expected: "other-nonce" },
      { name: "no nonce stored at all", fragment: `#${session()}`, expected: null },
      { name: "no nonce echoed back", fragment: "#token=rt-abc", expected: "nonce-1" },
      {
        name: "an empty echoed nonce",
        fragment: `#${session({ state: "" })}`,
        expected: "nonce-1",
      },
      {
        name: "an error carrying the wrong nonce",
        fragment: "#error=access_denied&state=other",
        expected: "nonce-1",
      },
    ];

    for (const row of rows) {
      it(row.name, () => {
        const outcome = readZeropsHandover(row.fragment, row.expected);
        expect(outcome).toEqual({ kind: "mismatched" });
        expect(JSON.stringify(outcome)).not.toContain("rt-abc");
      });
    }
  });

  it("reports a refusal the user made, once the nonce proves it is ours", () => {
    expect(readZeropsHandover("#error=access_denied&state=nonce-1", "nonce-1")).toEqual({
      kind: "declined",
      code: "access_denied",
    });
  });

  it("treats a nonce-matched but tokenless response as a refusal, never as a session", () => {
    // A response that echoes our nonce but carries nothing usable is a failed
    // hand-over, not something to hand to the API client.
    expect(readZeropsHandover("#state=nonce-1", "nonce-1")).toEqual({
      kind: "declined",
      code: "invalid_response",
    });
  });

  describe("says nothing is here", () => {
    const rows = ["", "#", "#foo=bar", "#access_token=unrelated"];
    for (const fragment of rows) {
      it(JSON.stringify(fragment), () => {
        expect(readZeropsHandover(fragment, "nonce-1")).toEqual({ kind: "absent" });
      });
    }
  });

  it("pins the callback path both sides agree on", () => {
    expect(ZEROPS_HANDOVER_CALLBACK_PATH).toBe("/zerops/authorized");
  });
});

describe("buildZeropsAuthorizeUrl for local development", () => {
  // A dev server has no fixed port — vite.config.ts sets none, and the ledger
  // records runs on 5733, 5173 and 5190. So the dev mode is the one case where
  // the client contributes to its own destination, narrowed to a port number
  // on a hostname the platform fixes.
  it("asks for the dev mode and names the loopback port", () => {
    const url = new URL(buildZeropsAuthorizeUrl({ state: "n", loopbackPort: 5173 }));

    expect(url.searchParams.get("app")).toBe(ZEROPS_HANDOVER_APP_MODE);
    expect(url.searchParams.get("port")).toBe("5173");
  });

  it("sends no port at all when there is no loopback, so the registered origin is used", () => {
    const url = new URL(buildZeropsAuthorizeUrl({ state: "n" }));
    expect(url.searchParams.get("app")).toBe(ZEROPS_HANDOVER_APP_MODE);
    expect(url.searchParams.get("port")).toBeNull();
  });

  describe("refuses a port that is not one", () => {
    // A corrupted port must fail here rather than silently downgrade to the
    // production destination, which would strand the dev server waiting.
    for (const port of [0, -1, 65_536, 1.5, Number.NaN]) {
      it(String(port), () => {
        expect(() => buildZeropsAuthorizeUrl({ state: "n", loopbackPort: port })).toThrow();
      });
    }
  });
});
