import { assert, describe, it } from "@effect/vitest";

import { makeZeropsOriginAllowlist } from "./origin.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";

const CONTAINER_ORIGIN = "https://zcp-26a7-8080.prg1.zerops.app";
const CONTAINER_HOST = "zcp-26a7-8080.prg1.zerops.app";
const SIBLING_ORIGIN = "https://zcp-2338-8080.prg1.zerops.app";

const allowlist = (allowedOrigins: ReadonlyArray<string> = []) =>
  makeZeropsOriginAllowlist(
    resolveZeropsEnvironment({
      projectId: "nTV3oMB2SS634ImDJnQckg",
      apiHost: undefined,
      allowedOrigins,
      membershipTtlSeconds: undefined,
    })!,
  );

describe("allowsOrigin — what a browser may call cross-origin", () => {
  it("allows any localhost port, the product-level dev convenience", () => {
    const { allowsOrigin } = allowlist();
    for (const origin of [
      "http://localhost:5733",
      "http://localhost:1111",
      "https://localhost:8443",
    ]) {
      assert.isTrue(allowsOrigin(origin), origin);
    }
  });

  it("does not extend that to 127.0.0.1 — the trust is on the hostname", () => {
    const { allowsOrigin } = allowlist();
    assert.isFalse(allowsOrigin("http://127.0.0.1:5733"));
  });

  it("rejects a hostname that merely ends in localhost", () => {
    const { allowsOrigin } = allowlist();
    for (const origin of [
      "http://notlocalhost:5733",
      "http://localhost.evil.example",
      "http://evil.example#localhost",
    ]) {
      assert.isFalse(allowsOrigin(origin), origin);
    }
  });

  it("allows the two desktop shell origins", () => {
    const { allowsOrigin } = allowlist();
    assert.isTrue(allowsOrigin("t3code://app"));
    assert.isTrue(allowsOrigin("t3code-dev://app"));
  });

  it("allows Zerops-issued HTTPS origins", () => {
    const { allowsOrigin } = allowlist();
    for (const origin of [SIBLING_ORIGIN, "https://app.zerops.io"]) {
      assert.isTrue(allowsOrigin(origin), origin);
    }
  });

  it("rejects Zerops look-alikes, bare apexes and plain HTTP", () => {
    const { allowsOrigin } = allowlist();
    for (const origin of [
      "https://evilzerops.app",
      "https://zerops.app.evil.example",
      "https://zerops.app",
      "https://.zerops.app",
      "https://..zerops.app",
      "http://sub.zerops.app",
    ]) {
      assert.isFalse(allowsOrigin(origin), origin);
    }
  });

  it("allows a configured extra origin, exactly", () => {
    const { allowsOrigin } = allowlist(["https://console.example.com"]);
    assert.isTrue(allowsOrigin("https://console.example.com"));
    assert.isFalse(allowsOrigin("https://console.example.com.evil.example"));
    assert.isFalse(allowsOrigin("http://console.example.com"));
  });

  it("allows the hosted web client's own origin without any per-container config", () => {
    // TEMPORARY, with the constant it pins: the hosted client has to reach
    // EVERY user's container, so its origin cannot live in the per-container
    // T3CODE_ZEROPS_ALLOWED_ORIGINS. Delete this case together with
    // HOSTED_CLIENT_ORIGINS once the client moves to a Zerops-issued domain.
    const { allowsOrigin } = allowlist();
    // The hosted client now lives on a Zerops domain, so the suffix rule above
    // covers it and no host is hardcoded here any more.
    assert.isTrue(allowsOrigin("https://mate.zerops.io"));
    assert.isFalse(allowsOrigin("http://mate.zerops.io"));
    assert.isFalse(allowsOrigin("https://mate.zerops.io.evil.example"));
  });

  it("rejects a missing origin — the CORS middleware asks about every request", () => {
    // `allowsOrigin` is handed `request.headers["origin"]` verbatim on every
    // response, not only preflights, so an absent header arrives as undefined.
    const { allowsOrigin } = allowlist();
    assert.isFalse(allowsOrigin(undefined));
  });

  it("rejects every other origin", () => {
    // A client served under /mate/ is same-origin with this API and does not need
    // CORS; the Zerops-domain rule still accepts that serialized origin when a
    // proxy arrangement makes the request cross-origin.
    const { allowsOrigin } = allowlist();
    for (const origin of ["https://evil.example", "null", ""]) {
      assert.isFalse(allowsOrigin(origin), origin);
    }
  });
});

describe("allowsUpgrade — what may open the websocket", () => {
  it("allows a request with no Origin at all", () => {
    // A non-browser caller cannot be cross-site request forged, and every
    // script, the desktop shell and the mobile app arrive this way.
    const { allowsUpgrade } = allowlist();
    assert.isTrue(allowsUpgrade({ origin: undefined, host: CONTAINER_HOST }));
    assert.isTrue(allowsUpgrade({ origin: "", host: CONTAINER_HOST }));
  });

  it("allows the container's own origin, matched against the request host", () => {
    const { allowsUpgrade } = allowlist();
    assert.isTrue(allowsUpgrade({ origin: CONTAINER_ORIGIN, host: CONTAINER_HOST }));
  });

  it("allows the container's own origin behind a proxy that forwards the host", () => {
    const { allowsUpgrade } = allowlist();
    assert.isTrue(
      allowsUpgrade({
        origin: CONTAINER_ORIGIN,
        host: "127.0.0.1:3773",
        forwardedHost: CONTAINER_HOST,
      }),
    );
  });

  it("allows a sibling Zerops container origin", () => {
    const { allowsUpgrade } = allowlist();
    assert.isTrue(allowsUpgrade({ origin: SIBLING_ORIGIN, host: CONTAINER_HOST }));
  });

  it("rejects a foreign origin even when the host matches nothing", () => {
    const { allowsUpgrade } = allowlist();
    assert.isFalse(allowsUpgrade({ origin: "https://evil.example", host: CONTAINER_HOST }));
  });

  it("rejects a foreign origin that only shares a suffix with the host", () => {
    const { allowsUpgrade } = allowlist();
    assert.isFalse(
      allowsUpgrade({
        origin: "https://evil.environment.example.com",
        host: "environment.example.com",
      }),
    );
  });

  it("still allows localhost and configured origins", () => {
    const { allowsUpgrade } = allowlist(["https://console.example.com"]);
    assert.isTrue(allowsUpgrade({ origin: "http://localhost:5733", host: CONTAINER_HOST }));
    assert.isTrue(allowsUpgrade({ origin: "https://console.example.com", host: CONTAINER_HOST }));
  });

  it("rejects a malformed origin rather than trying to make sense of it", () => {
    const { allowsUpgrade } = allowlist();
    assert.isFalse(allowsUpgrade({ origin: "not a url", host: CONTAINER_HOST }));
    assert.isFalse(allowsUpgrade({ origin: "null", host: CONTAINER_HOST }));
  });
});
