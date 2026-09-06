import { describe, expect, it } from "vite-plus/test";

import type { ZeropsService } from "./api.ts";
import { summarizeEnvironmentServices } from "./environmentSummary.ts";

function service(
  name: string,
  overrides: Partial<ZeropsService> & { readonly type?: string } = {},
): ZeropsService {
  const { type, ...rest } = overrides;
  return {
    id: `${name}-id`,
    name,
    status: "ACTIVE",
    isSystem: false,
    serviceStackTypeInfo: { serviceStackTypeVersionName: type ?? "nodejs@22" },
    ...rest,
  };
}

const CORE = service("core", { isSystem: true, type: "core:single@2" });
const BUILD = service("buildappv1788621372", {
  isSystem: true,
  status: "STOPPED",
  type: "alpine/build_runtime",
});
const ZCP = service("zcp", { type: "zcp@1" });
const DB = service("db", { type: "postgresql:single@16" });
const APP = service("app", {
  type: "alpine/go@1.22",
  activeAppVersion: { created: "2026-09-05T15:14:56Z", lastUpdate: "2026-09-05T15:17:24Z" },
});

describe("summarizeEnvironmentServices", () => {
  it("names the developer's services by hostname, the platform's left out", () => {
    expect(summarizeEnvironmentServices([BUILD, ZCP, DB, APP, CORE]).hostnames).toEqual([
      "app",
      "db",
    ]);
  });

  it("has nothing to name for a project holding only the core", () => {
    expect(summarizeEnvironmentServices([CORE])).toEqual({ hostnames: [], deployedAt: undefined });
  });

  it.each([
    ["the newest active version's last update", [APP, DB], "2026-09-05T15:17:24Z"],
    [
      "the newest across services",
      [APP, service("api", { activeAppVersion: { created: "2026-09-06T08:00:00Z" } }), DB],
      "2026-09-06T08:00:00Z",
    ],
    [
      "the version's creation when it has no update",
      [service("api", { activeAppVersion: { created: "2026-09-01T00:00:00Z" } })],
      "2026-09-01T00:00:00Z",
    ],
  ] as const)("dates the deploy by %s", (_, services, expected) => {
    expect(summarizeEnvironmentServices([...services]).deployedAt).toBe(expected);
  });

  it("has no deploy date when nothing has been deployed", () => {
    expect(
      summarizeEnvironmentServices([DB, service("api", { activeAppVersion: null })]).deployedAt,
    ).toBeUndefined();
  });
});
