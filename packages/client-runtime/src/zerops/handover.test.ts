import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_ZEROPS_GUI_URL,
  ZEROPS_HANDOVER_APP_MODE,
  ZEROPS_HANDOVER_CALLBACK_PATH,
  buildZeropsAuthorizeUrl,
  readZeropsHandover,
} from "./handover.ts";

const here = { origin: "https://mate.zerops.io", path: "" } as const;

describe("buildZeropsAuthorizeUrl", () => {
  it("names its own origin, base path and a nonce", () => {
    const url = new URL(
      buildZeropsAuthorizeUrl({
        nonce: "nonce-1",
        origin: "https://app-1abc.prg1.zerops.app",
        path: "/mate",
      }),
    );

    expect(url.origin).toBe(DEFAULT_ZEROPS_GUI_URL);
    expect(url.pathname).toBe("/authorize-app");
    expect(url.searchParams.get("app")).toBe(ZEROPS_HANDOVER_APP_MODE);
    expect(url.searchParams.get("origin")).toBe("https://app-1abc.prg1.zerops.app");
    expect(url.searchParams.get("path")).toBe("/mate");
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
    expect(url.searchParams.get("port")).toBeNull();
    expect(url.searchParams.get("project")).toBeNull();
    expect(url.searchParams.get("intent")).toBeNull();
  });

  // Transition: until the new FL is live on app.zerops.io, the old one reads
  // only `state` (and `port`), so the request carries both forms.
  it("carries the same nonce as the old `state`, for the app.zerops.io still live", () => {
    const url = new URL(buildZeropsAuthorizeUrl({ ...here, nonce: "nonce-1" }));
    expect(url.searchParams.get("state")).toBe("nonce-1");
  });

  it("names the project a dev instance belongs to, when it was built with one", () => {
    const url = new URL(
      buildZeropsAuthorizeUrl({
        nonce: "n",
        origin: "https://app-1abc.prg1.zerops.app",
        path: "",
        project: "proj-1",
      }),
    );
    expect(url.searchParams.get("project")).toBe("proj-1");
  });

  it("asks for the sign-up entry when that is what the user pressed", () => {
    const url = new URL(buildZeropsAuthorizeUrl({ ...here, nonce: "nonce-1", intent: "register" }));
    expect(url.searchParams.get("intent")).toBe("register");
  });

  it("targets a different GUI when one is configured", () => {
    const url = new URL(
      buildZeropsAuthorizeUrl({ ...here, nonce: "n", guiBaseUrl: "https://app.zerops.dev/" }),
    );
    expect(url.origin).toBe("https://app.zerops.dev");
    expect(url.pathname).toBe("/authorize-app");
  });

  it("refuses to build a request with no nonce, because the callback could not be checked", () => {
    expect(() => buildZeropsAuthorizeUrl({ ...here, nonce: "  " })).toThrow();
  });
});

describe("readZeropsHandover", () => {
  const session = (over: Record<string, string> = {}) =>
    new URLSearchParams({
      token: "rt-abc",
      nonce: "nonce-1",
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
      `#${new URLSearchParams({ token: "rt", nonce: "n" }).toString()}`,
      "n",
    );
    expect(outcome).toMatchObject({ kind: "session", clientId: null });
  });

  it("tolerates a fragment with or without its leading hash", () => {
    expect(readZeropsHandover(session(), "nonce-1")).toMatchObject({ kind: "session" });
  });

  describe("refuses anything it did not ask for", () => {
    // Every row must come back `mismatched` and must NOT surface the token: a
    // crafted `#token=…` link would otherwise sign this browser into
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
        fragment: `#${session({ nonce: "" })}`,
        expected: "nonce-1",
      },
      {
        name: "an error carrying the wrong nonce",
        fragment: "#error=access_denied&nonce=other",
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
    expect(readZeropsHandover("#error=access_denied&nonce=nonce-1", "nonce-1")).toEqual({
      kind: "declined",
      code: "access_denied",
    });
  });

  it("treats a nonce-matched but tokenless response as a refusal, never as a session", () => {
    // A response that echoes our nonce but carries nothing usable is a failed
    // hand-over, not something to hand to the API client.
    expect(readZeropsHandover("#nonce=nonce-1", "nonce-1")).toEqual({
      kind: "declined",
      code: "invalid_response",
    });
  });

  // Transition: the app.zerops.io still live echoes `state` with a personal
  // token; the new one echoes `nonce` with its session's access token. Both are
  // bearers, so either is a session once the nonce checks out.
  it("accepts the old `state` echo as well as the new `nonce`", () => {
    expect(readZeropsHandover("#token=rt-abc&state=nonce-1", "nonce-1")).toMatchObject({
      kind: "session",
      token: "rt-abc",
    });
    expect(readZeropsHandover("#error=access_denied&state=nonce-1", "nonce-1")).toEqual({
      kind: "declined",
      code: "access_denied",
    });
    expect(readZeropsHandover("#token=rt-abc&state=other", "nonce-1")).toEqual({
      kind: "mismatched",
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

describe("buildZeropsAuthorizeUrl refuses a destination the platform would refuse", () => {
  // The platform builds the callback as origin + path + /zerops/authorized and
  // verifies only the origin, so a path is held to a plain shape here: a
  // malformed one fails at the source rather than at app.zerops.io.
  describe("an origin that is not a bare http(s) origin", () => {
    for (const origin of [
      "",
      "null",
      "https://mate.zerops.io/",
      "https://mate.zerops.io/x",
      "file:///tmp",
      "mate.zerops.io",
    ]) {
      it(JSON.stringify(origin), () => {
        expect(() => buildZeropsAuthorizeUrl({ nonce: "n", origin, path: "" })).toThrow();
      });
    }
  });

  describe("a base path outside ^(/[A-Za-z0-9._-]+)*$", () => {
    for (const path of [
      "/",
      "mate",
      "/mate/",
      "//evil.example",
      "/ma te",
      "/mate?x=1",
      "/a/../b\\c",
    ]) {
      it(JSON.stringify(path), () => {
        expect(() =>
          buildZeropsAuthorizeUrl({ nonce: "n", origin: "https://mate.zerops.io", path }),
        ).toThrow();
      });
    }
  });
});

describe("buildZeropsAuthorizeUrl for the old loopback port", () => {
  // Transition: the app.zerops.io still live finds a dev server only by `port`.
  it("names the loopback port beside the origin", () => {
    const url = new URL(
      buildZeropsAuthorizeUrl({
        nonce: "n",
        origin: "http://localhost:5173",
        path: "",
        loopbackPort: 5173,
      }),
    );
    expect(url.searchParams.get("port")).toBe("5173");
    expect(url.searchParams.get("origin")).toBe("http://localhost:5173");
  });

  describe("refuses a port that is not one", () => {
    for (const port of [0, -1, 65_536, 1.5, Number.NaN]) {
      it(String(port), () => {
        expect(() =>
          buildZeropsAuthorizeUrl({
            nonce: "n",
            origin: "http://localhost",
            path: "",
            loopbackPort: port,
          }),
        ).toThrow();
      });
    }
  });
});
