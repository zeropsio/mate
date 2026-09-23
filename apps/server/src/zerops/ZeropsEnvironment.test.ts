import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";

import {
  DEFAULT_ZEROPS_API_HOST,
  DEFAULT_ZEROPS_ROLE_RECHECK_SECONDS,
  DEFAULT_ZEROPS_SESSION_MAX_AGE_SECONDS,
  isZeropsEnvironment,
  resolveZeropsApiBaseUrl,
  resolveZeropsEnvironment,
} from "./ZeropsEnvironment.ts";

const input = (overrides?: Partial<Parameters<typeof resolveZeropsEnvironment>[0]>) => ({
  projectId: undefined,
  apiHost: undefined,
  allowedOrigins: [],
  publicOrigin: undefined,
  ...overrides,
});

describe("resolveZeropsEnvironment — the one detection rule", () => {
  it("is off when the project id is absent", () => {
    assert.strictEqual(resolveZeropsEnvironment(input()), undefined);
  });

  it("is off when the project id is blank or whitespace", () => {
    assert.strictEqual(resolveZeropsEnvironment(input({ projectId: "" })), undefined);
    assert.strictEqual(resolveZeropsEnvironment(input({ projectId: "   " })), undefined);
  });

  it("is on for a non-empty project id, and nothing else votes", () => {
    const resolved = resolveZeropsEnvironment(input({ projectId: "nTV3oMB2SS634ImDJnQckg" }));
    assert.isDefined(resolved);
    assert.strictEqual(resolved?.projectId, "nTV3oMB2SS634ImDJnQckg");
  });

  it("trims the project id", () => {
    assert.strictEqual(resolveZeropsEnvironment(input({ projectId: "  abc  " }))?.projectId, "abc");
  });

  it("defaults the API base to the production host", () => {
    assert.strictEqual(
      resolveZeropsEnvironment(input({ projectId: "abc" }))?.apiBaseUrl,
      `https://${DEFAULT_ZEROPS_API_HOST}/api/rest/public`,
    );
  });

  it("carries a devel API host through", () => {
    assert.strictEqual(
      resolveZeropsEnvironment(input({ projectId: "abc", apiHost: "api.app-tatami.zerops.dev" }))
        ?.apiBaseUrl,
      "https://api.app-tatami.zerops.dev/api/rest/public",
    );
  });

  it("defaults the re-check interval and the session cap, and honours overrides", () => {
    const defaults = resolveZeropsEnvironment(input({ projectId: "abc" }))!;
    assert.isTrue(
      Duration.equals(
        defaults.roleRecheckInterval,
        Duration.seconds(DEFAULT_ZEROPS_ROLE_RECHECK_SECONDS),
      ),
    );
    assert.isTrue(
      Duration.equals(
        defaults.sessionMaxAge,
        Duration.seconds(DEFAULT_ZEROPS_SESSION_MAX_AGE_SECONDS),
      ),
    );

    const overridden = resolveZeropsEnvironment(
      input({ projectId: "abc", roleRecheckSeconds: 60, sessionMaxAgeSeconds: 3_600 }),
    )!;
    assert.isTrue(Duration.equals(overridden.roleRecheckInterval, Duration.seconds(60)));
    assert.isTrue(Duration.equals(overridden.sessionMaxAge, Duration.seconds(3_600)));
  });

  it("a configured interval above 300 s is clamped", () => {
    for (const [configured, effective] of [
      [60, 60],
      [300, 300],
      [301, 300],
      [3_600, 300],
    ] as const) {
      const resolved = resolveZeropsEnvironment(
        input({ projectId: "abc", roleRecheckSeconds: configured }),
      )!;
      assert.isTrue(
        Duration.equals(resolved.roleRecheckInterval, Duration.seconds(effective)),
        `roleRecheckSeconds=${String(configured)}`,
      );
    }
  });

  it("falls back to the defaults for a non-positive or non-finite override", () => {
    for (const seconds of [0, -1, Number.NaN]) {
      const resolved = resolveZeropsEnvironment(
        input({ projectId: "abc", roleRecheckSeconds: seconds, sessionMaxAgeSeconds: seconds }),
      )!;
      assert.isTrue(
        Duration.equals(
          resolved.roleRecheckInterval,
          Duration.seconds(DEFAULT_ZEROPS_ROLE_RECHECK_SECONDS),
        ),
        `roleRecheckSeconds=${String(seconds)}`,
      );
      assert.isTrue(
        Duration.equals(
          resolved.sessionMaxAge,
          Duration.seconds(DEFAULT_ZEROPS_SESSION_MAX_AGE_SECONDS),
        ),
        `sessionMaxAgeSeconds=${String(seconds)}`,
      );
    }
  });

  it("keeps the configured extra origins", () => {
    assert.deepStrictEqual(
      resolveZeropsEnvironment(
        input({ projectId: "abc", allowedOrigins: ["https://app.zerops.io"] }),
      )?.allowedOrigins,
      ["https://app.zerops.io"],
    );
  });

  it("leaves the public origin undefined unless configured", () => {
    assert.strictEqual(
      resolveZeropsEnvironment(input({ projectId: "abc" }))?.publicOrigin,
      undefined,
    );
  });

  it("trims a configured public origin, and blanks it out entirely", () => {
    assert.strictEqual(
      resolveZeropsEnvironment(
        input({ projectId: "abc", publicOrigin: "  https://zcp-26a7-8080.prg1.zerops.app  " }),
      )?.publicOrigin,
      "https://zcp-26a7-8080.prg1.zerops.app",
    );
    assert.strictEqual(
      resolveZeropsEnvironment(input({ projectId: "abc", publicOrigin: "   " }))?.publicOrigin,
      undefined,
    );
  });
});

describe("resolveZeropsApiBaseUrl", () => {
  it("defaults an empty host to production", () => {
    for (const apiHost of [undefined, "", "   "]) {
      assert.strictEqual(
        resolveZeropsApiBaseUrl(apiHost),
        `https://${DEFAULT_ZEROPS_API_HOST}/api/rest/public`,
      );
    }
  });

  it("prepends https to a bare host", () => {
    assert.strictEqual(
      resolveZeropsApiBaseUrl("api.app-prg1.zerops.io"),
      "https://api.app-prg1.zerops.io/api/rest/public",
    );
  });

  it("keeps an explicit scheme", () => {
    assert.strictEqual(
      resolveZeropsApiBaseUrl("http://localhost:9000"),
      "http://localhost:9000/api/rest/public",
    );
  });

  it("strips trailing slashes so the path never doubles up", () => {
    assert.strictEqual(
      resolveZeropsApiBaseUrl("https://api.app-prg1.zerops.io///"),
      "https://api.app-prg1.zerops.io/api/rest/public",
    );
  });
});

describe("isZeropsEnvironment", () => {
  it("reads the resolved environment off a server config", () => {
    assert.isFalse(isZeropsEnvironment({ zerops: undefined }));
    assert.isTrue(
      isZeropsEnvironment({ zerops: resolveZeropsEnvironment(input({ projectId: "abc" })) }),
    );
  });
});
