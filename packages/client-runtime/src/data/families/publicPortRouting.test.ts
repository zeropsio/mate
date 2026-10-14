import { describe, expect, it } from "vite-plus/test";

import { projectAddonsFamily } from "./projectAddons.ts";
import { publicPortRoutingFamily } from "./publicPortRouting.ts";

const decode = publicPortRoutingFamily.zerops!.decode;

/** A port routing in the organization's search wire shape (read 2026-10-14). */
const RECORDED = {
  _version: 2,
  clientId: "org",
  projectId: "p1",
  serviceStackId: "s2",
  serviceStackName: "db",
  publicIpType: "IP_V6",
  publicPort: 16437,
  internalPort: 6432,
  internalProtocol: "tcp",
  firewallPolicy: "BLACKLIST",
  firewallAllowMyIp: false,
  firewallIpRanges: [],
  isSynced: true,
  deleteOnSync: false,
  lastSync: "2026-10-13T22:33:10Z",
  created: "2026-10-13T22:33:09Z",
  lastUpdate: "2026-10-13T22:33:10Z",
};

describe("publicPortRoutingFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "keeps where a port opens, to what, who may connect and whether it is in place",
      raw: RECORDED,
      row: {
        id: "pr1",
        version: 2,
        value: {
          projectId: "p1",
          serviceStackId: "s2",
          publicIpType: "IP_V6",
          publicPort: 16437,
          internalPort: 6432,
          internalProtocol: "tcp",
          firewallPolicy: "BLACKLIST",
          firewallIpRanges: [],
          isSynced: true,
          deleteOnSync: false,
          everSynced: true,
          lastUpdate: "2026-10-13T22:33:10Z",
        },
      },
    },
    {
      name: "a port never put in place reads as new",
      raw: { ...RECORDED, isSynced: false, lastSync: null },
      row: expect.objectContaining({
        value: expect.objectContaining({ isSynced: false, everSynced: false }),
      }),
    },
    {
      name: "a row saying no firewall lets everyone connect",
      raw: { ...RECORDED, firewallPolicy: null, firewallIpRanges: null },
      row: expect.objectContaining({
        value: expect.objectContaining({ firewallPolicy: "BLACKLIST", firewallIpRanges: [] }),
      }),
    },
    {
      name: "refuses a row that names no port",
      raw: { ...RECORDED, publicPort: undefined },
      row: null,
    },
  ])("$name", ({ raw, row }) => {
    expect(decode({ id: "pr1", ...(raw as object) })).toEqual(row);
  });
});

describe("projectAddonsFamily", () => {
  it("reads each project's own IPv4: whether it is on, its price and its period", () => {
    expect(
      projectAddonsFamily.sampled!.decode({
        clientAddons: [],
        projectAddons: [
          {
            projectId: "p1",
            addonName: "IPv4 address",
            metricId: "PROJECT_IPV4",
            userEnabled: false,
            validFrom: "2026-10-13T22:29:40Z",
            validTill: "2026-11-13T22:29:40Z",
            unitPrice: 3,
          },
          { projectId: "p2", metricId: "PROJECT_IPV4", userEnabled: true, unitPrice: 3 },
          { projectId: "p3", metricId: "SOMETHING_ELSE", userEnabled: true, unitPrice: 9 },
        ],
      }),
    ).toEqual({
      ipv4: [
        { projectId: "p1", enabled: false, unitPrice: 3, validTill: "2026-11-13T22:29:40Z" },
        { projectId: "p2", enabled: true, unitPrice: 3 },
      ],
    });
  });

  it("an answer without project add-ons offers none", () => {
    expect(projectAddonsFamily.sampled!.decode({ clientAddons: [] })).toEqual({ ipv4: [] });
  });
});
