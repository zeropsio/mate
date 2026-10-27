import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_ZEROPS_API_BASE, ZeropsApiClient, ZeropsApiError } from "./api.ts";
import {
  ZEROPS_CAPTCHA_ERROR_CODE,
  buildZeropsRegistrationBody,
  isZeropsCaptchaRejection,
} from "./registration.ts";

const INPUT = {
  email: "  someone@example.com ",
  password: " keeps spaces ",
  fullName: " Ada Lovelace ",
  organizationName: " Analytical Engines ",
  turnstileToken: "cf-token",
};

describe("buildZeropsRegistrationBody", () => {
  it("sends what the platform requires, and claims a pool project by default", () => {
    expect(buildZeropsRegistrationBody(INPUT)).toEqual({
      email: "someone@example.com",
      password: " keeps spaces ",
      name: "Ada Lovelace",
      accountName: "Analytical Engines",
      languageId: "en",
      claimZcpPool: true,
      token: "cf-token",
    });
  });

  it("always carries the captcha token — the platform enforces it", () => {
    // Measured 2026-08-28: a complete body with no `token` is refused with
    // `cloudflareCaptchaVerificationFailed`, so there is no captcha-less path.
    expect(buildZeropsRegistrationBody(INPUT).token).toBe("cf-token");
  });

  it("can register without claiming, for a signup that is not pool-aware", () => {
    const body = buildZeropsRegistrationBody({ ...INPUT, claimZcpPool: false });
    expect(body.claimZcpPool).toBe(false);
  });
});

describe("ZeropsApiClient.register", () => {
  it("posts to /registration unauthenticated and adopts the session it gets back", async () => {
    const requests: Array<{
      url: string;
      method: string;
      auth: string | null;
      body: string | null;
    }> = [];
    const client = new ZeropsApiClient({
      fetch: (input, init) => {
        requests.push({
          url: input,
          method: init?.method ?? "GET",
          auth: new Headers(init?.headers).get("authorization"),
          body: typeof init?.body === "string" ? init.body : null,
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              auth: { accessToken: "access-1", refreshToken: "refresh-1" },
              user: { id: "user-1", email: "someone@example.com" },
              zcpClaimed: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    });

    const response = await client.register(INPUT);

    expect(response.zcpClaimed).toBe(true);
    expect(client.session?.accessToken).toBe("access-1");
    expect(requests[0]?.url).toBe(`${DEFAULT_ZEROPS_API_BASE}/api/rest/public/registration`);
    expect(requests[0]?.method).toBe("POST");
    // A registration carries no bearer: there is no session yet.
    expect(requests[0]?.auth).toBeNull();
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      claimZcpPool: true,
      languageId: "en",
    });
  });

  it("reports an exhausted pool as a fact, not a failure", async () => {
    const client = new ZeropsApiClient({
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              auth: { accessToken: "access-1" },
              user: { id: "user-1", email: "someone@example.com" },
              zcpClaimed: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    });

    const response = await client.register(INPUT);

    expect(response.zcpClaimed).toBe(false);
    expect(client.session?.accessToken).toBe("access-1");
  });
});

describe("isZeropsCaptchaRejection", () => {
  it("recognises the platform's captcha refusal", () => {
    // Live shape, 2026-08-28: a complete body with no Turnstile token is
    // refused by the captcha layer, not by field validation.
    expect(
      isZeropsCaptchaRejection(
        new ZeropsApiError(
          "Cloudflare captcha verification failed. Please try again.",
          "invalid-input",
          400,
          ZEROPS_CAPTCHA_ERROR_CODE,
        ),
      ),
    ).toBe(true);
  });

  it("does not mistake an ordinary validation failure for it", () => {
    expect(
      isZeropsCaptchaRejection(
        new ZeropsApiError("field is required", "invalid-input", 400, "invalidUserInput"),
      ),
    ).toBe(false);
    expect(isZeropsCaptchaRejection(new Error("boom"))).toBe(false);
    expect(isZeropsCaptchaRejection(null)).toBe(false);
  });

  it("refuses to send a registration with no captcha token", async () => {
    const client = new ZeropsApiClient({
      fetch: () => {
        throw new Error("no request may be made without a captcha token");
      },
    });

    const error = await client
      .register({ ...INPUT, turnstileToken: "" })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ZeropsApiError);
    expect(isZeropsCaptchaRejection(error)).toBe(true);
  });
});
