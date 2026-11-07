import { describe, expect, it } from "vite-plus/test";
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
  ])("$name", ({ raw, row }) => {
    expect(decode({ id: "pr1", ...(raw as object) })).toEqual(row);
  });
});
