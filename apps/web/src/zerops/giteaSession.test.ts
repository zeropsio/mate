import { GITEA_OAUTH_CLIENT_PENDING } from "@t3tools/client-runtime/zerops";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ensureGiteaOAuthClientId, GiteaSignInError } from "./giteaSession";

const APP = "https://mate.example.com";

/**
 * A distinct Gitea per case: the client id is memoised per (Gitea, app origin)
 * pair for the life of the tab, which is the behaviour, not a test artefact.
 */
let counter = 0;
function origins(): { readonly giteaOrigin: string; readonly brokerOrigin: string } {
  counter += 1;
  return {
    giteaOrigin: `https://web-${counter}-3000.prg1.zerops.app`,
    brokerOrigin: `https://broker-${counter}-8080.prg1.zerops.app`,
  };
}

function answering(response: { readonly status: number; readonly body?: unknown }) {
  const calls: Array<string> = [];
  const fake = vi.fn((url: string | URL) => {
    calls.push(String(url));
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: () => Promise.resolve(response.body ?? null),
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", fake);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the OAuth client id from the broker", () => {
  it("asks the broker, with no auth, and keeps the id", async () => {
    const where = origins();
    const calls = answering({
      status: 200,
      body: {
        clientId: "c1",
        redirectUris: [`${APP}/gitea/callback`],
        authorizeUrl: `${where.giteaOrigin}/login/oauth/authorize`,
        tokenUrl: `${where.giteaOrigin}/login/oauth/access_token`,
      },
    });

    expect(await ensureGiteaOAuthClientId({ ...where, appOrigin: APP })).toBe("c1");
    // A second ask costs nothing: the registration does not change under a tab.
    expect(await ensureGiteaOAuthClientId({ ...where, appOrigin: APP })).toBe("c1");
    expect(calls).toEqual([`${where.brokerOrigin}/gitea/oauth-client`]);
  });

  it("says the broker is still setting up on a 503", async () => {
    answering({ status: 503, body: { error: "not_registered_yet" } });
    await expect(ensureGiteaOAuthClientId({ ...origins(), appOrigin: APP })).rejects.toThrow(
      GITEA_OAUTH_CLIENT_PENDING,
    );
  });

  it("refuses a registration whose redirect does not come back here", async () => {
    answering({
      status: 200,
      body: { clientId: "c1", redirectUris: ["https://other.example/gitea/callback"] },
    });
    await expect(ensureGiteaOAuthClientId({ ...origins(), appOrigin: APP })).rejects.toBeInstanceOf(
      GiteaSignInError,
    );
  });

  it("says so when the broker does not answer at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await expect(ensureGiteaOAuthClientId({ ...origins(), appOrigin: APP })).rejects.toBeInstanceOf(
      GiteaSignInError,
    );
  });
});
