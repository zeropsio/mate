import { assert, describe, it } from "@effect/vitest";

import {
  DEFAULT_ZEROPS_API_HOST,
  HQ_GIT_CREDENTIAL_ENV,
  HQ_ORIGIN_ENV,
  isZeropsEnvironment,
  publishHqGitCredential,
  publishHqOrigin,
  resolveHqGitCredentialPath,
  resolveZeropsApiBaseUrl,
  resolveZeropsEnvironment,
} from "./ZeropsEnvironment.ts";

const input = (overrides?: Partial<Parameters<typeof resolveZeropsEnvironment>[0]>) => ({
  projectId: undefined,
  apiHost: undefined,
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
    const resolved = resolveZeropsEnvironment(input({ projectId: "TEST000000000000000023" }));
    assert.isDefined(resolved);
    assert.strictEqual(resolved?.projectId, "TEST000000000000000023");
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

describe("the HQ a Mate links to", () => {
  it.each<[string, string | undefined, string]>([
    ["Mate HQ's production origin when none is named", undefined, "https://mate-hq.zerops.io"],
    [
      "the named HQ, without its trailing slash",
      "https://hq.stage.example/",
      "https://hq.stage.example",
    ],
  ])("the processes a Mate starts read the HQ origin it links to: %s", (_name, named, expected) => {
    const zerops = resolveZeropsEnvironment(input({ projectId: "p", hqOrigin: named }));
    const env: Record<string, string | undefined> = { [HQ_ORIGIN_ENV]: named };
    publishHqOrigin(env, zerops?.hqOrigin ?? "");
    assert.strictEqual(zerops?.hqOrigin, expected);
    assert.strictEqual(env[HQ_ORIGIN_ENV], expected);
  });
});

describe("the Git credential file a Mate keeps", () => {
  it.each<[string, string | undefined, string]>([
    [
      "a file under the server's own secrets when none is named",
      undefined,
      "/state/secrets/hq-git-credential",
    ],
    ["the named file, for development", "/dev/git-credential", "/dev/git-credential"],
  ])(
    "the processes a Mate starts read the Git credential file it keeps: %s",
    (_name, named, expected) => {
      const path = resolveHqGitCredentialPath(named, "/state/secrets");
      const env: Record<string, string | undefined> = { [HQ_GIT_CREDENTIAL_ENV]: named };
      publishHqGitCredential(env, path);
      assert.strictEqual(path, expected);
      assert.strictEqual(env[HQ_GIT_CREDENTIAL_ENV], expected);
    },
  );
});
