import { describe, expect, it } from "vite-plus/test";

import {
  base64UrlEncode,
  buildGiteaAuthorizationRequest,
  createGiteaPkcePair,
  findGiteaOAuthApplication,
  GITEA_OAUTH_APPLICATION_NAME,
  giteaOAuthApplicationBody,
  giteaOAuthRedirectUri,
  giteaRefreshBody,
  giteaTokenExchangeBody,
  readGiteaCallback,
  readGiteaTokenAnswer,
} from "./giteaOAuth.ts";

const APP = "https://mate.example.com";
const GITEA = "https://web-1234-3000.prg1.zerops.app";

/** Counts up, so a pair is reproducible and a second call differs from the first. */
function countingRandom(seed = 0): (into: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> {
  let next = seed;
  return (into) => {
    for (let index = 0; index < into.length; index += 1) into[index] = (next += 1) & 0xff;
    return into;
  };
}

/** Node's own SHA-256, which is what the browser's `crypto.subtle` computes too. */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const { createHash } = await import("node:crypto");
  return Uint8Array.from(createHash("sha256").update(data).digest());
}

describe("base64UrlEncode", () => {
  it.each([
    { bytes: [], expected: "" },
    { bytes: [0x66], expected: "Zg" },
    { bytes: [0x66, 0x6f], expected: "Zm8" },
    { bytes: [0x66, 0x6f, 0x6f], expected: "Zm9v" },
    // The two characters standard base64 spells `+` and `/`, and no padding.
    { bytes: [0xfb, 0xff], expected: "-_8" },
  ])("encodes $bytes without padding", ({ bytes, expected }) => {
    expect(base64UrlEncode(Uint8Array.from(bytes))).toBe(expected);
  });
});

describe("createGiteaPkcePair", () => {
  it("is 43 characters of base64url, and the challenge is the digest of the verifier's ASCII", async () => {
    const pair = await createGiteaPkcePair({ randomBytes: countingRandom(), sha256 });

    expect(pair.method).toBe("S256");
    expect(pair.verifier).toHaveLength(43);
    expect(pair.verifier).toMatch(/^[A-Za-z0-9\-_]+$/u);
    // The digest of the STRING, not of the entropy it came from — the whole
    // distinction RFC 7636 turns on, and the one an authorize step cannot catch.
    const expected = base64UrlEncode(
      await sha256(Uint8Array.from([...pair.verifier].map((c) => c.charCodeAt(0)))),
    );
    expect(pair.challenge).toBe(expected);
  });

  it("gives a different pair every time the entropy differs", async () => {
    const first = await createGiteaPkcePair({ randomBytes: countingRandom(0), sha256 });
    const second = await createGiteaPkcePair({ randomBytes: countingRandom(9), sha256 });
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(second.challenge);
  });
});

describe("buildGiteaAuthorizationRequest", () => {
  it("carries the challenge, the redirect and a state it keeps for the callback", async () => {
    const request = await buildGiteaAuthorizationRequest({
      giteaOrigin: `${GITEA}/`,
      clientId: "client-1",
      appOrigin: `${APP}/`,
      randomBytes: countingRandom(),
      sha256,
    });

    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe(`${GITEA}/login/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-1",
      redirect_uri: `${APP}/gitea/callback`,
      response_type: "code",
      code_challenge_method: "S256",
      state: request.state,
    });
    expect(url.searchParams.get("code_challenge")).not.toBe(request.verifier);
    // Never on the wire: the verifier is what proves the exchange later.
    expect(request.url).not.toContain(request.verifier);
  });
});

describe("readGiteaCallback", () => {
  it.each([
    {
      name: "the code, when the state is the one this session sent",
      search: "?code=abc&state=s1",
      state: "s1",
      expected: { ok: true, code: "abc" },
    },
    {
      name: "a refusal when the state is another request's",
      search: "?code=abc&state=other",
      state: "s1",
      expected: { ok: false, reason: "This sign-in did not start here." },
    },
    {
      name: "a refusal when this session sent no state at all",
      search: "?code=abc&state=s1",
      state: undefined,
      expected: { ok: false, reason: "This sign-in did not start here." },
    },
    {
      name: "Gitea's own error, described",
      search: "?error=access_denied&error_description=You+said+no&state=s1",
      state: "s1",
      expected: { ok: false, reason: "You said no" },
    },
    {
      name: "a refusal when the state matches but there is no code",
      search: "?state=s1",
      state: "s1",
      expected: { ok: false, reason: "Gitea sent no code." },
    },
  ])("reads $name", ({ search, state, expected }) => {
    expect(readGiteaCallback(search, state)).toEqual(expected);
  });

  it("reads a search string with no leading question mark", () => {
    expect(readGiteaCallback("code=abc&state=s1", "s1")).toEqual({ ok: true, code: "abc" });
  });
});

describe("the token endpoint's bodies", () => {
  it("exchanges the code with the verifier and no secret", () => {
    const body = giteaTokenExchangeBody({
      clientId: "client-1",
      code: "the-code",
      verifier: "the-verifier",
      appOrigin: APP,
    });
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
      grant_type: "authorization_code",
      client_id: "client-1",
      code: "the-code",
      code_verifier: "the-verifier",
      redirect_uri: `${APP}/gitea/callback`,
    });
    expect(body).not.toContain("client_secret");
  });

  it("refreshes with the refresh token and no secret", () => {
    const body = giteaRefreshBody({ clientId: "client-1", refreshToken: "r1" });
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
      grant_type: "refresh_token",
      client_id: "client-1",
      refresh_token: "r1",
    });
    expect(body).not.toContain("client_secret");
  });
});

describe("readGiteaTokenAnswer", () => {
  it.each([
    {
      name: "a full answer",
      body: { access_token: "a", refresh_token: "r", expires_in: 3600 },
      expected: { accessToken: "a", refreshToken: "r", expiresIn: 3600 },
    },
    {
      name: "an answer with no refresh token",
      body: { access_token: "a" },
      expected: { accessToken: "a", refreshToken: undefined, expiresIn: undefined },
    },
    { name: "an empty token", body: { access_token: "" }, expected: null },
    { name: "an error envelope", body: { error: "invalid_grant" }, expected: null },
    { name: "nothing at all", body: null, expected: null },
  ])("reads $name", ({ body, expected }) => {
    expect(readGiteaTokenAnswer(body)).toEqual(expected);
  });
});

describe("the OAuth application", () => {
  it("registers a public client with this origin's callback", () => {
    expect(giteaOAuthApplicationBody(`${APP}/`)).toEqual({
      name: GITEA_OAUTH_APPLICATION_NAME,
      redirect_uris: [`${APP}/gitea/callback`],
      confidential_client: false,
    });
  });

  it("derives the redirect from the app's origin, trailing slash or not", () => {
    expect(giteaOAuthRedirectUri(`${APP}//`)).toBe(`${APP}/gitea/callback`);
  });

  const mine = {
    id: 1,
    name: GITEA_OAUTH_APPLICATION_NAME,
    client_id: "c1",
    redirect_uris: [`${APP}/gitea/callback`],
    confidential_client: false,
  };

  it.each([
    { name: "one registered for this very origin", applications: [mine], expected: "c1" },
    { name: "nothing registered at all", applications: [], expected: undefined },
    {
      name: "one of somebody else's applications",
      applications: [{ ...mine, name: "Some CI" }],
      expected: undefined,
    },
    {
      name: "one registered for another origin",
      applications: [{ ...mine, redirect_uris: ["https://other.example/gitea/callback"] }],
      expected: undefined,
    },
    {
      name: "a confidential client, which has a secret this app cannot hold",
      applications: [{ ...mine, confidential_client: true }],
      expected: undefined,
    },
    {
      name: "the right one among several",
      applications: [
        { ...mine, name: "Some CI", client_id: "other" },
        { ...mine, redirect_uris: ["https://other.example/gitea/callback"], client_id: "stale" },
        mine,
      ],
      expected: "c1",
    },
  ])("finds $name", ({ applications, expected }) => {
    expect(findGiteaOAuthApplication(applications, APP)?.client_id).toBe(expected);
  });
});
