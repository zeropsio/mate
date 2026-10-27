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
  it("names its own origin, base path and nonce", () => {
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
    expect(url.searchParams.get("state")).toBe("nonce-1");
    expect(url.searchParams.get("port")).toBeNull();
    expect(url.searchParams.get("project")).toBeNull();
    expect(url.searchParams.get("intent")).toBeNull();
  });

  it("carries the nonce as `state`, the one name the platform reads it by", () => {
    const url = new URL(buildZeropsAuthorizeUrl({ ...here, nonce: "nonce-1" }));
    expect(url.searchParams.get("state")).toBe("nonce-1");
    expect(url.searchParams.has("nonce")).toBe(false);
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
      state: "nonce-1",
      clientId: "org-1",
      ...over,
    }).toString();

  it("returns the credential only when the nonce matches the request this tab made", () => {
    const outcome = readZeropsHandover(`#${session()}`, "nonce-1");

    // `clientId` was always null and is gone from the contract: an org a
    // fragment names is never read.
    expect(outcome).toEqual({ kind: "session", token: "rt-abc", zcpClaimed: false });
  });

  it("carries the pool claim so the picker can be skipped for a fresh account", () => {
    const claimed = readZeropsHandover(`#${session({ zcpClaimed: "true" })}`, "nonce-1");
    expect(claimed).toMatchObject({ kind: "session", zcpClaimed: true });

    const notClaimed = readZeropsHandover(`#${session({ zcpClaimed: "false" })}`, "nonce-1");
    expect(notClaimed).toMatchObject({ kind: "session", zcpClaimed: false });
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
        fragment: `#${session({ state: "" })}`,
        expected: "nonce-1",
      },
      {
        name: "an error carrying the wrong nonce",
        fragment: "#error=access_denied&state=other",
        expected: "nonce-1",
      },
    ];

    it.each(Array.from(rows, (row) => ({ title: row.name, row })))("$title", ({ row }) => {
      const outcome = readZeropsHandover(row.fragment, row.expected);
      expect(outcome).toEqual({ kind: "mismatched" });
      expect(JSON.stringify(outcome)).not.toContain("rt-abc");
    });
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

  // The platform echoes the nonce as `state` and nothing else: a fragment that
  // names it any other way did not come from a request this tab made.
  it("reads the echoed nonce only from `state`", () => {
    expect(readZeropsHandover("#token=rt-abc&nonce=nonce-1", "nonce-1")).toEqual({
      kind: "mismatched",
    });
  });

  describe("says nothing is here", () => {
    const rows = ["", "#", "#foo=bar", "#access_token=unrelated"];
    it.each(Array.from(rows, (fragment) => ({ title: JSON.stringify(fragment), fragment })))(
      "$title",
      ({ fragment }) => {
        expect(readZeropsHandover(fragment, "nonce-1")).toEqual({ kind: "absent" });
      },
    );
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
    it.each(
      Array.from(
        [
          "",
          "null",
          "https://mate.zerops.io/",
          "https://mate.zerops.io/x",
          "file:///tmp",
          "mate.zerops.io",
        ],
        (origin) => ({ title: JSON.stringify(origin), origin }),
      ),
    )("$title", ({ origin }) => {
      expect(() => buildZeropsAuthorizeUrl({ nonce: "n", origin, path: "" })).toThrow();
    });
  });

  describe("a base path outside ^(/[A-Za-z0-9._-]+)*$", () => {
    it.each(
      Array.from(
        ["/", "mate", "/mate/", "//evil.example", "/ma te", "/mate?x=1", "/a/../b\\c"],
        (path) => ({ title: JSON.stringify(path), path }),
      ),
    )("$title", ({ path }) => {
      expect(() =>
        buildZeropsAuthorizeUrl({ nonce: "n", origin: "https://mate.zerops.io", path }),
      ).toThrow();
    });
  });
});
