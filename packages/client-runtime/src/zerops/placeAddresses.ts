// Every way the internet reaches one place: the shapes `data/projections/addresses.ts` derives and the
// addresses sheet and `servedAddresses.ts` read.

/**
 * How far a domain is from answering, in the order a new one goes through:
 * - `adding`: our own add, sent and not in the routings yet;
 * - `removing`: our own removal, sent and still in the routings;
 * - `dns`: the person's DNS not pointing here yet (checking, or pointing nowhere);
 * - `elsewhere`: the DNS check found it at another address;
 * - `certificate`: the DNS is right, its certificate on its way;
 * - `certificate-failed`: the certificate could not be installed;
 * - `live`: it answers.
 */
export type DomainFace =
  | "adding"
  | "removing"
  | "dns"
  | "elsewhere"
  | "certificate"
  | "certificate-failed"
  | "live";

/** Where a domain or a path of it leads: a service's web port. */
export interface AddressTarget {
  readonly serviceId: string;
  /** The service's hostname, or its id while the service is not read. */
  readonly serviceName: string;
  readonly port: number;
  readonly path: string;
}

export interface AddressDomain {
  readonly routingId: string;
  readonly domainName: string;
  /** Every domain its routing holds, this one included: removing one keeps the others. */
  readonly routingDomains: ReadonlyArray<string>;
  /** Where it leads, its routing's locations in order. */
  readonly targets: ReadonlyArray<AddressTarget>;
  readonly sslEnabled: boolean;
  readonly face: DomainFace;
  /** The address it answers at once live: its first location's. */
  readonly url: string;
  /** What the last DNS check found it at; empty while it points nowhere. */
  readonly resolvedIps: ReadonlyArray<string>;
  /** Who answers for its DNS: where the person adds its records. */
  readonly nameServers: ReadonlyArray<string>;
  /** When the platform last looked it up, on its clock. */
  readonly checkedAt?: string;
  /** Why its certificate could not be installed, as the platform says it. */
  readonly sslError?: string;
}

/** A service's zerops.app address and its switch: one per service that serves the web. */
export interface ZeropsAddress {
  readonly serviceId: string;
  readonly serviceName: string;
  /** Whether its zerops.app address is on (`subdomainAccess`). */
  readonly on: boolean;
  /** Its addresses while on, one per web port. */
  readonly hosts: ReadonlyArray<{
    readonly port: number;
    readonly url: string;
    readonly host: string;
  }>;
  /** The web port turning it on publishes: its lowest. */
  readonly port: number;
}

export interface PlaceIps {
  /** The project's own IPv6: every project has one. */
  readonly v6?: string;
  /** The project's own IPv4, the paid add-on; absent while it has none. */
  readonly ownV4?: string;
  /**
   * The region's shared IPv4, free, for web traffic only: an A record may point at it, with an
   * AAAA at `v6` beside it. Absent for a region this build does not know.
   */
  readonly sharedV4?: string;
  /** The project's own DNS name, the target of a CNAME. */
  readonly zone?: string;
  /** Whether that name answers on the shared IPv4 too, not only on `v6` (`publicIpV4Shared`). */
  readonly zoneHasSharedV4: boolean;
}

/** One port opened straight to the internet, and who may connect. */
export interface DirectPort {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceName: string;
  /** `IP_V6` or `IP_V4`. */
  readonly publicIpType: string;
  readonly publicPort: number;
  readonly internalPort: number;
  /** `tcp` or `udp`. */
  readonly internalProtocol: string;
  /** `WHITELIST`: only `ranges` may connect; `BLACKLIST`: everyone but them. */
  readonly firewallPolicy: string;
  readonly ranges: ReadonlyArray<string>;
  /** Open, or our own write to it sent and not in the routings yet (`opening`, …). */
  readonly face: "opening" | "changing" | "removing" | "live";
  /** Where a client connects, `[ipv6]:port` or `ipv4:port`; absent while the IP is not read. */
  readonly address?: string;
}

/** A service port a domain may point at, or one that may be opened straight to the internet. */
export interface ServicePortChoice {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly port: number;
  readonly protocol: string;
}

export interface PlaceAddresses {
  /** `reading` until services, routings and the project are read; `failed` where any is refused. */
  readonly state: "ready" | "reading" | "failed";
  readonly domains: ReadonlyArray<AddressDomain>;
  readonly zerops: ReadonlyArray<ZeropsAddress>;
  readonly ips: PlaceIps;
  /** The ports, read apart: a viewer refused them still sees the rest. */
  readonly portsState: "ready" | "reading" | "failed";
  readonly ports: ReadonlyArray<DirectPort>;
  /** Web ports a new domain may point at, by service. */
  readonly webTargets: ReadonlyArray<ServicePortChoice>;
  /** Ports that may be opened straight to the internet, by service. */
  readonly portTargets: ReadonlyArray<ServicePortChoice>;
  /** The organization's routings are refused to the viewer: demand the project's own listing. */
  readonly readsProject: boolean;
  /**
   * The platform says nothing deployed runs here: it has runtimes, and every one holds no deploy
   * (`activeAppVersion: null`). False where one runs a deploy, or that is not read.
   */
  readonly nothingDeployed: boolean;
}
