import { AuthStandardClientScopes } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { remoteHttpClientLayer } from "../rpc/http.ts";
import { ClientPresentation } from "../platform/capabilities.ts";
import { prepareZeropsIdentityRegistration } from "./onboarding.ts";

/** The container's mate, which lives under a path prefix beside code-server. */
const BASE_URL = "https://zcp-26a7-8080.prg1.zerops.app/mate";
const ZEROPS_TOKEN = "a-zerops-access-token";

const CLIENT_PRESENTATION_LAYER = Layer.succeed(
  ClientPresentation,
  ClientPresentation.of({
    metadata: { label: "Zerops Mate Test", deviceType: "desktop", os: "Test OS" },
    scopes: AuthStandardClientScopes,
  }),
);

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** Header values, flattened for a substring check without serializing them. */
function headerText(init: RequestInit): string {
  if (!init.headers) return "";
  return [...new Headers(init.headers).entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
}

/** The HTTP client sends encoded bodies, so a raw `String()` yields byte codes. */
function bodyText(init: RequestInit): string {
  const body = init.body;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  return "";
}

function zeropsHttpLayer(calls: Array<Call>, options?: { readonly identityStatus?: number }) {
  const fetchFn = ((input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/.well-known/t3/environment")) {
      return Promise.resolve(
        Response.json({
          environmentId: "environment-zerops",
          label: "z3-eval",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "0.0.35",
          capabilities: { repositoryIdentity: true },
        }),
      );
    }

    if (url.endsWith("/api/auth/zerops-identity")) {
      if (options?.identityStatus !== undefined) {
        return Promise.resolve(
          Response.json(
            {
              _tag: "EnvironmentOperationForbiddenError",
              code: "operation_forbidden",
              reason: "zerops_project_membership_required",
              traceId: "trace-1",
            },
            { status: options.identityStatus },
          ),
        );
      }
      return Promise.resolve(
        Response.json({
          id: "grant-1",
          credential: "a-pairing-credential",
          label: "Zerops OWNER",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      );
    }

    if (url.endsWith("/oauth/token")) {
      return Promise.resolve(
        Response.json({
          access_token: "bearer-token",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: AuthStandardClientScopes.join(" "),
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected request: ${url}`));
  }) satisfies typeof fetch;

  return remoteHttpClientLayer(fetchFn);
}

describe("Zerops identity onboarding", () => {
  it.effect("turns a Zerops session into an ordinary bearer registration", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];

      const registration = yield* prepareZeropsIdentityRegistration({
        httpBaseUrl: BASE_URL,
        zeropsToken: ZEROPS_TOKEN,
      }).pipe(Effect.provide(Layer.mergeAll(CLIENT_PRESENTATION_LAYER, zeropsHttpLayer(calls))));

      expect(registration).toMatchObject({
        _tag: "BearerConnectionRegistration",
        target: { environmentId: "environment-zerops", label: "z3-eval" },
        credential: { token: "bearer-token" },
      });
      // Every derived URL keeps the container's path prefix; overwriting it
      // would aim the client at code-server's root on the same origin.
      expect(registration.profile.httpBaseUrl).toBe(`${BASE_URL}/`);
      expect(registration.profile.wsBaseUrl).toBe("wss://zcp-26a7-8080.prg1.zerops.app/mate/");
    }),
  );

  it.effect("mints the grant, then exchanges it the ordinary way", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];

      yield* prepareZeropsIdentityRegistration({
        httpBaseUrl: BASE_URL,
        zeropsToken: ZEROPS_TOKEN,
      }).pipe(Effect.provide(Layer.mergeAll(CLIENT_PRESENTATION_LAYER, zeropsHttpLayer(calls))));

      const urls = calls.map((call) => call.url);
      expect(urls).toEqual([
        `${BASE_URL}/.well-known/t3/environment`,
        `${BASE_URL}/api/auth/zerops-identity`,
        `${BASE_URL}/oauth/token`,
      ]);

      // The exchange carries the minted grant, not the Zerops token.
      const exchange = calls.at(-1);
      expect(exchange ? bodyText(exchange.init) : "").toContain("a-pairing-credential");
    }),
  );

  it.effect("puts the Zerops token in the identity request and nowhere else", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];

      yield* prepareZeropsIdentityRegistration({
        httpBaseUrl: BASE_URL,
        zeropsToken: ZEROPS_TOKEN,
      }).pipe(Effect.provide(Layer.mergeAll(CLIENT_PRESENTATION_LAYER, zeropsHttpLayer(calls))));

      const carrying = calls.filter(
        (call) =>
          bodyText(call.init).includes(ZEROPS_TOKEN) ||
          headerText(call.init).includes(ZEROPS_TOKEN),
      );

      expect(carrying).toHaveLength(1);
      expect(carrying[0]?.url).toBe(`${BASE_URL}/api/auth/zerops-identity`);
      // It is the subject being proven, not a bearer for that request.
      expect(carrying[0] ? headerText(carrying[0].init) : "").not.toContain(ZEROPS_TOKEN);
    }),
  );

  it.effect("fails without registering anything when the account is not a member", () =>
    Effect.gen(function* () {
      const calls: Array<Call> = [];

      const error = yield* prepareZeropsIdentityRegistration({
        httpBaseUrl: BASE_URL,
        zeropsToken: ZEROPS_TOKEN,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            CLIENT_PRESENTATION_LAYER,
            zeropsHttpLayer(calls, { identityStatus: 403 }),
          ),
        ),
        Effect.flip,
      );

      // Not a member is a permanent refusal, so it must not look transient —
      // a "try again" would send the user round a loop that cannot succeed.
      expect(error).toMatchObject({ _tag: "ConnectionBlockedError", reason: "permission" });
      // It stops at the door: no token exchange was attempted.
      expect(calls.map((call) => call.url)).not.toContain(`${BASE_URL}/oauth/token`);
    }),
  );
});
