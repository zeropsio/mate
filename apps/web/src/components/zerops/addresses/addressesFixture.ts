/**
 * One place's addresses as the sheet's tests draw them: production of Shop, with shop.com and its
 * www twin live on app, blog.com and its twin waiting for their DNS, app's and api's zerops.app
 * addresses on, the shared IPv4 with no own one, and db's PostgreSQL open on IPv6 to two ranges.
 * Example values are documentation addresses. Fixtures only: nothing here ships.
 */
import type { AddressDomain, PlaceAddresses } from "@t3tools/client-runtime/data";

const domain = (
  routingId: string,
  domainName: string,
  routingDomains: ReadonlyArray<string>,
  face: AddressDomain["face"],
): AddressDomain => ({
  routingId,
  domainName,
  routingDomains,
  targets: [{ serviceId: "svc-app", serviceName: "app", port: 3000, path: "/" }],
  sslEnabled: true,
  face,
  url: `https://${domainName}`,
  resolvedIps: [],
  nameServers: face === "live" ? [] : ["ns1.dns-provider.example", "ns2.dns-provider.example"],
  ...(face === "live" ? {} : { checkedAt: "2026-10-14T11:58:00Z" }),
});

export const ADDRESSES_FIXTURE: PlaceAddresses = {
  state: "ready",
  domains: [
    domain("rt-blog", "blog.com", ["blog.com", "www.blog.com"], "dns"),
    domain("rt-shop", "shop.com", ["shop.com", "www.shop.com"], "live"),
    domain("rt-blog", "www.blog.com", ["blog.com", "www.blog.com"], "dns"),
    domain("rt-shop", "www.shop.com", ["shop.com", "www.shop.com"], "live"),
  ],
  zerops: [
    {
      serviceId: "svc-app",
      serviceName: "app",
      on: true,
      hosts: [
        {
          port: 3000,
          url: "https://app-4c1e-3000.prg1.zerops.app",
          host: "app-4c1e-3000.prg1.zerops.app",
        },
      ],
      port: 3000,
    },
    {
      serviceId: "svc-api",
      serviceName: "api",
      on: true,
      hosts: [
        {
          port: 8080,
          url: "https://api-4c1e-8080.prg1.zerops.app",
          host: "api-4c1e-8080.prg1.zerops.app",
        },
      ],
      port: 8080,
    },
  ],
  ips: {
    v6: "2001:db8:4a7:1d::1",
    sharedV4: "93.185.106.128",
    zone: "k3f9x2.prg1-zerops.zone",
    zoneHasSharedV4: true,
  },
  portsState: "ready",
  ports: [
    {
      id: "port-db",
      serviceId: "svc-db",
      serviceName: "db",
      publicIpType: "IP_V6",
      publicPort: 6432,
      internalPort: 6432,
      internalProtocol: "tcp",
      firewallPolicy: "WHITELIST",
      ranges: ["2001:db8::1/128", "2001:db8:2::/48"],
      face: "live",
      address: "[2001:db8:4a7:1d::1]:6432",
    },
  ],
  webTargets: [
    { serviceId: "svc-app", serviceName: "app", port: 3000, protocol: "tcp" },
    { serviceId: "svc-api", serviceName: "api", port: 8080, protocol: "tcp" },
  ],
  portTargets: [{ serviceId: "svc-db", serviceName: "db", port: 6432, protocol: "tcp" }],
  waitingDomains: [],
  waitingPorts: [],
  readsProject: false,
  nothingDeployed: false,
};
