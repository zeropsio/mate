import type { ZeropsTopologyGroup } from "@t3tools/client-runtime/zerops/topology";
import { describe, expect, it } from "vite-plus/test";

import { mateAddresses, type MateAddressInput } from "@t3tools/client-runtime/zerops/mateAddresses";

const svc = (
  hostname: string,
  urls: ReadonlyArray<string>,
  group: ZeropsTopologyGroup = "runtimes",
) => ({
  hostname,
  group,
  routes: urls.map((url) => ({ url })),
});

const brief = (input: MateAddressInput) =>
  mateAddresses(input).map(({ service, role, url }) => ({ service, role, url }));

describe("a thread's lease's addresses", () => {
  const pool = {
    ...svc("webpool", ["https://webpool-1df2-3000.prg1.zerops.app"], "infrastructure"),
    type: "swarm@1",
  };
  const LEASE_URL = "https://webpool-3-1df2-3000.prg1.zerops.app";
  const lease = (
    devServers?: NonNullable<NonNullable<MateAddressInput["leases"]>[number]["devServers"]>,
    alias = "webpool-3",
  ) => ({
    alias,
    pool: alias.replace(/-\d+$/u, ""),
    state: "held",
    ...(devServers === undefined ? {} : { devServers }),
  });
  const running = (name: string, port: number, url?: string) => ({
    name,
    port,
    status: "running",
    readAt: "2026-10-28T10:00:00Z",
    ...(url === undefined ? {} : { url }),
  });

  it("a bound thread lists its lease's dev server under the lease's name, as a dev", () => {
    const addresses = mateAddresses({
      services: [pool],
      leases: [lease([running("web", 3000, LEASE_URL)])],
    });
    expect(addresses).toContainEqual({
      service: "webpool-3",
      role: "dev",
      url: LEASE_URL,
      host: "webpool-3-1df2-3000.prg1.zerops.app",
      name: "webpool-3",
    });
  });

  it("a lease the envelope carries no address for adds nothing, and never the pool's own address", () => {
    const before = mateAddresses({ services: [pool] });
    expect(mateAddresses({ services: [pool], leases: [lease()] })).toEqual(before);
    expect(mateAddresses({ services: [pool], leases: [lease([running("web", 3000)])] })).toEqual(
      before,
    );
  });

  it("a bound thread lists the dev servers of every lease of its branch, each under its lease's name", () => {
    const HQ_URL = "https://hqpool-2-1df2-8080.prg1.zerops.app";
    const addresses = mateAddresses({
      services: [pool],
      leases: [
        lease([running("web", 3000, LEASE_URL)]),
        lease([running("hq", 8080, HQ_URL)], "hqpool-2"),
      ],
    });
    expect(
      addresses
        .filter(({ url }) => url === LEASE_URL || url === HQ_URL)
        .map(({ service, role, name, url }) => ({ service, role, name, url })),
    ).toEqual([
      { service: "hqpool-2", role: "dev", name: "hqpool-2", url: HQ_URL },
      { service: "webpool-3", role: "dev", name: "webpool-3", url: LEASE_URL },
    ]);
  });

  it("each running dev server of a workspace is its own address, by the chat it is for and the server's own name", () => {
    const API_URL = "https://webpool-3-1df2-8080.prg1.zerops.app";
    const addresses = mateAddresses({
      services: [pool],
      leases: [
        lease([
          running("web", 3000, LEASE_URL),
          running("api", 8080, API_URL),
          { ...running("worker", 9000), status: "starting" },
        ]),
      ],
      leaseChats: [{ alias: "webpool-3", title: "Fix the login" }],
    });
    expect(addresses.map(({ role, name, url }) => ({ role, name, url }))).toEqual([
      { role: "dev", name: "webpool-3 · Fix the login · web", url: LEASE_URL },
      { role: "dev", name: "webpool-3 · Fix the login · api", url: API_URL },
    ]);
  });

  it("a workspace is named by its real alias and the chat it is for", () => {
    const addresses = mateAddresses({
      services: [pool],
      leases: [lease([running("web", 3000, LEASE_URL)])],
      leaseChats: [{ alias: "webpool-3", title: "Fix the login" }],
    });
    expect(addresses.map(({ name }) => name)).toEqual(["webpool-3 · Fix the login"]);
  });
});

describe("a part migrated to a dev pool", () => {
  // The dev service is gone and zcp keys the pair by the pool, whose envelope snapshot carries the
  // stage (zcp spec-mate §2.8a.3): the stage is still the Mate's preview.
  const STAGE_URL = "https://appstage-1df2-3000.prg1.zerops.app";
  const services = [
    {
      ...svc("apppool", ["https://apppool-1df2-3000.prg1.zerops.app"], "infrastructure"),
      type: "swarm@1",
    },
    { ...svc("appstage", [STAGE_URL]), type: "bun@1.3" },
  ];

  it("its stage is the Mate's preview, paired with the pool, and the pool's own address is never listed", () => {
    expect(
      brief({
        services,
        poolPairs: [{ pool: "apppool", stages: [{ hostname: "appstage", setup: "prod" }] }],
      }),
    ).toEqual([{ service: "appstage", role: "preview", url: STAGE_URL }]);
  });

  it("before the envelope pairs it, its stage pairs with the pool of its stem", () => {
    expect(brief({ services })).toEqual([{ service: "appstage", role: "preview", url: STAGE_URL }]);
  });

  it("the holder zcp keeps for its repository opens nothing: it holds the code, nothing runs there", () => {
    const holder = { ...svc("kiln", ["https://kiln-1df2-8080.prg1.zerops.app"]), type: "go@1.22" };
    expect(brief({ services: [...services, holder], standIns: ["kiln"] })).toEqual([
      { service: "appstage", role: "preview", url: STAGE_URL },
    ]);
  });
});
