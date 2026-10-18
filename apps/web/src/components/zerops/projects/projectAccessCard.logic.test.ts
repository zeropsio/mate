import type { AddressDomain, PlaceAddresses } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import { accessCard } from "./projectAccessCard.logic";

function place(over: Partial<PlaceAddresses> = {}): PlaceAddresses {
  return {
    state: "ready",
    domains: [],
    zerops: [],
    ips: { zoneHasSharedV4: false },
    portsState: "ready",
    ports: [],
    webTargets: [],
    portTargets: [],
    waitingDomains: [],
    waitingPorts: [],
    readsProject: false,
    ...over,
  };
}

const zerops = (serviceName: string, host: string, port = 3000) => ({
  serviceId: `s-${serviceName}`,
  serviceName,
  on: true,
  hosts: [{ port, url: `https://${host}`, host }],
  port,
});

function domain(domainName: string, face: AddressDomain["face"]): AddressDomain {
  return {
    routingId: `r-${domainName}`,
    domainName,
    routingDomains: [domainName],
    targets: [{ serviceId: "s-app", serviceName: "app", port: 3000, path: "/" }],
    sslEnabled: true,
    face,
    url: `https://${domainName}`,
    resolvedIps: [],
    nameServers: [],
  };
}

describe("accessCard", () => {
  it("lists every public address with where it lands, production first, then each stage", () => {
    const card = accessCard([
      {
        tier: "stage",
        runs: true,
        place: place({ zerops: [zerops("app", "stage-teashop-a1b2.prg1.zerops.app")] }),
      },
      {
        tier: "production",
        runs: true,
        place: place({ zerops: [zerops("app", "teashop-a1b2.prg1.zerops.app")] }),
      },
    ]);
    expect(card.rows.map((row) => [row.host, row.service, row.port, row.tier])).toEqual([
      ["teashop-a1b2.prg1.zerops.app", "app", 3000, "production"],
      ["stage-teashop-a1b2.prg1.zerops.app", "app", 3000, "stage"],
    ]);
  });

  it("puts a place's own domain before its zerops.app address, and says one not answering yet", () => {
    const card = accessCard([
      {
        tier: "production",
        runs: true,
        place: place({
          domains: [domain("teashop.example", "live"), domain("shop.example", "dns")],
          zerops: [zerops("app", "teashop-a1b2.prg1.zerops.app")],
        }),
      },
    ]);
    expect(card.rows.map((row) => [row.host, row.live])).toEqual([
      ["teashop.example", true],
      ["shop.example", false],
      ["teashop-a1b2.prg1.zerops.app", true],
    ]);
    expect(card.rows[1]?.word).toBeDefined();
  });

  it("offers a domain of its own while production runs and has none", () => {
    const bare = [
      {
        tier: "production" as const,
        runs: true,
        place: place({ zerops: [zerops("app", "teashop-a1b2.prg1.zerops.app")] }),
      },
    ];
    expect(accessCard(bare).offerDomain).toBe(true);
    expect(accessCard([{ ...bare[0]!, runs: false }]).offerDomain).toBe(false);
    expect(
      accessCard([{ ...bare[0]!, place: place({ domains: [domain("teashop.example", "live")] }) }])
        .offerDomain,
    ).toBe(false);
  });

  it("is reading while any place's addresses are, and says nothing is public once all are read empty", () => {
    expect(
      accessCard([{ tier: "production", runs: true, place: place({ state: "reading" }) }]).state,
    ).toBe("reading");
    const empty = accessCard([{ tier: "production", runs: true, place: place() }]);
    expect(empty.state).toBe("ready");
    expect(empty.rows).toEqual([]);
  });
});
