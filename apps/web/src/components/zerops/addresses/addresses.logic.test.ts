import { describe, expect, it } from "vite-plus/test";

import {
  addressPlaces,
  addressTrouble,
  checkedWords,
  domainFaceWords,
  domainProblem,
  domainsToAdd,
  firewallWords,
  keepsWorking,
  normalizeDomain,
  normalizeRange,
  othersWaiting,
  portFaceWords,
  portProblem,
  priceWords,
  recordsOf,
  removeWaitsFor,
  removeWrite,
  withOwnWrites,
  wwwTwin,
} from "./addresses.logic";
import { ADDRESSES_FIXTURE } from "./addressesFixture";

describe("a typed domain", () => {
  it.each([
    ["  Shop.COM ", "shop.com"],
    ["https://shop.com/checkout?x=1", "shop.com"],
    ["http://www.shop.com/", "www.shop.com"],
    ["shop.com.", "shop.com"],
    ["shop.com:443", "shop.com"],
    ["shop.com#top", "shop.com"],
    ["", ""],
  ])("%j is read as %j", (typed, read) => {
    expect(normalizeDomain(typed)).toBe(read);
  });

  it.each([
    ["shop.com", "www.shop.com"],
    ["api.shop.com", null],
    ["www.shop.com", null],
    ["shop", null],
    ["", null],
    ["*.shop.com", null],
  ])("a two-label domain offers its www twin: %j → %j", (name, twin) => {
    expect(wwwTwin(name)).toBe(twin);
  });

  it.each([
    ["shop.com", [], null],
    ["", [], null],
    ["shop", [], "Enter a full domain name, like shop.com."],
    ["sh op.com", [], "Enter a full domain name, like shop.com."],
    ["-shop.com", [], "Enter a full domain name, like shop.com."],
    ["*.shop.com", [], null],
    ["*.eu.shop.com", [], null],
    ["*shop.com", [], "Enter a full domain name, like shop.com."],
    ["shop.*.com", [], "Enter a full domain name, like shop.com."],
    ["*.com", [], "Enter a full domain name, like shop.com."],
    ["shop.com", ["shop.com"], "shop.com is already one of Production's addresses."],
  ])("%j against %j says %j", (name, existing, problem) => {
    expect(domainProblem(name, existing, "Production")).toBe(problem);
  });

  it("adds the www twin only where asked and not already there", () => {
    expect(domainsToAdd("shop.com", true, [])).toEqual(["shop.com", "www.shop.com"]);
    expect(domainsToAdd("shop.com", false, [])).toEqual(["shop.com"]);
    expect(domainsToAdd("shop.com", true, ["www.shop.com"])).toEqual(["shop.com"]);
    expect(domainsToAdd("api.shop.com", true, [])).toEqual(["api.shop.com"]);
  });
});

describe("who may connect to a port", () => {
  it.each([
    ["2001:db8::1", "IP_V6", { ok: true, range: "2001:db8::1/128" }],
    ["2001:DB8::/32", "IP_V6", { ok: true, range: "2001:db8::/32" }],
    [" 198.51.100.20 ", "IP_V4", { ok: true, range: "198.51.100.20/32" }],
    ["192.0.2.0/24", "IP_V4", { ok: true, range: "192.0.2.0/24" }],
    [
      "198.51.100.20",
      "IP_V6",
      {
        ok: false,
        problem:
          "198.51.100.20 is an IPv4 address: an IPv6 port can't allow it. Use an IPv6 address, or open the port on IPv4.",
      },
    ],
    [
      "2001:db8::1",
      "IP_V4",
      {
        ok: false,
        problem: "2001:db8::1 is an IPv6 address: an IPv4 port can't allow it.",
      },
    ],
    ["2001:db8::1/129", "IP_V6", { ok: false, problem: "2001:db8::1/129 isn't an IP address." }],
    ["300.1.1.1", "IP_V4", { ok: false, problem: "300.1.1.1 isn't an IP address." }],
    ["shop.com", "IP_V6", { ok: false, problem: "shop.com isn't an IP address." }],
  ] as const)("%j on an %s port reads as %j", (typed, ipType, read) => {
    expect(normalizeRange(typed, ipType)).toEqual(read);
  });

  it.each([
    ["WHITELIST", ["198.51.100.20/32"], "Only 198.51.100.20/32"],
    ["WHITELIST", ["198.51.100.20/32", "192.0.2.0/24"], "Only 2 addresses"],
    ["BLACKLIST", [], "Everyone"],
    ["BLACKLIST", ["192.0.2.0/24"], "Everyone except 192.0.2.0/24"],
    ["BLACKLIST", ["a/32", "b/32", "c/32"], "Everyone except 3 addresses"],
  ])("%s %j is said as %j", (policy, ranges, words) => {
    expect(firewallWords(policy, ranges)).toBe(words);
  });
});

describe("a public port", () => {
  const open = [{ publicIpType: "IP_V6", publicPort: 6432 }];
  it.each([
    ["5432", "IP_V6", null],
    ["", "IP_V6", "Enter a port number."],
    ["54x", "IP_V6", "Enter a port number."],
    ["80", "IP_V6", "80 and 443 are kept for web addresses. Pick another port."],
    ["443", "IP_V6", "80 and 443 are kept for web addresses. Pick another port."],
    ["9", "IP_V6", "Pick a public port from 10 to 65435."],
    ["65436", "IP_V6", "Pick a public port from 10 to 65435."],
    ["6432", "IP_V6", "Port 6432 is already open on IPv6."],
    ["6432", "IP_V4", null],
  ] as const)("%j on %s says %j", (typed, ipType, problem) => {
    expect(portProblem(typed, ipType, open)).toBe(problem);
  });
});

describe("a refused write says why in a sentence", () => {
  it.each([
    [
      "publicHttpRoutingDuplicateDomainNameInAnotherRouting",
      "shop.com or www.shop.com is already in use on Zerops.",
    ],
    ["publicHttpRoutingInvalidDomainNameFQDN", "Enter a full domain name, like shop.com."],
    [
      "publicHttpRoutingServiceStackDoesNotSupportHttp",
      "That service doesn't serve web pages. Point the domain at another one.",
    ],
    ["portNotSupported", "That service can't open this port directly."],
    ["publicPortRoutingReservedPort", "80 and 443 are kept for web addresses. Pick another port."],
    ["portOutOfRange", "Pick a public port from 10 to 65435."],
    [
      "publicIpTypeNotSupported",
      "A port on IPv4 needs your own IPv4. Get one under IP addresses, or open it on IPv6.",
    ],
    [
      "publicPortRoutingInvalidIpFormat",
      "Zerops didn't take one of the addresses. Give each with its mask, like 2001:db8::1/128.",
    ],
    ["somethingElse", undefined],
    [undefined, undefined],
  ])("%s → %j", (code, sentence) => {
    expect(
      addressTrouble(code, {
        kind: "add-domain",
        projectId: "p1",
        domains: ["shop.com", "www.shop.com"],
        serviceId: "svc-app",
        port: 3000,
      }),
    ).toBe(sentence);
  });

  it("names no domain where the write names none", () => {
    expect(addressTrouble("publicHttpRoutingDuplicateDomainNameInAnotherRouting")).toBe(
      "That domain is already in use on Zerops.",
    );
  });
});

describe("how far an address is", () => {
  it.each([
    ["going-live", "Going live", "busy"],
    ["changing", "Changing", "busy"],
    ["removing", "Removing", "busy"],
    ["dns", "Waiting for your DNS", "warn"],
    ["elsewhere", "Points elsewhere", "warn"],
    ["certificate", "Getting a certificate", "busy"],
    ["certificate-failed", "Couldn't get a certificate", "warn"],
    ["live", "Live", "ok"],
  ] as const)("a domain %s says %j", (face, word, tone) => {
    expect(domainFaceWords(face)).toEqual({ word, tone });
  });

  it.each([
    ["going-live", "Opening"],
    ["changing", "Changing"],
    ["removing", "Closing"],
    ["live", "Open"],
  ] as const)("a port %s says %j", (face, word) => {
    expect(portFaceWords(face).word).toBe(word);
  });
});

describe("the records a domain needs", () => {
  it("lists each waiting domain of a routing with its A and AAAA, and says both are needed on the shared IPv4", () => {
    const routing = ADDRESSES_FIXTURE.domains.filter((domain) => domain.routingId === "rt-blog");
    const records = recordsOf(routing, ADDRESSES_FIXTURE.ips);
    expect(records.records).toEqual([
      { type: "A", name: "blog.com", value: "93.185.106.128" },
      { type: "AAAA", name: "blog.com", value: "2001:db8:4a7:1d::1" },
      { type: "A", name: "www.blog.com", value: "93.185.106.128" },
      { type: "AAAA", name: "www.blog.com", value: "2001:db8:4a7:1d::1" },
    ]);
    expect(records.bothRequired).toBe(true);
    expect(records.cnames.map((record) => record.name)).toEqual(["blog.com", "www.blog.com"]);
  });

  it("gives a wildcard its certificate's CNAME, and keeps whether each CNAME reaches IPv4", () => {
    const records = recordsOf([{ domainName: "*.blog.com" }], {
      ...ADDRESSES_FIXTURE.ips,
      zoneHasSharedV4: false,
    });
    expect(records.certificates).toEqual([
      { type: "CNAME", name: "_acme-challenge.blog.com", value: "blog.com.zerops.zone" },
    ]);
    expect(records.cnames.map((record) => [record.name, record.ipv4])).toEqual([
      ["*.blog.com", false],
    ]);
  });

  it("points the A at the project's own IPv4 where it has one", () => {
    const routing = ADDRESSES_FIXTURE.domains.filter((domain) => domain.routingId === "rt-blog");
    const records = recordsOf(routing, { ...ADDRESSES_FIXTURE.ips, ownV4: "203.0.113.24" });
    expect(records.records[0]).toEqual({ type: "A", name: "blog.com", value: "203.0.113.24" });
    expect(records.bothRequired).toBe(false);
  });
});

describe("closing a zerops.app address", () => {
  it("names the live domains that lead to the same service", () => {
    expect(keepsWorking(ADDRESSES_FIXTURE.domains, "svc-app")).toEqual([
      "shop.com",
      "www.shop.com",
    ]);
    expect(keepsWorking(ADDRESSES_FIXTURE.domains, "svc-api")).toEqual([]);
  });
});

describe("our own writes", () => {
  it("shows a domain being added before the search finds it, and one being removed at once", () => {
    const place = withOwnWrites(ADDRESSES_FIXTURE, [
      {
        kind: "add-domain",
        projectId: "p1",
        domains: ["new.com"],
        serviceId: "svc-app",
        port: 3000,
      },
      {
        kind: "remove-domain",
        projectId: "p1",
        routingId: "rt-shop",
        domainName: "www.shop.com",
        keep: ["shop.com"],
        locations: [],
        sslEnabled: true,
      },
    ]);
    const added = place.domains.find((domain) => domain.domainName === "new.com");
    expect(added?.face).toBe("going-live");
    expect(added?.targets[0]?.serviceName).toBe("app");
    expect(place.domains.find((domain) => domain.domainName === "www.shop.com")?.face).toBe(
      "removing",
    );
  });

  it("shows a port being opened and one being closed", () => {
    const place = withOwnWrites(ADDRESSES_FIXTURE, [
      {
        kind: "open-port",
        projectId: "p1",
        serviceId: "svc-db",
        publicIpType: "IP_V6",
        publicPort: 7000,
        internalPort: 6432,
        internalProtocol: "tcp",
        firewallPolicy: "WHITELIST",
        firewallIpRanges: ["2001:db8::1/128"],
      },
      { kind: "close-port", projectId: "p1", portRoutingId: "port-db" },
    ]);
    expect(place.ports.find((port) => port.publicPort === 7000)?.face).toBe("going-live");
    expect(place.ports.find((port) => port.id === "port-db")?.face).toBe("removing");
  });

  it("shows a zerops.app address closed as soon as we close it", () => {
    const place = withOwnWrites(ADDRESSES_FIXTURE, [
      { kind: "disable-subdomain-access", projectId: "p1", serviceId: "svc-app" },
    ]);
    expect(place.zerops.find((address) => address.serviceId === "svc-app")?.on).toBe(false);
    expect(place.zerops.find((address) => address.serviceId === "svc-api")?.on).toBe(true);
  });

  it("a waiting port on the same number but the other IP type is someone else's", () => {
    const ports = [
      { ...ADDRESSES_FIXTURE.ports[0]!, id: "port-v4", publicIpType: "IP_V4", publicPort: 7000 },
      { ...ADDRESSES_FIXTURE.ports[0]!, id: "port-v6", publicIpType: "IP_V6", publicPort: 7000 },
    ];
    const waiting = [
      { id: "port-v4", label: "Port 7000 → db · port 6432" },
      { id: "port-v6", label: "Port 7000 → db · port 6432" },
    ];
    expect(
      othersWaiting(
        waiting,
        [
          {
            kind: "open-port",
            projectId: "p1",
            serviceId: "svc-db",
            publicIpType: "IP_V6",
            publicPort: 7000,
            internalPort: 6432,
            internalProtocol: "tcp",
            firewallPolicy: "BLACKLIST",
            firewallIpRanges: [],
          },
        ],
        ports,
      ).map((change) => change.id),
    ).toEqual(["port-v4"]);
  });

  it("someone else's waiting change is told apart from ours", () => {
    const waiting = [
      { id: "rt-api", label: "api.shop.com → api · port 8080" },
      { id: "rt-new", label: "new.com, www.new.com → app · port 3000" },
      { id: "rt-shop", label: "Removing www.shop.com" },
    ];
    expect(
      othersWaiting(waiting, [
        {
          kind: "add-domain",
          projectId: "p1",
          domains: ["new.com", "www.new.com"],
          serviceId: "svc-app",
          port: 3000,
        },
        {
          kind: "remove-domain",
          projectId: "p1",
          routingId: "rt-shop",
          domainName: "www.shop.com",
          keep: ["shop.com"],
          locations: [],
          sslEnabled: true,
        },
      ]).map((change) => change.id),
    ).toEqual(["rt-api"]);
  });
});

describe("the own IPv4's price", () => {
  it.each([
    [3, "$3"],
    [2.5, "$2.50"],
    [undefined, undefined],
  ])("%j is said as %j", (price, words) => {
    expect(priceWords(price)).toBe(words);
  });
});

describe("when the DNS was last looked at", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  it.each([
    [undefined, null],
    ["2026-10-14T11:59:40Z", "Checked just now"],
    ["2026-10-14T11:59:00Z", "Checked a minute ago"],
    ["2026-10-14T11:52:00Z", "Checked 8 minutes ago"],
    ["2026-10-14T09:00:00Z", "Checked 3 hours ago"],
    ["2026-10-12T09:00:00Z", "Checked 2 days ago"],
    ["not a time", null],
  ])("%j says %j", (at, words) => {
    expect(checkedWords(at, now)).toBe(words);
  });
});

describe("removing a domain", () => {
  it("never keeps a domain whose own removal is under way", () => {
    const www = ADDRESSES_FIXTURE.domains.find((domain) => domain.domainName === "www.shop.com")!;
    const place = withOwnWrites(ADDRESSES_FIXTURE, [
      removeWrite(
        ADDRESSES_FIXTURE.domains.find((domain) => domain.domainName === "shop.com")!,
        "p1",
      ),
    ]);
    const removing = place.domains.filter((domain) => domain.face === "removing");
    expect(removeWrite(www, "p1", removing)).toMatchObject({ keep: [] });
  });

  it("names the domain a remove must wait for while another of its routing is being removed", () => {
    const place = withOwnWrites(ADDRESSES_FIXTURE, [
      removeWrite(
        ADDRESSES_FIXTURE.domains.find((domain) => domain.domainName === "shop.com")!,
        "p1",
      ),
    ]);
    const www = place.domains.find((domain) => domain.domainName === "www.shop.com")!;
    expect(removeWaitsFor(www, place.domains)).toBe("shop.com");
    const blog = place.domains.find((domain) => domain.domainName === "blog.com")!;
    expect(removeWaitsFor(blog, place.domains)).toBeNull();
  });

  it("keeps the routing's other domains and sends it as it reads", () => {
    const www = ADDRESSES_FIXTURE.domains.find((domain) => domain.domainName === "www.shop.com")!;
    expect(removeWrite(www, "p1")).toEqual({
      kind: "remove-domain",
      projectId: "p1",
      routingId: "rt-shop",
      domainName: "www.shop.com",
      keep: ["shop.com"],
      locations: [{ path: "/", port: 3000, serviceStackId: "svc-app" }],
      sslEnabled: true,
    });
  });
});

describe("the project's places", () => {
  it("lists production, each stage, then each Mate's own project, a colleague's with its owner", () => {
    const menu = (stops: ReadonlyArray<{ projectId: string | undefined; name: string }>) => () => ({
      stops,
    });
    expect(
      addressPlaces(
        {
          production: menu([{ projectId: "prod", name: "production" }]),
          stages: menu([
            { projectId: "stage", name: "stage" },
            { projectId: "demo", name: "client demo" },
            { projectId: undefined, name: "Coming" },
          ]),
          mates: [
            { candidate: { project: { id: "fen" } }, name: "Fen", owner: undefined },
            {
              candidate: { project: { id: "rhea" } },
              name: "Rhea",
              owner: { name: "Karlos Novak", isViewer: false },
            },
            {
              candidate: { project: { id: "juno" } },
              name: "Juno",
              owner: { name: "Ales R", isViewer: true },
            },
          ],
        },
        0,
      ),
    ).toEqual([
      { projectId: "prod", kind: "production", label: "Production", name: "Production" },
      { projectId: "stage", kind: "stage", label: "Stage", name: "Stage" },
      { projectId: "demo", kind: "stage", label: "Client demo", name: "Client demo" },
      { projectId: "fen", kind: "mate", label: "Fen", name: "Fen" },
      { projectId: "rhea", kind: "mate", label: "Rhea", name: "Rhea", owner: "Karlos" },
      { projectId: "juno", kind: "mate", label: "Juno", name: "Juno" },
    ]);
  });
});
